// ============================================================================
// Unit tests — the two writes that decide what a family can see
// ----------------------------------------------------------------------------
// Publishing an itinerary is THE gate for parent visibility (invariant §9.3),
// and accepting an AI parse onto one is the boundary Constitution IV draws. Two
// confirmed defects lived on that gate, and neither shows up in a screenshot:
//
// 1. PUBLISH AND UNPUBLISH THREW THEIR RESULT AWAY. `await supabase.update(…)`
//    with nothing read off it: PostgREST answers a write that MATCHED NOTHING
//    exactly like one that succeeded — null error, zero rows — and on this table
//    RLS is the real gate (an archived season, a seat that may not write). So
//    publish went on to mint a live public URL and told the director "families
//    can see it now" over an itinerary that was still a draft; unpublish told
//    them the times were private while families were still reading them. The
//    fix is the `.select("id")` + zero-rows-is-failure pattern the absences
//    queue already uses.
// 2. ACCEPTING A PARSE ONTO A PUBLISHED ITINERARY replaced what families were
//    reading in one click, on a screen that promised "nothing here reaches a
//    parent until you accept it and then publish". It takes an explicit second
//    yes now — required by the ACTION, not just rendered by the page, because a
//    form is a thing anyone can post. And the "replace the items" delete was
//    unchecked, so a refused delete left the insert to APPEND: every old line
//    twice over on a live schedule.
//
// No DB and no network: the module boundary is replaced with recorders.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const COMPETITION = "22222222-2222-2222-2222-222222222222";
const ITINERARY = "33333333-3333-3333-3333-333333333333";
const ITEM = "44444444-4444-4444-4444-444444444444";
const PARSE = "55555555-5555-5555-5555-555555555555";

const h = vi.hoisted(() => ({
  // How many rows each kind of write comes back with. Zero is the case the old
  // code could not tell apart from success.
  updateRows: 1,
  deleteRows: 1,
  // A refused delete — the "replace" half of acceptParse failing on its own.
  deleteError: false,
  // What the competition's itinerary status is when acceptParse looks.
  itineraryStatus: "draft" as string,
  writes: [] as { table: string; op: string; payload: unknown }[],
  minted: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireRole: async () => ({ user: { id: "u1" } }),
}));
vi.mock("@/lib/tokens", () => ({
  mintShareLink: async () => {
    h.minted += 1;
    return { raw: "tok" };
  },
  revokeShareLinksForResource: async () => undefined,
  // No links yet, and the listing succeeded — so a publish that lands mints one.
  activeShareLinks: async () => ({ links: [], unavailable: false }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { url?: string };
    err.url = url;
    throw err;
  },
}));

vi.mock("@/lib/supabase/server", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));

  const builderFor = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: unknown = {};

    const settle = (): unknown => {
      if (op === "update") {
        h.writes.push({ table, op, payload });
        return { data: rows(h.updateRows), error: null };
      }
      if (op === "insert") {
        h.writes.push({ table, op, payload });
        return { data: rows(1), error: null };
      }
      if (op === "delete") {
        h.writes.push({ table, op, payload: null });
        return {
          data: h.deleteError ? null : rows(h.deleteRows),
          error: h.deleteError ? { message: "refused" } : null,
        };
      }
      // Reads. Every id a form posts is resolved in-program first; the fixture
      // owns all of them, so these tests exercise the WRITE paths.
      if (table === "itineraries") {
        return {
          data: { id: ITINERARY, status: h.itineraryStatus },
          error: null,
        };
      }
      if (table === "itinerary_items") return { data: { id: ITEM }, error: null };
      if (table === "packet_parses") {
        return { data: { id: PARSE }, error: null };
      }
      return { data: { id: String(filters.id ?? "x") }, error: null };
    };

    const builder = {
      select: () => builder,
      update: (p: unknown) => {
        op = "update";
        payload = p;
        return builder;
      },
      insert: (p: unknown) => {
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
      is: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      then: (onOk: (value: unknown) => unknown, onErr?: (r: unknown) => unknown) =>
        Promise.resolve(settle()).then(onOk, onErr),
    };
    return builder;
  };
  return {
    createClient: async () => ({ from: (table: string) => builderFor(table) }),
  };
});

import {
  publishItinerary,
  unpublishItinerary,
  updateItineraryItem,
  deleteItineraryItem,
} from "@/app/(app)/[program]/competitions/[competitionId]/itinerary/actions";
import { acceptParse } from "@/app/(app)/[program]/competitions/[competitionId]/packet/[parseId]/review/actions";
import { ACCEPT_LIVE_CONFIRM } from "@/app/(app)/[program]/competitions/[competitionId]/packet/[parseId]/review/shared";

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

