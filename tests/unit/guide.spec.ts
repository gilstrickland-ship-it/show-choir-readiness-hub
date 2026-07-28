// ============================================================================
// Unit tests — first-use guide pure pieces + panel loader (T057, spec 003).
// ----------------------------------------------------------------------------
// The guide's state parsing, role→journey resolution, panel state math, and the
// lean-by-construction loader short-circuits are all pure or stubbable without a
// DB. The guarded write action (service-role) is not exercised here — it has no
// pure surface.
//
// Spec 005 Wave 9 deleted the eight intro strips (each had become a second copy
// of a fact its rebuilt page states permanently), so the strip registry tests
// went with them. What replaced them is the test directly below: an old row's
// leftover `strips` object must parse to an inert state rather than an error.
// ============================================================================

import { describe, test, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseGuideState,
  journeyForRole,
  panelStateFor,
  loadJourneyPanel,
  type GuideState,
} from "@/lib/guide";
import { flagRegistry, type FlagKey } from "@/lib/flags";
import type { Role } from "@/lib/auth";

// Every flag on, with per-test overrides — the shape loadJourneyPanel/journeyForRole want.
function allFlags(overrides: Partial<Record<FlagKey, boolean>> = {}): Record<FlagKey, boolean> {
  const base = Object.fromEntries(
    (Object.keys(flagRegistry) as FlagKey[]).map((k) => [k, true]),
  ) as Record<FlagKey, boolean>;
  return { ...base, ...overrides };
}

// A chainable Supabase stub: every builder method returns `this`, and awaiting
// the builder resolves to { count } keyed by table. `calls` records which tables
// were queried so the short-circuit tests can assert queries did NOT run.
function makeSupabase(
  counts: Record<string, number>,
  calls: string[] = [],
): SupabaseClient {
  const build = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ["select", "eq", "is", "not", "in", "order", "limit"]) {
      builder[m] = chain;
    }
    builder.then = (resolve: (v: { count: number }) => unknown) =>
      Promise.resolve({ count: counts[table] ?? 0 }).then(resolve);
    return builder;
  };
  return {
    from(table: string) {
      calls.push(table);
      return build(table);
    },
  } as unknown as SupabaseClient;
}

const panelArgs = (over: Partial<Parameters<typeof loadJourneyPanel>[1]> = {}) => ({
  role: "director" as Role,
  flags: allFlags(),
  programId: "p1",
  seasonId: "s1" as string | null,
  slug: "demo",
  guideState: {} as GuideState,
  forceOpen: false,
  ...over,
});

// ---------------------------------------------------------------------------
describe("parseGuideState", () => {
  test("empty / non-object inputs collapse to {}", () => {
    for (const raw of [null, undefined, 42, "x", []]) {
      expect(parseGuideState(raw)).toEqual({});
    }
  });

  test("keeps journey_dismissed only when strictly true", () => {
    expect(parseGuideState({ journey_dismissed: true })).toEqual({ journey_dismissed: true });
    expect(parseGuideState({ journey_dismissed: false })).toEqual({});
    expect(parseGuideState({ journey_dismissed: "true" })).toEqual({});
  });

  // Every member who ever pressed "Got it" before Wave 9 still has a strips
  // object in their jsonb. It is not migrated (no schema change, RQ-3) — it is
  // simply not read, so the row keeps working and the key is inert.
  test("a pre-Wave-9 strips object is ignored, not an error", () => {
    expect(parseGuideState({ strips: { treasury: true, budget: false } })).toEqual({});
    expect(
      parseGuideState({ journey_dismissed: true, strips: { digest: true } }),
    ).toEqual({ journey_dismissed: true });
  });
});

describe("journeyForRole — role shape + flag gating", () => {
  test("director and admin both get the setup journey (e2e-contract heading)", () => {
    for (const role of ["director", "admin"] as Role[]) {
      const j = journeyForRole(role, allFlags());
      expect(j?.kind).toBe("director");
      expect(j?.heading).toBe("Set up your program");
      expect(j?.steps[0].label).toBe("Start your season");
    }
  });

  test("treasurer journey requires the treasury flag", () => {
    expect(journeyForRole("treasurer", allFlags())!.kind).toBe("treasurer");
    expect(journeyForRole("treasurer", allFlags({ treasury: false }))).toBeNull();
  });

  test("costume journey requires the costumes flag", () => {
    expect(journeyForRole("costume_manager", allFlags())!.kind).toBe("costume");
    expect(journeyForRole("costume_manager", allFlags({ costumes: false }))).toBeNull();
  });

  test("board member gets the orientation card (no steps)", () => {
    const j = journeyForRole("board_member", allFlags());
    expect(j?.kind).toBe("board");
    expect(j?.steps).toHaveLength(0);
    expect(j?.boardLinks?.length).toBeGreaterThan(0);
  });
});

