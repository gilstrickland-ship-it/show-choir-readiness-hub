// ============================================================================
// Unit tests — timezone wall-clock ⇄ UTC conversion (T012–T015 shared helper)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no network (runs under vitest.unit.config.ts).
// Constitution VII: a 7:15 AM call time rendered/stored wrong once destroys
// trust — these lock the DST-aware conversion both directions across the
// Central/Eastern line the Alabama→Indiana corridor crosses.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  zonedWallToUtc,
  toZonedInputValue,
  zonedDateKey,
} from "@/lib/datetime";

describe("zonedWallToUtc", () => {
  test("Central Daylight Time (summer): CDT is UTC-5", () => {
    // 2026-07-04 07:15 America/Chicago (CDT) → 12:15 UTC
    expect(zonedWallToUtc("2026-07-04T07:15", "America/Chicago")?.toISOString()).toBe(
      "2026-07-04T12:15:00.000Z",
    );
  });

  test("Central Standard Time (winter): CST is UTC-6", () => {
    // 2026-01-10 07:15 America/Chicago (CST) → 13:15 UTC
    expect(zonedWallToUtc("2026-01-10T07:15", "America/Chicago")?.toISOString()).toBe(
      "2026-01-10T13:15:00.000Z",
    );
  });

  test("Eastern time differs from Central by one hour", () => {
    // 2026-01-10 07:15 America/New_York (EST, UTC-5) → 12:15 UTC
    expect(zonedWallToUtc("2026-01-10T07:15", "America/New_York")?.toISOString()).toBe(
      "2026-01-10T12:15:00.000Z",
    );
  });

  test("null / invalid input yields null", () => {
    expect(zonedWallToUtc("", "America/Chicago")).toBeNull();
    expect(zonedWallToUtc("not-a-date", "America/Chicago")).toBeNull();
  });
});

describe("toZonedInputValue", () => {
  test("round-trips a UTC instant back to the program-tz wall clock", () => {
    // 12:15 UTC in summer Chicago (CDT) → 07:15 local
    expect(toZonedInputValue("2026-07-04T12:15:00.000Z", "America/Chicago")).toBe(
      "2026-07-04T07:15",
    );
  });

  test("round-trips wall → UTC → wall", () => {
    const tz = "America/Chicago";
    const utc = zonedWallToUtc("2026-03-20T19:00", tz);
    expect(utc).not.toBeNull();
    expect(toZonedInputValue(utc, tz)).toBe("2026-03-20T19:00");
  });

  test("empty for null", () => {
    expect(toZonedInputValue(null, "America/Chicago")).toBe("");
  });
});

describe("zonedDateKey", () => {
  test("buckets an instant into the program-tz calendar day", () => {
    // 01:00 UTC on the 5th is still the evening of the 4th in Chicago.
    expect(zonedDateKey("2026-07-05T01:00:00.000Z", "America/Chicago")).toBe(
      "2026-07-04",
    );
  });
});
