// ============================================================================
// Unit tests — what the commitment writes REFUSE, and what they say when they do
// ----------------------------------------------------------------------------
// The database is the real control: `approved_by <> requested_by` is a CHECK
// constraint, the append-only trigger freezes what was promised, and RLS decides
// who may move a document. None of that is under test here.
//
// What IS under test is the layer a volunteer treasurer actually meets. Three
// things it has to get right:
//
//   1. THE SELF-APPROVAL REFUSAL IS THE FEATURE, NOT AN ERROR. A treasurer who
//      raised a request must be told she cannot approve it — before the write,
//      in words about separation of duties, not as a constraint violation.
//   2. A CLOSE RECORDS WHAT IT RELEASED (R4), read from SQL. When that read
//      fails it records NULL, not zero: `released_cents` is nullable precisely
//      so "we did not record it" is expressible, and a false $0.00 on a closed
//      purchase order is a permanent lie about where the money went.
//   3. EVERY REFUSAL THE DATABASE CAN RAISE GETS ITS OWN SENTENCE, branched on
//      the SQLSTATE (0021's class `OC`), never on message text.
//
// No DB and no network: the module boundary is replaced with recorders.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const SEASON = "22222222-2222-2222-2222-222222222222";
const COMMITMENT = "33333333-3333-3333-3333-333333333333";
const LINE = "44444444-4444-4444-4444-444444444444";
const ME = "u1";
const SOMEONE_ELSE = "u2";

const h = vi.hoisted(() => ({
  // The commitment the action reads back before it moves it.
  commitment: null as Record<string, unknown> | null,
  // What the write answers with: an error carrying a SQLSTATE, or nothing.
  writeError: null as { code?: string } | null,
  // What commitment_drawdown_rows answers with.
  drawResult: { data: null as unknown, error: null as { code?: string } | null },
  // What record_commitment_approval answers with (0023): 'approved' when this
  // press approved the document, 'recorded' when it was the first of two.
  approvalResult: {
    data: "approved" as unknown,
    error: null as { code?: string } | null,
  },
  // The program row the action reads its three spending rules from.
  program: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireRole: async () => ({ user: { id: ME } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { url?: string };
    err.url = url;
    throw err;
  },
}));

vi.mock("@/lib/supabase/server", () => {
  const builderFor = (table: string) => {
    const filters: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" = "select";
    const builder: Record<string, unknown> = {};
    builder.select = () => {
      mode = "select";
      return builder;
    };
    builder.update = (patch: Record<string, unknown>) => {
      mode = "update";
      h.updates.push(patch);
      return builder;
    };
    builder.insert = (row: Record<string, unknown>) => {
      mode = "insert";
      h.inserts.push(row);
      return builder;
    };
    builder.eq = (key: string, value: unknown) => {
      filters[key] = value;
      return builder;
    };
    builder.maybeSingle = () => builder;
    builder.then = (onOk: (v: unknown) => unknown) => {
      if (mode !== "select") {
        return Promise.resolve({ error: h.writeError }).then(onOk);
      }
      // Every in-program resolution answers "ours"; the branches under test are
      // the lifecycle's, not the pre-checks'.
      if (table === "commitments") {
        return Promise.resolve({ data: h.commitment }).then(onOk);
      }
      if (table === "budget_lines") {
        return Promise.resolve({
          data: { id: filters.id, category_id: "cat" },
        }).then(onOk);
      }
      if (table === "budget_categories") {
        return Promise.resolve({ data: { budget_id: "bud" } }).then(onOk);
      }
      if (table === "programs") {
        return Promise.resolve({ data: h.program }).then(onOk);
      }
      return Promise.resolve({ data: { id: filters.id ?? "x" } }).then(onOk);
    };
    return builder;
  };

  return {
    createClient: async () => ({
      from: (table: string) => builderFor(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        // Approving does not take the generic UPDATE path since 0023 — the
        // database decides whether a press is the first of two or the one that
        // approves the document, and answers with which it was.
        return fn === "record_commitment_approval"
          ? h.approvalResult
          : h.drawResult;
      },
    }),
  };
});

import {
  createCommitment,
  moveCommitment,
  reviseCommitment,
} from "@/app/(app)/[program]/treasury/commitments/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run(
  action: (fd: FormData) => Promise<void>,
  fields: Record<string, string>,
): Promise<string> {
  try {
    await action(form(fields));
  } catch (e) {
    return (e as Error & { url?: string }).url ?? "";
  }
  return "";
}