describe("panelStateFor — full while <2 done, pill otherwise", () => {
  test("0 or 1 complete → full", () => {
    expect(panelStateFor(0, 7, false)).toBe("full");
    expect(panelStateFor(1, 7, false)).toBe("full");
  });
  test("2+ complete with incomplete remaining → pill", () => {
    expect(panelStateFor(2, 7, false)).toBe("pill");
    expect(panelStateFor(6, 7, false)).toBe("pill");
  });
  test("forceOpen always full", () => {
    expect(panelStateFor(4, 7, true)).toBe("full");
  });
  test("all complete → full (the all-✓ revisit)", () => {
    expect(panelStateFor(7, 7, false)).toBe("full");
  });
});

describe("loadJourneyPanel — lean short-circuits", () => {
  test("dismissed → null with ZERO queries", async () => {
    const calls: string[] = [];
    const supabase = makeSupabase({}, calls);
    const model = await loadJourneyPanel(
      supabase,
      panelArgs({ guideState: { journey_dismissed: true } }),
    );
    expect(model).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("terminal verifier passes → null after only the terminal query", async () => {
    const calls: string[] = [];
    // Director terminal = announcements/digests sent. Give announcements a row.
    const supabase = makeSupabase({ announcements: 1 }, calls);
    const model = await loadJourneyPanel(supabase, panelArgs());
    expect(model).toBeNull();
    // Only the terminal step's two tables were touched — no students/competitions/etc.
    expect(new Set(calls)).toEqual(new Set(["announcements", "digests"]));
  });

  test("no data → full panel that takes over the Today body", async () => {
    const supabase = makeSupabase({}); // every count 0
    const model = await loadJourneyPanel(supabase, panelArgs());
    expect(model).not.toBeNull();
    expect(model!.kind).toBe("director");
    expect(model!.state).toBe("full");
    expect(model!.takeover).toBe(true);
    // Season step is pure-derived from seasonId (present) → the one done step.
    expect(model!.doneCount).toBe(1);
    expect(model!.total).toBe(7);
    expect(model!.steps[0].done).toBe(true); // "Start your season"
    // Spec 005 US3: step 1 points at Season, home of the one-submit card.
    expect(model!.steps[0].href).toBe("/demo/season");
  });

  test("mid-progress (≥2 done, terminal not met) → pill, no takeover", async () => {
    // season(pure)+students+ensemble done = 3; announcements 0 keeps panel alive.
    const supabase = makeSupabase({ students: 1, ensemble_members: 1 });
    const model = await loadJourneyPanel(supabase, panelArgs());
    expect(model!.state).toBe("pill");
    expect(model!.takeover).toBe(false);
    expect(model!.doneCount).toBe(3);
  });

  test("forceOpen shows the all-✓ panel even when terminal passes", async () => {
    const supabase = makeSupabase({
      students: 1,
      ensemble_members: 1,
      competitions: 1,
      itineraries: 1,
      guardian_tokens: 1,
      announcements: 1,
    });
    const model = await loadJourneyPanel(
      supabase,
      panelArgs({ forceOpen: true }),
    );
    expect(model!.state).toBe("full");
    expect(model!.takeover).toBe(false);
    expect(model!.doneCount).toBe(7);
  });

  test("board card: shown when not dismissed, gone when dismissed", async () => {
    const supabase = makeSupabase({});
    const shown = await loadJourneyPanel(
      supabase,
      panelArgs({ role: "board_member" }),
    );
    expect(shown!.kind).toBe("board");
    expect(shown!.takeover).toBe(false);

    const gone = await loadJourneyPanel(
      supabase,
      panelArgs({ role: "board_member", guideState: { journey_dismissed: true } }),
    );
    expect(gone).toBeNull();
  });

  test("treasurer with treasury flag off → no panel", async () => {
    const supabase = makeSupabase({});
    const model = await loadJourneyPanel(
      supabase,
      panelArgs({ role: "treasurer", flags: allFlags({ treasury: false }) }),
    );
    expect(model).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A GUIDE MAY NOT SEND ANYONE TO A 404
// ---------------------------------------------------------------------------
// A flag-gated route 404s server-side (Constitution VIII). The director
// journey's LAST step links /comms/announcements, which had nothing evaluating
// the `announcements` flag until spec 005 US9-4 wired it — so the day the
// channel became a real switch, turning it off made the guide's terminal step a
// dead end, and the terminal short-circuit read a verifier for a step the member
// could never reach. Steps declare the flags their destination needs and are
// dropped before anything runs.
describe("loadJourneyPanel — steps whose destination is flagged off", () => {
  test("all flags on: the announcement step is the terminal step", async () => {
    const model = await loadJourneyPanel(makeSupabase({}), panelArgs());
    expect(model!.total).toBe(7);
    const last = model!.steps[model!.steps.length - 1];
    expect(last.label).toBe("Send your first announcement");
    expect(last.href).toBe("/demo/comms/announcements");
  });

  test("announcements off: the step is gone and no link points at it", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ flags: allFlags({ announcements: false }) }),
    );
    expect(model!.total).toBe(6);
    expect(model!.steps.map((s) => s.href)).not.toContain("/demo/comms/announcements");
  });

  test("comms off does it too — the route needs BOTH flags", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ flags: allFlags({ comms: false }) }),
    );
    expect(model!.total).toBe(6);
    expect(model!.steps.some((s) => s.label === "Send your first announcement")).toBe(
      false,
    );
  });

  // The short-circuit has to move with the list. With announcements off, the
  // terminal milestone is emailing families their links — so a program that has
  // done that is past setup and the panel goes away, without the announcements
  // tables being queried at all.
  test("the terminal short-circuit follows the FILTERED list", async () => {
    const calls: string[] = [];
    const supabase = makeSupabase({ guardian_tokens: 1 }, calls);
    const model = await loadJourneyPanel(
      supabase,
      panelArgs({ flags: allFlags({ announcements: false }) }),
    );
    expect(model).toBeNull();
    expect(new Set(calls)).toEqual(new Set(["guardian_tokens"]));
  });

  // Wave 9 merged "group them into a set" and "assign pieces to students": sets
  // stopped being a surface of their own in Wave W, so both steps pointed at
  // /costumes/assignments and the first could not be undone by the second.
  test("the costume journey walks the four rebuilt wardrobe tabs", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "costume_manager" }),
    );
    expect(model!.steps.map((s) => s.href)).toEqual([
      "/demo/costumes/inventory",
      "/demo/costumes/assignments",
      "/demo/costumes",
      "/demo/costumes/checkout",
    ]);
    // The retired sets route is gone from the guide and stays gone.
    expect(model!.steps.map((s) => s.href)).not.toContain("/demo/costumes/sets");
    expect(model!.steps[1].label).toBe("Make a set and assign it");
  });

  // Both competition steps point at Season now (Wave 9): `?add=comp` opens the
  // create drawer, and the spine's next-competition row carries an Itinerary
  // button. Season is any-of gated and survives `competitions: false` — the
  // steps must not, because a Season with competitions off offers neither
  // affordance (the class spec 005 T160 found on the old /competitions links).
  test("competitions off: both competition steps are gone, Season's own step stays", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ flags: allFlags({ competitions: false }) }),
    );
    expect(model!.steps.map((s) => s.href)).not.toContain("/demo/season?add=comp");
    expect(model!.steps.map((s) => s.label)).not.toContain("Publish the itinerary");
    // Step one still points at Season: starting a season is not a competition.
    expect(model!.steps[0].href).toBe("/demo/season");
    expect(model!.total).toBe(5);
  });

  // Season is a UNION surface: it 404s only when EVERY flag it absorbs is off,
  // so an all-of gate would have dropped step one from programs that can reach
  // it perfectly well.
  test("Season's step survives losing three of its four flags", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({
        flags: allFlags({ competitions: false, events: false, travel: false }),
      }),
    );
    expect(model!.steps[0].href).toBe("/demo/season");
  });

  test("...and goes when the last one goes too", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({
        flags: allFlags({
          competitions: false,
          events: false,
          travel: false,
          archive: false,
        }),
      }),
    );
    expect(model!.steps.map((s) => s.href)).not.toContain("/demo/season");
  });
});

