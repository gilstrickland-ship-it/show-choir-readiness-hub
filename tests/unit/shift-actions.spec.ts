// ============================================================================
// Unit tests — the shift writes' three confirmed defects
// ----------------------------------------------------------------------------
// 1. "What it's for" was TWO selects — a kind, and a "which one" list holding
//    every competition, trip and event together — with help text promising that
//    a pick which didn't match the kind was "ignored". It was not: the create
//    was refused and the drawer, with everything typed into it, was thrown away.
//    One composite "<kind>:<id>" value replaces both, so the mismatch cannot be
//    expressed and the copy is true by construction.
// 2. A failed "Add signup" redirected with no row address, so the message landed
//    at the top of a page of cards, nowhere near the box the name was typed
//    into. It goes back to its own row now.
// 3. Every redirect in the file interpolated the POSTED slug raw, so a form
//    posting slug="/evil.com" produced "//evil.com/comms/shifts" — a
//    protocol-relative URL every browser follows off-site. They route through
//    the fail-closed programPath.
//
// No DB and no network: the module boundary is replaced with recorders.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const SEASON = "22222222-2222-2222-2222-222222222222";
const SHIFT = "33333333-3333-3333-3333-333333333333";
const COMPETITION = "44444444-4444-4444-4444-444444444444";
const TRIP = "55555555-5555-5555-5555-555555555555";
const FOREIGN = "66666666-6666-6666-6666-666666666666";

interface Write {
  table: string;
  payload: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  // Which ids this program owns, PER TABLE — because that is what the resolver
  // actually asks: a trip id looked up in `competitions` is not found, which is
  // what makes a mismatched composite unresolvable rather than merely refused.
  owned: {} as Record<string, string[]>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireRole: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/tokens", () => ({
  mintShareLink: async () => ({ raw: "tok" }),
  revokeShareLinksForResource: async () => undefined,
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
    let op: "select" | "insert" = "select";
    let payload: Record<string, unknown> = {};

    const settle = (): unknown => {
      if (op === "insert") {
        h.inserts.push({ table, payload });
        return { data: null, error: null };
      }
      const id = String(filters.id ?? "");
      const ours =
        filters.program_id === PROGRAM && (h.owned[table] ?? []).includes(id);
      return { data: ours ? { id } : null, error: null };
    };

