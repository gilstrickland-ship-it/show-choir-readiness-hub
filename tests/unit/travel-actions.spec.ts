// ============================================================================
// Unit tests — updateTrip's field contract (spec 005 Wave 2)
// ----------------------------------------------------------------------------
// Two popovers post two different field sets to updateTrip: the Season spine's
// row-edit doesn't show the competition link and doesn't post it, and the trip
// page's Overview popover does. The action's rule is "write competition_id ONLY
// when the field was sent", and getting it wrong is silent data loss — a date
// fix from the spine used to cut a trip loose from its competition. That rule is
// invisible in the UI, so it is pinned here, together with the in-program check
// the value now passes before it is written.
//
// No DB and no network: the module boundary below updateTrip (Supabase, auth,
// next/navigation, next/cache) is replaced with recorders, so this still runs in
// milliseconds under vitest.unit.config.ts.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const TRIP = "22222222-2222-2222-2222-222222222222";
const COMP = "33333333-3333-3333-3333-333333333333";
const FOREIGN_COMP = "44444444-4444-4444-4444-444444444444";

// Shared with the module mocks below, which are hoisted above the imports.
const h = vi.hoisted(() => ({
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  competitionIds: [] as string[],
  roomCount: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/auth", () => ({ requireRole: async () => ({ user: { id: "u" } }) }));

// redirect() throws in Next, and every exit from the action goes through it —
// so the test reads the thrown target to learn which branch was taken.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { url?: string };
    err.url = url;
    throw err;
  },
}));

// A PostgREST-shaped recorder: chainable, thenable, and it answers the two reads
// updateTrip makes (the room head-count and the competition resolve) from the
// state in `h`.
vi.mock("@/lib/supabase/server", () => {
  const builderFor = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "select";
    let payload: Record<string, unknown> = {};

    const settle = (): unknown => {
      if (op === "update") {
        h.updates.push({ table, payload });
        return { data: null, error: null };
      }
      if (table === "travel_groups") {
        return { count: h.roomCount, data: null, error: null };
      }
      if (table === "competitions") {
        const id = String(filters.id ?? "");
        const inProgram = filters.program_id === PROGRAM;
        const found = inProgram && h.competitionIds.includes(id);
        return { data: found ? { id } : null, error: null };
      }
      return { data: null, error: null };
    };

    const builder = {
      select: () => builder,
      update: (p: Record<string, unknown>) => {
        op = "update";
        payload = p;
        return builder;
      },
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return builder;
      },
      maybeSingle: () => builder,
      then: (
        onOk: (value: unknown) => unknown,
        onErr?: (reason: unknown) => unknown,
      ) => Promise.resolve(settle()).then(onOk, onErr),
    };
    return builder;
  };

  return {
    createClient: async () => ({ from: (table: string) => builderFor(table) }),
  };
});

import { updateTrip } from "@/app/(app)/[program]/travel/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// Run the action to its redirect and hand back both the target and whatever it
// wrote on the way.
async function run(fields: Record<string, string>): Promise<{
  redirectedTo: string;
  tripUpdate: Record<string, unknown> | undefined;
}> {
  let redirectedTo = "";
  try {
    await updateTrip(form(fields));
  } catch (e) {
    redirectedTo = (e as Error & { url?: string }).url ?? "";
  }
  return {
    redirectedTo,
    tripUpdate: h.updates.find((u) => u.table === "trips")?.payload,
  };
}

const base = {
  programId: PROGRAM,
  slug: "westfield",
  tripId: TRIP,
  name: "Nationals",
  starts_on: "2026-03-12",
  ends_on: "2026-03-14",
  is_overnight: "on",
};

beforeEach(() => {
  h.updates = [];
  h.competitionIds = [COMP];
  h.roomCount = 0;
});

describe("updateTrip — competition_id presence gating", () => {
  test("field absent ⇒ the link is left untouched", async () => {
    const { tripUpdate } = await run(base);
    expect(tripUpdate).toBeDefined();
    // Not "null" — absent. A sparse popover that never showed the link must not
    // be able to clear it.
    expect(Object.hasOwn(tripUpdate!, "competition_id")).toBe(false);
    expect(tripUpdate).toMatchObject({
      name: "Nationals",
      starts_on: "2026-03-12",
      ends_on: "2026-03-14",
      is_overnight: true,
    });
  });

  test("field present and empty ⇒ the link is cleared to null", async () => {
    const { tripUpdate } = await run({ ...base, competition_id: "" });
    expect(Object.hasOwn(tripUpdate!, "competition_id")).toBe(true);
    expect(tripUpdate!.competition_id).toBeNull();
  });

  test("field present with an in-program competition ⇒ that value is written", async () => {
    const { tripUpdate } = await run({ ...base, competition_id: COMP });
    expect(tripUpdate!.competition_id).toBe(COMP);
  });

  test("field present with another program's competition ⇒ nothing is written", async () => {
    const { redirectedTo, tripUpdate } = await run({
      ...base,
      competition_id: FOREIGN_COMP,
    });
    expect(tripUpdate).toBeUndefined();
    expect(redirectedTo).toContain("error=competition");
  });
});

describe("updateTrip — the guards around that write", () => {
  test("a blank name never reaches the database", async () => {
    const { redirectedTo, tripUpdate } = await run({ ...base, name: "  " });
    expect(tripUpdate).toBeUndefined();
    expect(redirectedTo).toContain("error=name");
  });

  test("an end date before the start date is refused", async () => {
    const { redirectedTo, tripUpdate } = await run({
      ...base,
      starts_on: "2026-03-14",
      ends_on: "2026-03-12",
    });
    expect(tripUpdate).toBeUndefined();
    expect(redirectedTo).toContain("error=dates");
  });

  test("turning overnight off while rooms exist is refused, not silently applied", async () => {
    h.roomCount = 3;
    // An unticked checkbox sends nothing at all — which is exactly why the
    // overnight flag can't use the "was it sent?" test the competition link does.
    const dayTrip: Partial<typeof base> = { ...base };
    delete dayTrip.is_overnight;
    const { redirectedTo, tripUpdate } = await run(
      dayTrip as Record<string, string>,
    );
    expect(tripUpdate).toBeUndefined();
    expect(redirectedTo).toContain("error=overnight_rooms");
  });
});