const paramOf = (url: string, key: string): string | null =>
  new URL(url, "https://x.test").searchParams.get(key);

// A commitment as the action reads it back, at whatever step the test needs.
function at(
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: COMMITMENT,
    season_id: SEASON,
    status,
    requested_by: SOMEONE_ELSE,
    budget_line_id: LINE,
    // Under every threshold the defaults set, unless a test says otherwise.
    amount_cents: 10_000,
    shipping_cents: 0,
    tax_cents: 0,
    board_minutes_ref: null,
    closed_at: null,
    cancelled_at: null,
    superseded_at: null,
    ...extra,
  };
}

const MOVE = { programId: PROGRAM, slug: "westfield", commitmentId: COMMITMENT };

beforeEach(() => {
  h.commitment = at("requested");
  h.writeError = null;
  h.drawResult = { data: null, error: null };
  h.approvalResult = { data: "approved", error: null };
  // 0023's own defaults: $250 / $1,000 / $500.
  h.program = {
    commitment_second_approver_cents: 25_000,
    commitment_board_approval_cents: 100_000,
    commitment_three_quotes_cents: 50_000,
  };
  h.updates = [];
  h.inserts = [];
  h.rpcCalls = [];
});

// ---------------------------------------------------------------------------
describe("the self-approval refusal — the reason the feature exists", () => {
  // Since 0023 the approval is the DATABASE's to write: one function decides
  // whether this press is the first of two or the one that approves the
  // document, and stamps who and when. The action's job is to ask it, and to
  // turn its answer into a sentence — so what is under test here is that it
  // asks, with this program's id and this commitment's, and writes nothing
  // itself.
  test("approving somebody else's request goes through the database function", async () => {
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(url).toBe("/westfield/treasury/commitments?ok=approved");
    expect(h.rpcCalls).toEqual([
      {
        fn: "record_commitment_approval",
        args: { p_program_id: PROGRAM, p_commitment_id: COMMITMENT },
      },
    ]);
    expect(h.updates).toHaveLength(0);
  });

  // The first of two, above the program's second-approver amount. It must NOT
  // say "Approved." — the commitment is still a request, and a treasurer who
  // read otherwise would stop looking for the second signature.
  test("the first of two approvals says so, and does not claim the thing is approved", async () => {
    h.approvalResult = { data: "recorded", error: null };
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(paramOf(url, "ok")).toBe("approval_recorded");
  });

  // THE ONE THAT MATTERS. It is refused before any write, and the message is
  // about separation of duties rather than about a constraint.
  test("approving your OWN request is refused, and nothing is written", async () => {
    h.commitment = at("requested", { requested_by: ME });
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(paramOf(url, "error")).toBe("act_self");
    expect(h.updates).toHaveLength(0);
  });

  test("the refusal lands inside that commitment's own panel", async () => {
    h.commitment = at("requested", { requested_by: ME });
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(url).toContain(`edit=${COMMITMENT}`);
    expect(url).toContain(`#commitment-${COMMITMENT}`);
  });

  // Defence in depth: if the pre-check were ever removed, the CHECK constraint
  // still fires — and its plain check_violation must still read as the feature.
  test("a check_violation coming back from the database says the same thing", async () => {
    h.approvalResult = { data: null, error: { code: "23514" } };
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(paramOf(url, "error")).toBe("act_self");
  });

  test("OC023 — the same refusal raised by name — says it too", async () => {
    h.approvalResult = { data: null, error: { code: "OC023" } };
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "approve" }), "error"),
    ).toBe("act_self");
  });
});

