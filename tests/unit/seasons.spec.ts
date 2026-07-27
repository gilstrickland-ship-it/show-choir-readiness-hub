// ============================================================================
// Unit tests — season-label smart default (spec 005 US3, T122)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no network. This is the value a brand-new
// director sees pre-filled in the "Start your season" card, so it has to be the
// season they mean: the school year turns over in August, and the answer is
// resolved on the PROGRAM's calendar, not the server's (Constitution VII).
// ============================================================================

import { describe, test, expect } from "vitest";
import { defaultSeasonLabel, seasonLabelForStartYear } from "@/lib/seasons";

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
