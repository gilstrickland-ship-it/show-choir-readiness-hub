// ============================================================================
// Unit tests — the two comms writes that reach a parent's inbox
// ----------------------------------------------------------------------------
// 1. reviewDigest (Constitution IV). An AI writes the weekly digest; a human
//    approves it before a family reads it. That is only true if what the human
//    approved is what the human was LOOKING AT. Approve and Send used to be
//    sibling forms carrying nothing but a digest id, while the editable body sat
//    in a third form — so a director who corrected the AI's text and pressed
//    Approve approved the STORED row and lost their edits to the redirect's
//    re-render. Send could then deliver un-reviewed AI text to every guardian.
//    These pin the property that fixes it: the subject and body posted with the
//    press are persisted BEFORE any status flips, and a flip that cannot be
//    preceded by a successful save does not happen at all.
//
// 2. sendAnnouncement's `announcements` flag re-check (spec 005 US9-4,
//    Constitution VIII). The page 404s when the flag is off, so the only way to
//    reach the action with the channel disabled is to POST to the action itself
//    — which is exactly the case a server-side flag exists to hold, and it had
//    no coverage at all.
//
// No DB and no network: the module boundary under both actions (Supabase, auth,
// next/navigation, next/cache, the send core, Inngest) is replaced with
// recorders, so these run in milliseconds under vitest.unit.config.ts.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const DIGEST = "22222222-2222-2222-2222-222222222222";
const SEASON = "33333333-3333-3333-3333-333333333333";

interface Write {
  table: string;
  op: "update" | "insert" | "delete";
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  writes: [] as {
    table: string;
    op: "update" | "insert" | "delete";
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }[],
  // The stored digest row, as the database would answer for it.
  digestStatus: "draft" as string,
  // When true the update matches no row (already sent, or another program's).
  saveMatchesNothing: false,
  // programs row for the announcements flag re-check.
  programTier: "program" as string,
  programOverrides: null as Record<string, boolean> | null,
  sendCoreCalls: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/auth", () => ({
  requireRole: async () => ({ user: { id: "u1" } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { url?: string };
    err.url = url;
    throw err;
  },
}));

vi.mock("@/lib/inngest/client", () => ({
  inngestEnabled: () => false,
  inngest: { send: async () => undefined },
}));

vi.mock("@/lib/comms-send", () => ({
  sendDigestCore: async () => {
    h.sendCoreCalls += 1;
    return { sent: 3, skipped: 0, failed: 0 };
  },
  sendAnnouncementCore: async () => {
    h.sendCoreCalls += 1;
    return { sent: 3, skipped: 0, failed: 0 };
  },
}));

// A PostgREST-shaped recorder. Every write is captured IN ORDER, which is the
// whole point for the digest: "the body was saved before the status flipped" is
// a claim about order, not about two writes happening.
vi.mock("@/lib/supabase/server", () => {
  const builderFor = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: Record<string, unknown> = {};

    const settle = (): unknown => {
      if (op === "update" || op === "insert" || op === "delete") {
        h.writes.push({ table, op, payload, filters });
        if (table === "digests") {
          // A save that matches nothing (the row is 'sent', or not ours).
          if (op === "update" && Object.hasOwn(payload, "body_md")) {
            return h.saveMatchesNothing
              ? { data: null, error: null }
              : { data: { id: DIGEST, status: h.digestStatus }, error: null };
          }
          // The approve flip: matched only while the row is still a draft.
          if (op === "update" && payload.status === "approved") {
            return filters.status === "draft" && h.digestStatus === "draft"
              ? { data: { id: DIGEST }, error: null }
              : { data: null, error: null };
          }
        }
        if (table === "announcements" && op === "insert") {
          return { data: { id: "ann-1" }, error: null };
        }
        return { data: null, error: null };
      }
      if (table === "digests") return { data: { status: h.digestStatus }, error: null };
      if (table === "programs") {
        return {
          data: { tier: h.programTier, feature_overrides: h.programOverrides },
          error: null,
        };
      }
      // Every in-program id resolution answers "yes, ours".
      return { data: { id: String(filters.id ?? "x") }, error: null };
    };

    const builder = {
      select: () => builder,
      update: (p: Record<string, unknown>) => {
        op = "update";
        payload = p;
        return builder;
      },
      insert: (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return builder;
      },
      neq: (key: string, value: unknown) => {
        filters[`neq:${key}`] = value;
        return builder;
      },
      maybeSingle: () => builder,
      then: (onOk: (value: unknown) => unknown, onErr?: (r: unknown) => unknown) =>
        Promise.resolve(settle()).then(onOk, onErr),
    };
    return builder;
  };

  return {
    createClient: async () => ({ from: (table: string) => builderFor(table) }),
  };
});