    const builder = {
      select: () => builder,
      insert: (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return builder;
      },
      eq: (key: string, value: unknown) => {
        filters[key] = value;
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

import {
  createShift,
  addStaffSignup,
} from "@/app/(app)/[program]/comms/shifts/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run(
  action: (fd: FormData) => Promise<void>,
  fields: Record<string, string>,
): Promise<{ redirectedTo: string; inserts: Write[] }> {
  let redirectedTo = "";
  try {
    await action(form(fields));
  } catch (e) {
    redirectedTo = (e as Error & { url?: string }).url ?? "";
  }
  return { redirectedTo, inserts: h.inserts };
}

const base = {
  programId: PROGRAM,
  slug: "westfield",
  seasonId: SEASON,
  tz: "America/Chicago",
  title: "Concessions crew",
  needed_count: "4",
};

beforeEach(() => {
  h.inserts = [];
  h.owned = {
    seasons: [SEASON],
    shifts: [SHIFT],
    competitions: [COMPETITION],
    trips: [TRIP],
    events: [],
  };
});

// ---------------------------------------------------------------------------
describe("createShift — one composite attach value, no mismatch to explain", () => {
  const shiftRow = (inserts: Write[]) =>
    inserts.find((i) => i.table === "shifts")?.payload;

  test("no pick at all is a standalone shift", async () => {
    const { redirectedTo, inserts } = await run(createShift, { ...base, attach: "" });
    expect(shiftRow(inserts)).toMatchObject({
      competition_id: null,
      trip_id: null,
      event_id: null,
      title: "Concessions crew",
      needed_count: 4,
    });
    expect(redirectedTo).toContain("ok=created");
  });

  test("a competition pick lands in the competition column only", async () => {
    const { inserts } = await run(createShift, {
      ...base,
      attach: `competition:${COMPETITION}`,
    });
    expect(shiftRow(inserts)).toMatchObject({
      competition_id: COMPETITION,
      trip_id: null,
      event_id: null,
    });
  });

  test("a trip pick lands in the trip column only", async () => {
    const { inserts } = await run(createShift, { ...base, attach: `trip:${TRIP}` });
    expect(shiftRow(inserts)).toMatchObject({
      competition_id: null,
      trip_id: TRIP,
      event_id: null,
    });
  });

  // The old shape's whole failure mode, now unreachable: there is no second
  // control to disagree with the first.
  test("a kind and an id can no longer disagree — they are one value", async () => {
    // The composite names the table the id is looked up in, so a trip id posted
    // under "competition:" is simply not this program's competition.
    const { redirectedTo, inserts } = await run(createShift, {
      ...base,
      attach: `competition:${TRIP}`,
    });
    expect(inserts.some((i) => i.table === "shifts")).toBe(false);
    expect(redirectedTo).toContain("error=attach");
  });

  test("another program's id is refused, not silently dropped", async () => {
    const { redirectedTo, inserts } = await run(createShift, {
      ...base,
      attach: `competition:${FOREIGN}`,
    });
    expect(inserts.some((i) => i.table === "shifts")).toBe(false);
    expect(redirectedTo).toContain("error=attach");
  });

  // `in` walks the prototype chain; Object.hasOwn does not. A posted kind of
  // "constructor" must not hand a junk table name to the resolver.
  test("a prototype-walking kind is refused", async () => {
    const { redirectedTo, inserts } = await run(createShift, {
      ...base,
      attach: `constructor:${COMPETITION}`,
    });
    expect(inserts.some((i) => i.table === "shifts")).toBe(false);
    expect(redirectedTo).toContain("error=attach");
  });

  test("a malformed composite is refused rather than read as standalone", async () => {
    const { redirectedTo, inserts } = await run(createShift, {
      ...base,
      attach: COMPETITION, // no "<kind>:" prefix
    });
    expect(inserts.some((i) => i.table === "shifts")).toBe(false);
    expect(redirectedTo).toContain("error=attach");
  });
});

// ---------------------------------------------------------------------------
describe("addStaffSignup — the message goes back to the row that failed", () => {
  test("a blank name returns to its own shift, not the top of the page", async () => {
    const { redirectedTo, inserts } = await run(addStaffSignup, {
      programId: PROGRAM,
      slug: "westfield",
      shiftId: SHIFT,
      name: "   ",
    });
    expect(inserts).toHaveLength(0);
    expect(redirectedTo).toBe(
      `/westfield/comms/shifts?edit=${SHIFT}&error=name#shift-${SHIFT}`,
    );
  });

  test("a shift outside this program is refused, on that row", async () => {
    const { redirectedTo, inserts } = await run(addStaffSignup, {
      programId: PROGRAM,
      slug: "westfield",
      shiftId: FOREIGN,
      name: "Dana Alvarez",
    });
    expect(inserts).toHaveLength(0);
    expect(redirectedTo).toBe(
      `/westfield/comms/shifts?edit=${FOREIGN}&error=shift#shift-${FOREIGN}`,
    );
  });

  test("a good signup is written against the RESOLVED shift id", async () => {
    const { redirectedTo, inserts } = await run(addStaffSignup, {
      programId: PROGRAM,
      slug: "westfield",
      shiftId: SHIFT,
      name: "Dana Alvarez",
      email: "dana@example.org",
    });
    expect(inserts.find((i) => i.table === "shift_signups")?.payload).toMatchObject({
      program_id: PROGRAM,
      shift_id: SHIFT,
      guardian_id: null,
      name: "Dana Alvarez",
      source: "staff_entered",
      status: "confirmed",
    });
    expect(redirectedTo).toContain("ok=signed");
  });
});

// ---------------------------------------------------------------------------
describe("every shift redirect fails closed on a hostile slug", () => {
  // "//evil.com/comms/shifts" is a protocol-relative URL: every browser reads it
  // as a different ORIGIN and follows it off-site. programPath validates the
  // slug shape and returns null, and the actions fall back to "/".
  test("a slug that is a URL never becomes part of the redirect", async () => {
    const { redirectedTo } = await run(addStaffSignup, {
      programId: PROGRAM,
      slug: "/evil.com",
      shiftId: SHIFT,
      name: "",
    });
    expect(redirectedTo.startsWith("//")).toBe(false);
    expect(redirectedTo).not.toContain("evil.com");
    expect(redirectedTo).toBe(`/?edit=${SHIFT}&error=name#shift-${SHIFT}`);
  });

  test("createShift is hardened the same way", async () => {
    const { redirectedTo } = await run(createShift, {
      ...base,
      slug: "https://evil.com",
      title: "",
    });
    expect(redirectedTo).not.toContain("evil.com");
    expect(redirectedTo).toBe("/?error=title");
  });
});