// ---------------------------------------------------------------------------
// The two thresholds that BLOCK (spec 006 D6 / T177, migration 0023)
// ---------------------------------------------------------------------------
// A program sets three numbers. Two of them stop a write and one only nudges,
// and the difference is the whole design: a nudge that blocked would push the
// purchase somewhere this app cannot see (R5's lesson), and a block that only
// nudged would be a control in name.
describe("the amounts a program says need more than one signature", () => {
  test("over the second-approver amount, one approval is refused by name", async () => {
    h.approvalResult = { data: null, error: { code: "OC028" } };
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(paramOf(url, "error")).toBe("act_second");
    expect(h.updates).toHaveLength(0);
  });

  test("one person cannot be both of the two approvals", async () => {
    h.approvalResult = { data: null, error: { code: "OC030" } };
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "approve" }), "error"),
    ).toBe("act_twice");
  });

  // The board rule is re-checked HERE, in front of the write, so the treasurer
  // is told which field to fill in rather than handed a SQLSTATE. 0023's trigger
  // is the control; this is the sentence.
  test("over the board amount, issuing without the minutes is refused before the write", async () => {
    h.commitment = at("approved", { amount_cents: 150_000 });
    const url = await run(moveCommitment, { ...MOVE, act: "issue" });
    expect(paramOf(url, "error")).toBe("act_board");
    expect(h.updates).toHaveLength(0);
  });

  test("…and goes through once the minutes are on it", async () => {
    h.commitment = at("approved", {
      amount_cents: 150_000,
      board_minutes_ref: "Minutes of 12 Mar 2026, item 7",
    });
    const url = await run(moveCommitment, { ...MOVE, act: "issue" });
    expect(paramOf(url, "ok")).toBe("issued");
    expect(h.updates[0].issued_at).toBeTruthy();
  });

  // Shipping and tax are part of what was promised, so they are part of what a
  // threshold measures — a $980 order with $40 shipping is over $1,000.
  test("shipping and tax count toward the threshold", async () => {
    h.commitment = at("approved", {
      amount_cents: 98_000,
      shipping_cents: 3_000,
      tax_cents: 500,
    });
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "issue" }), "error"),
    ).toBe("act_board");
  });

  // Zero means OFF, and it has to mean off all the way through: a program that
  // turned the board rule off must not be blocked by it.
  test("a threshold set to zero blocks nothing", async () => {
    h.program = {
      commitment_second_approver_cents: 0,
      commitment_board_approval_cents: 0,
      commitment_three_quotes_cents: 0,
    };
    h.commitment = at("approved", { amount_cents: 5_000_000 });
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "issue" }), "ok"),
    ).toBe("issued");
  });

  // A program row that could not be read must fall back to the PROTECTIVE
  // numbers, never to zero: a threshold that silently reads as "off" is the one
  // failure this feature must not have.
  test("an unreadable program row falls back to the defaults, not to off", async () => {
    h.program = null;
    h.commitment = at("approved", { amount_cents: 150_000 });
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "issue" }), "error"),
    ).toBe("act_board");
  });
});