import { reviewDigest } from "@/app/(app)/[program]/comms/digest/actions";
import { sendAnnouncement } from "@/app/(app)/[program]/comms/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run(
  action: (fd: FormData) => Promise<void>,
  fields: Record<string, string>,
): Promise<{ redirectedTo: string; writes: Write[] }> {
  let redirectedTo = "";
  try {
    await action(form(fields));
  } catch (e) {
    redirectedTo = (e as Error & { url?: string }).url ?? "";
  }
  return { redirectedTo, writes: h.writes };
}

const EDITED_BODY =
  "The bus leaves at 5:45am, not 6:45am. Please double-check the time.";

const digestForm = (intent: string, over: Record<string, string> = {}) => ({
  programId: PROGRAM,
  slug: "westfield",
  digestId: DIGEST,
  seasonId: SEASON,
  subject: "Week of March 2 — corrected",
  body_md: EDITED_BODY,
  intent,
  ...over,
});

beforeEach(() => {
  h.writes = [];
  h.digestStatus = "draft";
  h.saveMatchesNothing = false;
  h.programTier = "program";
  h.programOverrides = null;
  h.sendCoreCalls = 0;
});

// ---------------------------------------------------------------------------
describe("reviewDigest — approving what is on screen (Constitution IV)", () => {
  const savedBody = (writes: Write[]) =>
    writes.find((w) => w.table === "digests" && Object.hasOwn(w.payload, "body_md"));

  test("save writes the posted subject and body, and flips nothing", () => {
    return run(reviewDigest, digestForm("save")).then(({ redirectedTo, writes }) => {
      expect(savedBody(writes)?.payload).toMatchObject({
        subject: "Week of March 2 — corrected",
        body_md: EDITED_BODY,
      });
      expect(writes.some((w) => w.payload.status === "approved")).toBe(false);
      expect(redirectedTo).toContain("saved=1");
    });
  });

  // THE DEFECT, PINNED. Approve used to carry only the id, so the edits in the
  // box were never written and the STORED row was approved instead.
  test("approve persists the edited body BEFORE it flips the status", async () => {
    const { redirectedTo, writes } = await run(reviewDigest, digestForm("approve"));

    const bodyWriteIndex = writes.findIndex(
      (w) => w.table === "digests" && Object.hasOwn(w.payload, "body_md"),
    );
    const approveIndex = writes.findIndex((w) => w.payload.status === "approved");

    expect(bodyWriteIndex).toBeGreaterThanOrEqual(0);
    expect(approveIndex).toBeGreaterThanOrEqual(0);
    // Order is the property: the approval is of text already stored.
    expect(bodyWriteIndex).toBeLessThan(approveIndex);
    expect(writes[bodyWriteIndex].payload.body_md).toBe(EDITED_BODY);
    expect(redirectedTo).toContain("approved=1");
  });

  test("send persists the edited body BEFORE the send core ever runs", async () => {
    h.digestStatus = "approved";
    const { redirectedTo, writes } = await run(reviewDigest, digestForm("send"));

    expect(savedBody(writes)?.payload.body_md).toBe(EDITED_BODY);
    expect(h.sendCoreCalls).toBe(1);
    expect(redirectedTo).toContain("done=1");
  });

  // If the save cannot land, neither may the approval — otherwise the flip is
  // once again about a body nobody agreed to.
  test("a save that matches no row approves nothing", async () => {
    h.saveMatchesNothing = true;
    const { redirectedTo, writes } = await run(reviewDigest, digestForm("approve"));
    expect(writes.some((w) => w.payload.status === "approved")).toBe(false);
    expect(redirectedTo).toContain("error=save");
  });

  test("a save that matches no row sends nothing", async () => {
    h.digestStatus = "approved";
    h.saveMatchesNothing = true;
    const { redirectedTo } = await run(reviewDigest, digestForm("send"));
    expect(h.sendCoreCalls).toBe(0);
    expect(redirectedTo).toContain("error=save");
  });

  test("an empty body is never saved, approved or sent", async () => {
    const { redirectedTo, writes } = await run(
      reviewDigest,
      digestForm("approve", { body_md: "   " }),
    );
    expect(writes).toHaveLength(0);
    expect(redirectedTo).toContain("error=empty");
  });

  // Approve and send stay TWO presses: one intent per submit, and `send` refuses
  // a digest that is not already approved.
  test("send on a draft is refused — approval is a separate press", async () => {
    h.digestStatus = "draft";
    const { redirectedTo } = await run(reviewDigest, digestForm("send"));
    expect(h.sendCoreCalls).toBe(0);
    expect(redirectedTo).toContain("error=notapproved");
  });

  test("approve on a row that is no longer a draft flips nothing", async () => {
    h.digestStatus = "approved";
    const { redirectedTo, writes } = await run(reviewDigest, digestForm("approve"));
    // The edits still saved — they were the reviewer's work — but the status
    // did not move, and the page says so.
    expect(savedBody(writes)?.payload.body_md).toBe(EDITED_BODY);
    expect(redirectedTo).toContain("error=notdraft");
  });

  test("a submit with no recognised intent changes nothing", async () => {
    const { redirectedTo, writes } = await run(
      reviewDigest,
      digestForm("publish-everywhere"),
    );
    expect(writes).toHaveLength(0);
    expect(redirectedTo).toContain("error=intent");
  });

  test("a submit that names no digest changes nothing", async () => {
    const { redirectedTo, writes } = await run(
      reviewDigest,
      digestForm("approve", { digestId: "" }),
    );
    expect(writes).toHaveLength(0);
    expect(redirectedTo).toContain("error=intent");
  });
});