// ---------------------------------------------------------------------------
// THE TREASURER LEARNS THE LAYER SPEC 006 ADDED
// ---------------------------------------------------------------------------
// Planned → committed → spent → checked. The journey used to go straight from
// the budget to the ledger, which taught a treasurer that the balance is what
// she has — the exact mistake commitments exists to stop. The order of these
// steps is the order the money moves, so it is asserted, not just their
// presence.
describe("treasurer journey — the commitments step", () => {
  test("walks planned → promised → spent → receipt → reconciled", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "treasurer" }),
    );
    expect(model!.steps.map((s) => s.href)).toEqual([
      "/demo/treasury/budget",
      "/demo/treasury/commitments",
      "/demo/treasury",
      "/demo/treasury",
      "/demo/treasury",
    ]);
    expect(model!.steps[1].label).toBe("Write down what's already promised");
  });

  // The terminal step is the "established program" signal the loader
  // short-circuits on, so the new step had to go BEFORE it, not after — a
  // treasurer who has reconciled a month is past setup whether or not she has
  // ever raised a purchase order.
  test("reconciliation is still the terminal milestone", async () => {
    const calls: string[] = [];
    const model = await loadJourneyPanel(
      makeSupabase({ ledger_reconciliations: 1 }, calls),
      panelArgs({ role: "treasurer" }),
    );
    expect(model).toBeNull();
    expect(new Set(calls)).toEqual(new Set(["ledger_reconciliations"]));
  });

  test("the board-snapshot footer still points at Reports", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "treasurer" }),
    );
    expect(model!.footer!.href).toBe("/demo/treasury/reports");
  });
});

