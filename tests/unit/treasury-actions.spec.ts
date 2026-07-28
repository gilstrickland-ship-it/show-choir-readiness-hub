// ============================================================================
// Unit tests — what the ledger writes TELL the treasurer, and what they leave
// behind when they fail
// ----------------------------------------------------------------------------
// The 0019 money functions are atomic and correct. What they were not is
// legible: categorize_ledger_entry returned NULL for three unrelated outcomes,
// void_ledger_entry returned `false` for two, and add_ledger_entry raised one
// code for five distinct guards. The action collapsed each set into a single
// sentence, so a DOUBLE SUBMIT of "Save the line" reported "Nothing changed —
// the entry is still there, uncategorized" about a filing that had just worked,
// and a competition tagged from last season came back as advice about the amount
// format. Migration 0020 gives every outcome its own SQLSTATE; these pin that
// the action branches on the CODE and says the right thing.
//
// Also pinned here: the receipt upload happened BEFORE the rpc, so a refused
// write stranded the object in the bucket forever, attached to nothing.
//
// No DB and no network: the module boundary is replaced with recorders.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const SEASON = "22222222-2222-2222-2222-222222222222";
const ENTRY = "33333333-3333-3333-3333-333333333333";
const LINE = "44444444-4444-4444-4444-444444444444";
const COMMITMENT = "55555555-5555-5555-5555-555555555555";

const h = vi.hoisted(() => ({
  // What the rpc answers with: either data, or an error carrying a SQLSTATE.
  rpcResult: { data: null as unknown, error: null as { code?: string } | null },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  uploaded: [] as string[],
  removed: [] as string[][],
  uploadFails: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireRole: async () => ({ user: { id: "u1" } }) }));

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
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = (key: string, value: unknown) => {
      filters[key] = value;
      return builder;
    };
    builder.maybeSingle = () => builder;
    builder.then = (onOk: (v: unknown) => unknown) => {
      // Every in-program resolution answers "ours"; the branches under test are
      // the rpc's, not the pre-checks'.
      if (table === "programs") {
        return Promise.resolve({ data: { timezone: "America/Chicago" } }).then(onOk);
      }
      if (table === "budget_lines") {
        return Promise.resolve({
          data: { id: filters.id, category_id: "cat" },
        }).then(onOk);
      }
      if (table === "budget_categories") {
        return Promise.resolve({ data: { budget_id: "bud" } }).then(onOk);
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
        return h.rpcResult;
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            if (h.uploadFails) return { error: { message: "boom" } };
            h.uploaded.push(path);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            h.removed.push(paths);
            return { error: null };
          },
        }),
      },
    }),
  };
});

import {
  addEntry,
  voidEntry,
  categorizeEntry,
} from "@/app/(app)/[program]/treasury/actions";

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run(
  action: (fd: FormData) => Promise<void>,
  fields: Record<string, string | File>,
): Promise<string> {
  try {
    await action(form(fields));
  } catch (e) {
    return (e as Error & { url?: string }).url ?? "";
  }
  return "";
}

const errorCodeOf = (url: string): string | null =>
  new URL(url, "https://x.test").searchParams.get("error");

beforeEach(() => {
  h.rpcResult = { data: null, error: null };
  h.rpcCalls = [];
  h.uploaded = [];
  h.removed = [];
  h.uploadFails = false;
});

// ---------------------------------------------------------------------------
describe("categorizeEntry — a double submit says ALREADY FILED", () => {
  const fields = {
    programId: PROGRAM,
    slug: "westfield",
    entryId: ENTRY,
    budget_line_id: LINE,
  };

  test("a filing that lands redirects to Saved", async () => {
    h.rpcResult = { data: "new-entry-id", error: null };
    const url = await run(categorizeEntry, fields);
    expect(url).toBe("/westfield/treasury?ok=saved");
  });

  // THE DEFECT. OC002 is "already on a line" / "already filed" — the second
  // press of the same button. It used to be indistinguishable from every other
  // failure, so the UI told the treasurer their filing did nothing.
  test("OC002 becomes the 'already filed' message, on the row", async () => {
    h.rpcResult = { data: null, error: { code: "OC002" } };
    const url = await run(categorizeEntry, fields);
    expect(errorCodeOf(url)).toBe("categorize_already");
    expect(url).toContain(`edit=${ENTRY}`);
    expect(url).toContain(`#fix-${ENTRY}`);
  });

  test("each remaining outcome gets its own message", async () => {
    const cases: [string, string][] = [
      ["OC001", "categorize_missing"],
      ["OC003", "categorize_voided"],
      ["OC011", "categorize_archived"],
      ["OC012", "categorize_line"],
    ];
    for (const [code, expected] of cases) {
      h.rpcResult = { data: null, error: { code } };
      expect(errorCodeOf(await run(categorizeEntry, fields)), code).toBe(expected);
    }
  });

  // An app deployed ahead of the migration sees codes it does not know. It must
  // degrade to today's sentence, not to a blank or a crash.
  test("an unknown code falls back to the generic message", async () => {
    h.rpcResult = { data: null, error: { code: "XX999" } };
    expect(errorCodeOf(await run(categorizeEntry, fields))).toBe("categorize");
  });

  test("a blank line never reaches the database", async () => {
    const url = await run(categorizeEntry, { ...fields, budget_line_id: "" });
    expect(h.rpcCalls).toHaveLength(0);
    expect(errorCodeOf(url)).toBe("categorize");
  });
});

