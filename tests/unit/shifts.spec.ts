// ============================================================================
// Unit tests — shift suggestion derivation (T024)
// ----------------------------------------------------------------------------
// Pure function; no DB, no network (runs under vitest.unit.config.ts). Locks the
// draft-only derivation (Constitution IV spirit): from itinerary items + costume
// set transitions we DERIVE editable suggestions the director confirms — this
// suite proves what gets suggested and what does not.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  suggestShifts,
  type SuggestItem,
  type CostumeSetInfo,
} from "@/lib/shifts";

const D = "2026-03-14";
function at(hhmm: string): string {
  return `${D}T${hhmm}:00.000Z`;
}

describe("suggestShifts — itinerary-derived crews", () => {
  test("a meal item yields a meal crew shift for its window", () => {
    const items: SuggestItem[] = [
      { kind: "meal", title: "Lunch", starts_at: at("12:00"), ends_at: at("13:00"), location: "Cafeteria" },
    ];
    const s = suggestShifts({ items, costumeSets: [] });
    expect(s).toHaveLength(1);
    expect(s[0].origin).toBe("meal");
    expect(s[0].title).toBe("Meal crew — Lunch");
    expect(s[0].starts_at).toBe(at("12:00"));
    expect(s[0].ends_at).toBe(at("13:00"));
    expect(s[0].notes).toContain("Cafeteria");
  });

  test("a load item yields a load crew shift with a larger crew", () => {
    const items: SuggestItem[] = [
      { kind: "load", title: "Load out", starts_at: at("21:00"), ends_at: null },
    ];
    const s = suggestShifts({ items, costumeSets: [] });
    expect(s).toHaveLength(1);
    expect(s[0].origin).toBe("load");
    expect(s[0].needed_count).toBe(4);
  });

  test("arrive + homeroom yield one check-in crew spanning the window", () => {
    const items: SuggestItem[] = [
      { kind: "arrive", title: "Registration", starts_at: at("08:00"), ends_at: at("08:30") },
      { kind: "homeroom", title: "Homeroom 214", starts_at: at("08:45"), ends_at: null },
    ];
    const s = suggestShifts({ items, costumeSets: [] });
    const checkin = s.filter((x) => x.origin === "checkin");
    expect(checkin).toHaveLength(1);
    expect(checkin[0].starts_at).toBe(at("08:00"));
    expect(checkin[0].ends_at).toBe(at("08:45")); // homeroom start bounds it
  });

  test("arrive with no homeroom falls back to the arrive end for the window", () => {
    const items: SuggestItem[] = [
      { kind: "arrive", title: "Registration", starts_at: at("08:00"), ends_at: at("08:30") },
    ];
    const s = suggestShifts({ items, costumeSets: [] });
    expect(s[0].ends_at).toBe(at("08:30"));
  });
});

describe("suggestShifts — costume set transitions", () => {
  const perform: SuggestItem[] = [
    { kind: "perform", title: "Set 1", starts_at: at("14:00"), ends_at: at("14:20") },
    { kind: "perform", title: "Set 2", starts_at: at("16:00"), ends_at: at("16:20") },
  ];

  test("two consecutive dressed sets → one quick-change crew in the perform gap", () => {
    const sets: CostumeSetInfo[] = [
      { id: "a", name: "Opener", sort_order: 1, hasAssignments: true },
      { id: "b", name: "Ballad", sort_order: 2, hasAssignments: true },
    ];
    const s = suggestShifts({ items: perform, costumeSets: sets });
    const qc = s.filter((x) => x.origin === "quickchange");
    expect(qc).toHaveLength(1);
    expect(qc[0].title).toBe("Quick-change crew — Opener→Ballad");
    // Window is between the two perform items: end of first → start of second.
    expect(qc[0].starts_at).toBe(at("14:20"));
    expect(qc[0].ends_at).toBe(at("16:00"));
    expect(qc[0].notes).toBeNull();
  });

  test("a set with no assignments is skipped (nobody to change)", () => {
    const sets: CostumeSetInfo[] = [
      { id: "a", name: "Opener", sort_order: 1, hasAssignments: true },
      { id: "b", name: "Ballad", sort_order: 2, hasAssignments: false },
      { id: "c", name: "Closer", sort_order: 3, hasAssignments: true },
    ];
    const s = suggestShifts({ items: perform, costumeSets: sets });
    const qc = s.filter((x) => x.origin === "quickchange");
    // Only Opener + Closer are dressed → one transition Opener→Closer.
    expect(qc).toHaveLength(1);
    expect(qc[0].title).toBe("Quick-change crew — Opener→Closer");
  });

  test("dressed sets but no perform items → suggestion with a review note and no times", () => {
    const sets: CostumeSetInfo[] = [
      { id: "a", name: "Opener", sort_order: 1, hasAssignments: true },
      { id: "b", name: "Ballad", sort_order: 2, hasAssignments: true },
    ];
    const s = suggestShifts({ items: [], costumeSets: sets });
    const qc = s.filter((x) => x.origin === "quickchange");
    expect(qc).toHaveLength(1);
    expect(qc[0].starts_at).toBeNull();
    expect(qc[0].notes).toContain("review");
  });

  test("a single dressed set yields no quick-change (no transition)", () => {
    const sets: CostumeSetInfo[] = [
      { id: "a", name: "Opener", sort_order: 1, hasAssignments: true },
    ];
    const s = suggestShifts({ items: perform, costumeSets: sets });
    expect(s.filter((x) => x.origin === "quickchange")).toHaveLength(0);
  });
});

describe("suggestShifts — shape + ordering", () => {
  test("no inputs → no suggestions", () => {
    expect(suggestShifts({ items: [], costumeSets: [] })).toEqual([]);
  });

  test("suggestions are ordered by start time, time-less last", () => {
    const items: SuggestItem[] = [
      { kind: "load", title: "Load out", starts_at: at("21:00"), ends_at: null },
      { kind: "meal", title: "Breakfast", starts_at: at("07:00"), ends_at: at("07:30") },
      { kind: "meal", title: "TBD snack", starts_at: null, ends_at: null },
    ];
    const s = suggestShifts({ items, costumeSets: [] });
    expect(s.map((x) => x.title)).toEqual([
      "Meal crew — Breakfast",
      "Load crew — Load out",
      "Meal crew — TBD snack",
    ]);
  });
});
