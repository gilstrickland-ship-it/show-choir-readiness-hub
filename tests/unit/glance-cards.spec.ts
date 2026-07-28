// ============================================================================
// Unit tests — the competition hub's glance cards (spec 005 US7-1)
// ----------------------------------------------------------------------------
// buildGlanceCards is pure: readiness in, one status line per area out. The
// load-bearing property is that each line says something TRUE about the state it
// names. The attendance line failed that: it printed `expected + partial` under
// the word "expected", so a comp with half-day students read as fully expected —
// and the partial count, which the old hub showed, could no longer be reached
// from the hub at all.
// ============================================================================

import { describe, test, expect } from "vitest";
import { buildGlanceCards } from "@/app/(app)/[program]/competitions/[competitionId]/GlanceCards";
import { loadCompReadiness } from "@/lib/readiness";
import { flagRegistry, type FlagKey } from "@/lib/flags";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompReadiness, ReadinessCheck } from "@/lib/readiness";

const BASE = "/demo";
const COMP_BASE = "/demo/competitions/c1";

function readiness(over: Partial<CompReadiness> = {}): CompReadiness {
  const expected = over.expected ?? 0;
  const partial = over.partial ?? 0;
  return {
    itinPublished: null,
    firstStart: null,
    expected,
    partial,
    absent: 0,
    attending: over.attending ?? expected + partial,
    openSlots: 0,
    packetStatus: null,
    checks: [],
    done: 0,
    total: 0,
    ...over,
  };
}

function cards(r: CompReadiness) {
  return buildGlanceCards({
    readiness: r,
    base: BASE,
    compBase: COMP_BASE,
    tz: "America/Chicago",
    showTravel: false,
    trip: null,
    results: null,
    compDone: false,
    resultsHref: `${COMP_BASE}?edit=results#results`,
  });
}

function statusOf(r: CompReadiness, key: string): string | undefined {
  return cards(r).find((c) => c.key === key)?.status;
}

describe("attendance card", () => {
  test("counts the three statuses as three statuses", () => {
    expect(statusOf(readiness({ expected: 41, partial: 2, absent: 1 }), "attendance")).toBe(
      "41 expected · 2 partial · 1 absent",
    );
  });

  // The defect: 41 expected + 2 partial used to print as "43 expected", which is
  // a claim about 43 students who will be there all day. Two of them will not.
  test("partial is never folded into expected", () => {
    const status = statusOf(readiness({ expected: 41, partial: 2, absent: 1 }), "attendance");
    expect(status).not.toContain("43 expected");
  });

  test("partial is left out when there is none — no standing '0 partial'", () => {
    expect(statusOf(readiness({ expected: 12, partial: 0, absent: 0 }), "attendance")).toBe(
      "12 expected · 0 absent",
    );
  });

  test("a comp with only partial and absent students still reads as seeded", () => {
    const r = readiness({ expected: 0, partial: 3, absent: 1 });
    expect(statusOf(r, "attendance")).toBe("0 expected · 3 partial · 1 absent");
    expect(cards(r).find((c) => c.key === "attendance")?.tone).toBe("ok");
  });

  test("nobody seeded says so", () => {
    expect(statusOf(readiness(), "attendance")).toBe("Nobody on the list yet");
  });
});

describe("meals card", () => {
  // Meals use the OTHER reading of the same rows on purpose: a student present
  // for part of the day still eats (the rule loadMealData prints).
  test("counts everyone who will be there to eat, partial included", () => {
    expect(statusOf(readiness({ expected: 41, partial: 2 }), "meals")).toBe("43 meals needed");
  });

  test("waits on attendance when nobody is attending", () => {
    expect(statusOf(readiness({ expected: 0, partial: 0, absent: 4 }), "meals")).toBe(
      "Waiting on attendance",
    );
  });
});