// ---------------------------------------------------------------------------
describe("the lifecycle refuses moves that are not next", () => {
  test("a request cannot be issued before it is approved", async () => {
    const url = await run(moveCommitment, { ...MOVE, act: "issue" });
    expect(paramOf(url, "error")).toBe("act_state");
    expect(h.updates).toHaveLength(0);
  });

  test("an already-approved request cannot be approved again", async () => {
    h.commitment = at("approved");
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(paramOf(url, "error")).toBe("act_state");
    expect(h.updates).toHaveLength(0);
  });

  test("a closed commitment makes no further moves", async () => {
    h.commitment = at("closed", { closed_at: "2026-07-01T00:00:00Z" });
    for (const act of ["approve", "issue", "close", "cancel"]) {
      expect(paramOf(await run(moveCommitment, { ...MOVE, act }), "error")).toBe(
        "act_state",
      );
    }
    expect(h.updates).toHaveLength(0);
  });

  test("a commitment that is not this program's is a different sentence", async () => {
    h.commitment = null;
    const url = await run(moveCommitment, { ...MOVE, act: "approve" });
    expect(paramOf(url, "error")).toBe("act_missing");
  });

  test("an unknown act never reaches the database", async () => {
    const url = await run(moveCommitment, { ...MOVE, act: "delete" });
    expect(paramOf(url, "error")).toBe("act");
    expect(h.updates).toHaveLength(0);
  });

  // `revise` is an INSERT, not an UPDATE. Posting it to the mover must not fall
  // through into a status write.
  test("'revise' posted to the mover is refused rather than written", async () => {
    const url = await run(moveCommitment, { ...MOVE, act: "revise" });
    expect(paramOf(url, "error")).toBe("act");
    expect(h.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("closing releases the remainder, and records how much (R4)", () => {
  const CLOSE = { ...MOVE, act: "close", reason: "Delivered in full" };

  beforeEach(() => {
    h.commitment = at("issued");
  });

  test("the released amount comes from SQL, not from a sum over fetched rows", async () => {
    h.drawResult = { data: [{ remaining_cents: "15000" }], error: null };
    await run(moveCommitment, CLOSE);
    expect(h.rpcCalls[0].fn).toBe("commitment_drawdown_rows");
    expect(h.rpcCalls[0].args.p_commitment_ids).toEqual([COMMITMENT]);
    expect(h.updates[0].released_cents).toBe(15000);
    expect(h.updates[0].status).toBe("closed");
    expect(h.updates[0].close_reason).toBe("Delivered in full");
  });

  // A false zero here would be permanent: it is written onto the closed document
  // and read back as "nothing went back to the budget line".
  test("a failed read records NULL, never $0.00", async () => {
    h.drawResult = { data: null, error: { code: "XX000" } };
    await run(moveCommitment, CLOSE);
    expect(h.updates[0].released_cents).toBeNull();
  });

  test("a garbage figure is also NULL rather than NaN or zero", async () => {
    h.drawResult = { data: [{ remaining_cents: "abc" }], error: null };
    await run(moveCommitment, CLOSE);
    expect(h.updates[0].released_cents).toBeNull();
  });

  test("closing and cancelling both need a reason", async () => {
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "close" }), "error"),
    ).toBe("act_reason");
    expect(
      paramOf(await run(moveCommitment, { ...MOVE, act: "cancel" }), "error"),
    ).toBe("act_reason");
    expect(h.updates).toHaveLength(0);
  });

  // A closed document drops out of the default open-only list, so landing on
  // "Closed." over a row that just vanished would be the worst of both. The
  // redirect opens the full list on that row, where what it released is written.
  test("it lands back on the row it closed, in the list that still shows it", async () => {
    h.drawResult = { data: [{ remaining_cents: "15000" }], error: null };
    const url = await run(moveCommitment, CLOSE);
    expect(paramOf(url, "ok")).toBe("closed");
    expect(paramOf(url, "all")).toBe("1");
    expect(paramOf(url, "edit")).toBe(COMMITMENT);
  });
});

// ---------------------------------------------------------------------------
describe("raising a request", () => {
  const FIELDS = {
    programId: PROGRAM,
    slug: "westfield",
    seasonId: SEASON,
    kind: "spending",
    funding_source: "district",
    vendor: "Premiere Costume Co",
    purpose: "Premiere costumes — spring set",
    amount: "3,200.00",
    budget_line_id: LINE,
  };

  test("a request that lands says what it did to the budget line", async () => {
    const url = await run(createCommitment, FIELDS);
    expect(url).toBe("/westfield/treasury/commitments?ok=created");
    expect(h.inserts[0].amount_cents).toBe(320000);
    expect(h.inserts[0].kind).toBe("spending");
    expect(h.inserts[0].funding_source).toBe("district");
  });

  // Sequential per program PER FUNDING SOURCE, assigned by the database. A form
  // that could name it could put a booster's spending under the district's
  // numbering, which is the thing the two purses exist to prevent.
  test("the number is never sent from the form", async () => {
    await run(createCommitment, FIELDS);
    expect(Object.hasOwn(h.inserts[0], "number")).toBe(false);
  });

  // R8, in the one place a form could ever introduce it.
  test("no student id is written, under any name", async () => {
    await run(createCommitment, { ...FIELDS, student_id: "s-1" });
    for (const key of Object.keys(h.inserts[0])) {
      expect(key).not.toContain("student");
    }
  });

  test("a commitment is born a REQUEST — no approval rides in on the insert", async () => {
    await run(createCommitment, {
      ...FIELDS,
      status: "approved",
      approved_by: ME,
    });
    const row = h.inserts[0];
    expect(Object.hasOwn(row, "status")).toBe(false);
    expect(Object.hasOwn(row, "approved_by")).toBe(false);
    expect(Object.hasOwn(row, "approved_at")).toBe(false);
  });

  test("shipping and tax default to zero rather than to nothing", async () => {
    await run(createCommitment, FIELDS);
    expect(h.inserts[0].shipping_cents).toBe(0);
    expect(h.inserts[0].tax_cents).toBe(0);
  });

  // R6: allowed, and marked.
  test("'recorded after the purchase' is carried through as a flag", async () => {
    await run(createCommitment, { ...FIELDS, after_the_fact: "1" });
    expect(h.inserts[0].after_the_fact).toBe(true);
    await run(createCommitment, FIELDS);
    expect(h.inserts[1].after_the_fact).toBe(false);
  });

  test("an amount of zero never reaches the database", async () => {
    const url = await run(createCommitment, { ...FIELDS, amount: "0" });
    expect(paramOf(url, "error")).toBe("create_amount");
    expect(h.inserts).toHaveLength(0);
  });

  test("a blank budget line never reaches the database", async () => {
    const url = await run(createCommitment, { ...FIELDS, budget_line_id: "" });
    expect(paramOf(url, "error")).toBe("create_line");
    expect(h.inserts).toHaveLength(0);
  });

  test("a need-by that is not a date is dropped rather than sent as junk", async () => {
    await run(createCommitment, { ...FIELDS, need_by: "next tuesday" });
    expect(h.inserts[0].need_by).toBeNull();
    await run(createCommitment, { ...FIELDS, need_by: "2026-09-01" });
    expect(h.inserts[1].need_by).toBe("2026-09-01");
  });

  test("each database refusal gets its own sentence", async () => {
    const cases: [string, string][] = [
      ["OC025", "create_line"],
      ["42501", "create_denied"],
    ];
    for (const [code, expected] of cases) {
      h.writeError = { code };
      expect(paramOf(await run(createCommitment, FIELDS), "error"), code).toBe(
        expected,
      );
    }
  });

  // An app deployed ahead of the migration sees codes it does not know. It must
  // degrade to a sentence, not to a blank or a crash.
  test("an unknown code falls back to the generic message", async () => {
    h.writeError = { code: "XX999" };
    expect(paramOf(await run(createCommitment, FIELDS), "error")).toBe("create");
  });
});

// ---------------------------------------------------------------------------
describe("a change is a revision, never an edit (R2)", () => {
  const REVISE = {
    programId: PROGRAM,
    slug: "westfield",
    commitmentId: COMMITMENT,
    amount: "3,500.00",
  };

  beforeEach(() => {
    h.commitment = {
      ...at("approved"),
      kind: "spending",
      funding_source: "district",
      vendor: "Premiere Costume Co",
      purpose: "Premiere costumes — spring set",
      need_by: "2026-09-01",
      after_the_fact: false,
      external_ref: "24-01187",
    };
  });

  test("it INSERTS a new row pointing at the original — nothing is updated", async () => {
    const url = await run(reviseCommitment, REVISE);
    expect(url).toBe("/westfield/treasury/commitments?ok=revised");
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].revision_of_id).toBe(COMMITMENT);
    expect(h.inserts[0].amount_cents).toBe(350000);
  });

  // A revision is the SAME DOCUMENT restated. Changing the purse it comes out of
  // would move a booster's spending under the district's numbering.
  test("it keeps the original's kind, funding source, season and line", async () => {
    await run(reviseCommitment, REVISE);
    expect(h.inserts[0].kind).toBe("spending");
    expect(h.inserts[0].funding_source).toBe("district");
    expect(h.inserts[0].season_id).toBe(SEASON);
    expect(h.inserts[0].budget_line_id).toBe(LINE);
  });

  test("a closed commitment has nothing to restate", async () => {
    h.commitment = { ...at("closed", { closed_at: "2026-07-01T00:00:00Z" }) };
    const url = await run(reviseCommitment, REVISE);
    expect(paramOf(url, "error")).toBe("revise_state");
    expect(h.inserts).toHaveLength(0);
  });

  test("an amount of zero never reaches the database", async () => {
    const url = await run(reviseCommitment, { ...REVISE, amount: "0" });
    expect(paramOf(url, "error")).toBe("revise_amount");
    expect(h.inserts).toHaveLength(0);
  });

  test("each database refusal gets its own sentence", async () => {
    const cases: [string, string][] = [
      ["OC026", "revise_state"],
      ["OC027", "revise_shape"],
      ["42501", "revise_denied"],
    ];
    for (const [code, expected] of cases) {
      h.writeError = { code };
      expect(paramOf(await run(reviseCommitment, REVISE), "error"), code).toBe(
        expected,
      );
    }
  });
});