// ---------------------------------------------------------------------------
// THE BOARD CARD IS "WHERE EVERYTHING LIVES" — SO IT MAY ONLY NAME WHAT IS
// ---------------------------------------------------------------------------
// The step list learned this in Wave 5; the board card never did, and its links
// were mapped straight through with no gate at all. `treasury` is off for the
// entire PREP tier, so a board member of any prep program opened Today and got
// a four-row card whose first three rows were 404s (spec 005 T160).
describe("board orientation card — flagged-off links", () => {
  test("all flags on: the money rows, Commitments among them, then Season", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "board_member" }),
    );
    expect(model!.boardLinks!.map((l) => l.href)).toEqual([
      "/demo/treasury",
      "/demo/treasury/commitments",
      "/demo/treasury/budget-vs-actual",
      "/demo/treasury/reports",
      "/demo/season",
    ]);
  });

  // Spec 006 gave this seat the one thing it can move: above the program's
  // second-approver amount, a board member may record the FIRST of a
  // commitment's two approvals. The card that claims to say where everything
  // lives may not hide that — and may not promise it to a program whose money
  // surface is off, where the seat genuinely changes nothing.
  test("the approval note rides the treasury gate, like the links do", async () => {
    const on = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "board_member" }),
    );
    expect(on!.boardNotes).toHaveLength(2);
    expect(on!.boardNotes![1]).toContain("two approvals");

    const off = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "board_member", flags: allFlags({ treasury: false }) }),
    );
    expect(off!.boardNotes).toEqual([
      "Your seat sees everything and changes nothing — that transparency protects the program.",
    ]);
  });

  test("treasury off (the prep tier): the money rows are gone, the card stays", async () => {
    const model = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({ role: "board_member", flags: allFlags({ treasury: false }) }),
    );
    expect(model!.boardLinks!.map((l) => l.href)).toEqual(["/demo/season"]);
    expect(model!.kind).toBe("board");
  });

  test("Season's row is any-of, like Season's own gate", async () => {
    const stillThere = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({
        role: "board_member",
        flags: allFlags({ competitions: false, events: false, travel: false }),
      }),
    );
    expect(stillThere!.boardLinks!.map((l) => l.href)).toContain("/demo/season");

    const gone = await loadJourneyPanel(
      makeSupabase({}),
      panelArgs({
        role: "board_member",
        flags: allFlags({
          competitions: false,
          events: false,
          travel: false,
          archive: false,
        }),
      }),
    );
    expect(gone!.boardLinks!.map((l) => l.href)).not.toContain("/demo/season");
  });
});