// The packet and shift cards exist only when the readiness pass built their
// check — that presence IS the flag/role gate. They used to be found by
// string-matching the check's href, which would have stopped finding them, in
// silence, the day either route moved.
describe("cards gated on a readiness check", () => {
  const packetCheck: ReadinessCheck = {
    key: "packet",
    ok: false,
    tone: "warn",
    label: "Host packet · ready to review",
    href: `${COMP_BASE}/packet`,
    action: "Review",
  };
  const shiftCheck: ReadinessCheck = {
    key: "shifts",
    ok: false,
    tone: "warn",
    label: "Volunteer shifts · 3 slots open",
    href: `${BASE}/comms/shifts`,
    action: "Fill shifts",
  };

  test("no packet check, no packet card", () => {
    expect(cards(readiness()).some((c) => c.key === "packet")).toBe(false);
  });

  test("a packet check found by key, not by the shape of its link", () => {
    const r = readiness({ checks: [{ ...packetCheck, href: "/somewhere/else" }], packetStatus: "review" });
    const card = cards(r).find((c) => c.key === "packet");
    expect(card?.status).toBe("Draft ready to check");
  });

  test("a shift check found by key, not by the shape of its link", () => {
    const r = readiness({ checks: [{ ...shiftCheck, href: "/moved/shifts" }], openSlots: 3 });
    const card = cards(r).find((c) => c.key === "shifts");
    expect(card?.status).toBe("3 spots still open");
    // The card still opens whatever the check points at.
    expect(card?.href).toBe("/moved/shifts");
  });

  test("no shift check, no shift card", () => {
    expect(cards(readiness()).some((c) => c.key === "shifts")).toBe(false);
  });
});

// ============================================================================
// Where the fold actually happened: loadCompReadiness
// ----------------------------------------------------------------------------
// Everything above pins the SENTENCE. The defect was upstream of it — `expected`
// was counted as expected+partial, so by the time a card was built the partial
// number was already gone and no presentation-layer test could have noticed.
// Reverting the count and leaving the card code alone would keep every test
// above green. These drive the loader against a client that answers each count
// query with the status it filtered on, and assert the three numbers are three
// independent reads.
// ============================================================================

const allFlags = (over: Partial<Record<FlagKey, boolean>> = {}): Record<FlagKey, boolean> => ({
  ...(Object.fromEntries(
    (Object.keys(flagRegistry) as FlagKey[]).map((k) => [k, true]),
  ) as Record<FlagKey, boolean>),
  ...over,
});

// A chainable stub that REMEMBERS its filters, so an attendance count answers
// from the status it was actually asked about. `attendanceFilters` records every
// status queried, which is how "three counts, not two" is asserted.
function readinessClient(
  byStatus: Record<string, number>,
  attendanceFilters: string[] = [],
): SupabaseClient {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    for (const m of ["is", "not", "in", "order", "limit"]) builder[m] = chain;
    builder.maybeSingle = () => Promise.resolve({ data: null });
    builder.then = (resolve: (v: { count: number; data: null }) => unknown) => {
      let count = 0;
      if (table === "attendance") {
        const status = String(filters.status ?? "");
        attendanceFilters.push(status);
        count = byStatus[status] ?? 0;
      }
      return Promise.resolve({ count, data: null }).then(resolve);
    };
    return builder;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

const loadFor = (byStatus: Record<string, number>, seen: string[] = []) =>
  loadCompReadiness(readinessClient(byStatus, seen), {
    programId: "p1",
    comp: { id: "c1", name: "Regionals", date: "2026-03-07", host_school: null },
    // Shifts off so the shift branch does not need its own stub rows; the
    // attendance derivation is what is under test.
    flags: allFlags({ shifts: false, packet_parse: false }),
    role: "director",
    base: BASE,
  });

describe("loadCompReadiness — the attendance counts themselves", () => {
  test("expected is the expected count, NOT expected + partial", async () => {
    const r = await loadFor({ expected: 41, partial: 2, absent: 1 });
    expect(r.expected).toBe(41);
    expect(r.partial).toBe(2);
    expect(r.absent).toBe(1);
  });

  test("attending is the derived expected + partial, and stays derived", async () => {
    const r = await loadFor({ expected: 41, partial: 2, absent: 1 });
    expect(r.attending).toBe(43);
    // The meals rule reads `attending`; the attendance line reads the three
    // parts. Both from one load, so they cannot drift apart.
    expect(r.expected + r.partial).toBe(r.attending);
  });

  test("all three statuses are counted, each by its own query", async () => {
    const seen: string[] = [];
    await loadFor({ expected: 41, partial: 2, absent: 1 }, seen);
    expect([...seen].sort()).toEqual(["absent", "expected", "partial"]);
  });

  test("the checklist line reports the three counts it loaded", async () => {
    const r = await loadFor({ expected: 41, partial: 2, absent: 1 });
    const line = r.checks.find((c) => c.key === "attendance")?.label;
    expect(line).toBe("Attendance · 41 expected, 2 partial, 1 absent");
    expect(line).not.toContain("43 expected");
  });

  test("a comp with no partial students carries no partial clause", async () => {
    const r = await loadFor({ expected: 12, partial: 0, absent: 0 });
    expect(r.partial).toBe(0);
    expect(r.checks.find((c) => c.key === "attendance")?.label).toBe(
      "Attendance · 12 expected, 0 absent",
    );
  });
});