const base = {
  programId: PROGRAM,
  slug: "westfield",
  competitionId: COMPETITION,
  itineraryId: ITINERARY,
  tz: "America/Chicago",
};

beforeEach(() => {
  h.updateRows = 1;
  h.deleteRows = 1;
  h.deleteError = false;
  h.itineraryStatus = "draft";
  h.writes = [];
  h.minted = 0;
});

// ---------------------------------------------------------------------------
describe("publish only says families can see it when they can", () => {
  test("the write lands → published, and a broadcast link is minted", async () => {
    const url = await run(publishItinerary, base);
    expect(url).toContain("ok=published");
    expect(url).toContain("share=tok");
    expect(h.minted).toBe(1);
  });

  test("the write matched NO rows → a refusal, and no live URL is created", async () => {
    h.updateRows = 0;
    const url = await run(publishItinerary, base);
    expect(url).toBe("/westfield/competitions/" + COMPETITION + "/itinerary?error=publish");
    // The whole point: a public no-login URL must not exist for a schedule that
    // was never published.
    expect(h.minted).toBe(0);
    expect(url).not.toContain("ok=published");
  });

  test("unpublish is the same gate read the other way", async () => {
    h.updateRows = 0;
    const url = await run(unpublishItinerary, base);
    expect(url).toContain("error=unpublish");
    expect(url).not.toContain("ok=unpublished");
  });

  test("and unpublish succeeds when the write lands", async () => {
    const url = await run(unpublishItinerary, base);
    expect(url).toContain("ok=unpublished");
  });
});

// ---------------------------------------------------------------------------
// The same null-error-zero-rows hole, one level down: an item edit that RLS
// filtered away reported "Item saved." and the director walked off believing a
// changed call time had landed.
describe("an item write that matched nothing is a failure", () => {
  test("saving an item", async () => {
    h.updateRows = 0;
    const url = await run(updateItineraryItem, {
      ...base,
      itemId: ITEM,
      kind: "warmup",
      title: "Warm-up",
      starts_at: "2026-03-14T08:00",
      sort_order: "1",
    });
    expect(url).toContain("error=save");
    expect(url).toContain(`edit=${ITEM}`);
  });

  test("removing an item", async () => {
    h.deleteRows = 0;
    const url = await run(deleteItineraryItem, { ...base, itemId: ITEM });
    expect(url).toContain("error=remove");
  });
});

// ---------------------------------------------------------------------------
describe("accepting a parse onto a PUBLISHED itinerary", () => {
  const acceptFields = {
    programId: PROGRAM,
    slug: "westfield",
    competitionId: COMPETITION,
    parseId: PARSE,
    count: "1",
    item_0_include: "1",
    item_0_title: "Call time",
    item_0_kind: "call",
    item_0_starts_at: "2026-03-14T07:30",
    tz: "America/Chicago",
  };

  test("is refused without the explicit confirm, before anything is deleted", async () => {
    h.itineraryStatus = "published";
    const url = await run(acceptParse, acceptFields);
    expect(url).toContain("error=confirm");
    // Nothing was replaced: the families' schedule is exactly as it was.
    expect(h.writes).toHaveLength(0);
  });

  test("goes through with it, and says the times are LIVE — not 'then publish'", async () => {
    h.itineraryStatus = "published";
    const url = await run(acceptParse, {
      ...acceptFields,
      confirm: ACCEPT_LIVE_CONFIRM,
    });
    expect(url).toContain("ok=accepted_live");
    expect(url).not.toContain("ok=accepted&");
    expect(h.writes.some((w) => w.op === "delete")).toBe(true);
    expect(h.writes.some((w) => w.op === "insert")).toBe(true);
  });

  test("a wrong confirm value is no confirm at all", async () => {
    h.itineraryStatus = "published";
    const url = await run(acceptParse, { ...acceptFields, confirm: "yes" });
    expect(url).toContain("error=confirm");
    expect(h.writes).toHaveLength(0);
  });

  test("a DRAFT itinerary needs no confirm, and still promises the publish step", async () => {
    h.itineraryStatus = "draft";
    const url = await run(acceptParse, acceptFields);
    expect(url).toContain("ok=accepted");
    expect(url).not.toContain("accepted_live");
  });

  test("a refused delete does not become an append", async () => {
    // "Replace the items" is the whole contract. With the delete refused and
    // the insert allowed to proceed, the competition's schedule carried every
    // old line PLUS the new ones — on a live page, silently.
    h.deleteError = true;
    const url = await run(acceptParse, acceptFields);
    expect(url).toContain("error=itinerary");
    expect(h.writes.some((w) => w.op === "insert")).toBe(false);
  });
});
