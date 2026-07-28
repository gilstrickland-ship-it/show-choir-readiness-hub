// ============================================================================
// Unit tests — season-label smart default (spec 005 US3, T122)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no network. This is the value a brand-new
// director sees pre-filled in the "Start your season" card, so it has to be the
// season they mean: the school year turns over in August, and the answer is
// resolved on the PROGRAM's calendar, not the server's (Constitution VII).
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  defaultSeasonLabel,
  isRolloverScreen,
  resolveRolloverScreen,
  rolloverProgress,
  rolloverStepKeys,
  seasonLabelForStartYear,
  ROLLOVER_STEPS,
} from "@/lib/seasons";

describe("seasonLabelForStartYear", () => {
  test("writes a school year the way directors say it", () => {
    expect(seasonLabelForStartYear(2026)).toBe("2026-27");
    expect(seasonLabelForStartYear(2027)).toBe("2027-28");
  });

  test("pads a century rollover instead of writing 2099-0", () => {
    expect(seasonLabelForStartYear(2099)).toBe("2099-00");
    expect(seasonLabelForStartYear(2100)).toBe("2100-01");
  });
});

describe("defaultSeasonLabel", () => {
  test("August starts the new school year", () => {
    expect(
      defaultSeasonLabel(new Date("2026-08-01T17:00:00Z"), "America/Chicago"),
    ).toBe("2026-27");
  });

  test("the rest of the fall stays in it", () => {
    expect(
      defaultSeasonLabel(new Date("2026-12-15T17:00:00Z"), "America/Chicago"),
    ).toBe("2026-27");
  });

  test("January through July belongs to the year that began last August", () => {
    expect(
      defaultSeasonLabel(new Date("2027-01-05T17:00:00Z"), "America/Chicago"),
    ).toBe("2026-27");
    expect(
      defaultSeasonLabel(new Date("2027-07-31T17:00:00Z"), "America/Chicago"),
    ).toBe("2026-27");
  });

  test("the program's calendar decides, not the server's", () => {
    // 2026-08-01 02:00 UTC is still July 31 in Chicago — a director opening the
    // app that evening is not yet in the new season.
    const instant = new Date("2026-08-01T02:00:00Z");
    expect(defaultSeasonLabel(instant, "America/Chicago")).toBe("2025-26");
    expect(defaultSeasonLabel(instant, "UTC")).toBe("2026-27");
  });
});

// ============================================================================
// Rollover progress (spec 005 Wave 13 / T165)
// ----------------------------------------------------------------------------
// The wizard's screens numbered themselves in hard-coded heading strings —
// "Step 1" … "Step 6" — with no total and no progress affordance, and the
// numbering was wrong twice: the sixth screen is the FINISH, not a step, and a
// program with nothing to roll from goes from screen one straight to activation,
// so it saw "Step 1" and then "Step 5". The sequence is derived now, from the
// same fact the create action branches on.
// ============================================================================

describe("rolloverStepKeys", () => {
  test("a real rollover walks all five steps", () => {
    expect(rolloverStepKeys(true)).toEqual([...ROLLOVER_STEPS]);
  });

  test("with nothing to carry across the flow is two steps, not five", () => {
    // createRolloverSeason sends a program with no prior season straight to
    // activation, so counting five would promise three screens that never come.
    expect(rolloverStepKeys(false)).toEqual(["new", "activate"]);
  });
});

describe("rolloverProgress", () => {
  test('says "Step 3 of 5" where the old headings said "Step 3"', () => {
    const p = rolloverProgress("students", true);
    expect(p.position).toBe(3);
    expect(p.total).toBe(5);
    expect(p.finished).toBe(false);
  });

  test("marks what is behind you done, where you are now, and the rest not yet", () => {
    const p = rolloverProgress("costumes", true);
    expect(p.steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "now",
      "todo",
    ]);
  });

  test("the short path counts its own two steps", () => {
    const p = rolloverProgress("activate", false);
    expect(p.position).toBe(2);
    expect(p.total).toBe(2);
    expect(p.steps.map((s) => s.key)).toEqual(["new", "activate"]);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "now"]);
  });

  test("the finish screen is not a step: everything is done and there is no position", () => {
    const p = rolloverProgress("done", true);
    expect(p.finished).toBe(true);
    expect(p.position).toBeNull();
    expect(p.total).toBe(5);
    expect(p.steps.every((s) => s.state === "done")).toBe(true);
  });

  test("every step carries a label a director would say out loud", () => {
    for (const s of rolloverProgress("new", true).steps) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.label).not.toMatch(/^Step \d/);
    }
  });
});

describe("isRolloverScreen", () => {
  test("accepts the wizard's own screens and nothing else", () => {
    expect(isRolloverScreen("students")).toBe(true);
    expect(isRolloverScreen("done")).toBe(true);
    // `?step=` rides in the URL, so a hand-typed value must fail closed to the
    // first screen rather than index something.
    expect(isRolloverScreen("archive")).toBe(false);
    expect(isRolloverScreen("constructor")).toBe(false);
    expect(isRolloverScreen("")).toBe(false);
  });
});

describe("resolveRolloverScreen", () => {
  test("a screen on this program's path is kept", () => {
    expect(resolveRolloverScreen("students", true)).toBe("students");
    expect(resolveRolloverScreen("activate", false)).toBe("activate");
    expect(resolveRolloverScreen("done", false)).toBe("done");
  });

  test("a screen this program's path does NOT have falls back to the first", () => {
    // `?step=students` for a program with nothing to carry across: its path is
    // only new → activate, so there is no third step to be on. Reading it as
    // "students" rendered a form the flow doesn't have AND asked the indicator
    // to find a position for a step that isn't in its own list.
    expect(resolveRolloverScreen("students", false)).toBe("new");
    expect(resolveRolloverScreen("costumes", false)).toBe("new");
    expect(resolveRolloverScreen("archive", true)).toBe("new");
    expect(resolveRolloverScreen("constructor", true)).toBe("new");
  });

  test("and the indicator never indexes off the end of its own list", () => {
    const p = rolloverProgress("students", false);
    expect(p.position).toBe(1);
    expect(p.total).toBe(2);
    expect(p.steps[(p.position ?? 0) - 1].key).toBe("new");
  });
});