// ---------------------------------------------------------------------------
describe("voidEntry — 'not yours' and 'already voided' are different sentences", () => {
  const fields = {
    programId: PROGRAM,
    slug: "westfield",
    entryId: ENTRY,
    reason: "Wrong amount",
  };

  test("a void that lands redirects to Saved", async () => {
    h.rpcResult = { data: true, error: null };
    expect(await run(voidEntry, fields)).toBe("/westfield/treasury?ok=saved");
  });

  test("Void & redo carries the entry into a prefilled drawer", async () => {
    h.rpcResult = { data: true, error: null };
    const url = await run(voidEntry, { ...fields, reenter: "1" });
    expect(url).toContain(`reenter=${ENTRY}`);
    expect(url).toContain("#add-entry");
  });

  test("each refusal gets its own message, on the row", async () => {
    const cases: [string, string][] = [
      ["OC001", "void_missing"],
      ["OC003", "void_already"],
      ["OC011", "void_archived"],
    ];
    for (const [code, expected] of cases) {
      h.rpcResult = { data: null, error: { code } };
      const url = await run(voidEntry, fields);
      expect(errorCodeOf(url), code).toBe(expected);
      expect(url).toContain(`edit=${ENTRY}`);
    }
  });

  test("a missing reason never reaches the database", async () => {
    const url = await run(voidEntry, { ...fields, reason: "   " });
    expect(h.rpcCalls).toHaveLength(0);
    expect(errorCodeOf(url)).toBe("void_reason");
  });
});

// ---------------------------------------------------------------------------
describe("addEntry — the rejection names what it rejected", () => {
  const fields = {
    programId: PROGRAM,
    slug: "westfield",
    seasonId: SEASON,
    direction: "out",
    amount: "1,234.56",
    entry_date: "2026-03-02",
  };

  test("a saved entry redirects to Saved, in integer cents", async () => {
    h.rpcResult = { data: "new-entry-id", error: null };
    expect(await run(addEntry, fields)).toBe("/westfield/treasury?ok=saved");
    expect(h.rpcCalls[0].args.p_amount_cents).toBe(123456);
  });

  test("six guards, six sentences", async () => {
    const cases: [string, string][] = [
      ["OC010", "entry"],
      ["OC011", "entry_season"],
      ["OC012", "entry_line"],
      ["OC013", "entry_competition"],
      ["OC014", "entry_trip"],
      // The drawdown link (spec 006 R3) is resolved like every other tag, and
      // its rejection reads like every other tag's rather than as advice about
      // the amount format.
      ["OC016", "entry_commitment"],
    ];
    for (const [code, expected] of cases) {
      h.rpcResult = { data: null, error: { code } };
      expect(errorCodeOf(await run(addEntry, fields)), code).toBe(expected);
    }
  });

  // The link is what decrements a commitment's remaining balance. An action that
  // resolved it and then forgot to send it would leave every purchase order
  // reading as untouched while the money went out the door.
  test("the commitment the drawer picked is what reaches the database", async () => {
    h.rpcResult = { data: "new-entry-id", error: null };
    await run(addEntry, { ...fields, commitment_id: COMMITMENT });
    expect(h.rpcCalls[0].args.p_commitment_id).toBe(COMMITMENT);
  });

  test("an entry with nothing picked sends null, not an empty string", async () => {
    h.rpcResult = { data: "new-entry-id", error: null };
    await run(addEntry, fields);
    expect(h.rpcCalls[0].args.p_commitment_id).toBeNull();
  });

  test("an unknown code still reads as a save failure", async () => {
    h.rpcResult = { data: null, error: { code: "XX999" } };
    expect(errorCodeOf(await run(addEntry, fields))).toBe("entry");
  });
});

// ---------------------------------------------------------------------------
describe("addEntry — a refused write leaves no orphan receipt behind", () => {
  const receipt = () =>
    new File([new Uint8Array([1, 2, 3])], "invoice.pdf", { type: "application/pdf" });

  const fields = () => ({
    programId: PROGRAM,
    slug: "westfield",
    seasonId: SEASON,
    direction: "out",
    amount: "50.00",
    entry_date: "2026-03-02",
    receipt: receipt(),
  });

  test("the object is uploaded and kept when the entry lands", async () => {
    h.rpcResult = { data: "new-entry-id", error: null };
    await run(addEntry, fields());
    expect(h.uploaded).toHaveLength(1);
    expect(h.removed).toHaveLength(0);
    expect(h.rpcCalls[0].args.p_receipt_path).toBe(h.uploaded[0]);
  });

  // The defect: storage is written before the ledger, so a refused rpc used to
  // leave the file in the bucket with nothing pointing at it.
  test("the object is taken back out when the entry is refused", async () => {
    h.rpcResult = { data: null, error: { code: "OC012" } };
    await run(addEntry, fields());
    expect(h.uploaded).toHaveLength(1);
    expect(h.removed).toEqual([[h.uploaded[0]]]);
  });

  test("a redo's carried-forward receipt is NEVER deleted", async () => {
    // No file on this submit — the path comes off the entry being redone, and
    // that object still backs a row on the books.
    h.rpcResult = { data: null, error: { code: "OC012" } };
    await run(addEntry, {
      programId: PROGRAM,
      slug: "westfield",
      seasonId: SEASON,
      direction: "out",
      amount: "50.00",
      entry_date: "2026-03-02",
      redo_of: ENTRY,
    });
    expect(h.removed).toHaveLength(0);
  });
});