// ---------------------------------------------------------------------------
describe("sendAnnouncement — the announcements flag holds at the action", () => {
  const announcementForm = {
    programId: PROGRAM,
    slug: "westfield",
    seasonId: SEASON,
    subject: "Call time moved",
    body_md: "Be at the school by 5:45am.",
  };

  test("flag on: the announcement is written and the fan-out runs", async () => {
    const { redirectedTo, writes } = await run(sendAnnouncement, announcementForm);
    expect(writes.some((w) => w.table === "announcements" && w.op === "insert")).toBe(
      true,
    );
    expect(h.sendCoreCalls).toBe(1);
    expect(redirectedTo).toContain("done=1");
  });

  // A POST straight at the action is the ONLY way to reach this line with the
  // channel off (the route 404s), which is precisely the case the re-check is
  // for. Nothing may be written and nothing may be mailed.
  test("flag off by per-program override: nothing is written, nothing is mailed", async () => {
    h.programOverrides = { announcements: false };
    const { redirectedTo, writes } = await run(sendAnnouncement, announcementForm);
    expect(writes.some((w) => w.table === "announcements")).toBe(false);
    expect(h.sendCoreCalls).toBe(0);
    expect(redirectedTo).toBe("/westfield/comms");
  });

  test("an unreadable programs row fails CLOSED, not open", async () => {
    // The action defaults a missing row to the leanest tier rather than assuming
    // the channel is on — a flag that cannot be read is a flag that is off.
    h.programTier = "prep";
    h.programOverrides = { announcements: false };
    const { writes } = await run(sendAnnouncement, announcementForm);
    expect(writes.some((w) => w.table === "announcements")).toBe(false);
  });

  test("an empty body never reaches the flag check or the database", async () => {
    const { redirectedTo, writes } = await run(sendAnnouncement, {
      ...announcementForm,
      body_md: "",
    });
    expect(writes).toHaveLength(0);
    expect(h.sendCoreCalls).toBe(0);
    expect(redirectedTo).toContain("error=empty");
  });
});
