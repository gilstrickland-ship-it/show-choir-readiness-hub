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
  calendarDaysBetween,
  formatTimeZoneLabel,
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

describe("calendarDaysBetween", () => {
  test("counts calendar days, not 24-hour blocks (the director's count)", () => {
    // Thu Feb 5 9pm Central → Sat Feb 7 competition. Only ~27 hours elapse, but a
    // director counts two calendar steps (Fri, Sat). floor((to-from)/86.4M) = 1.
    const thuNight = new Date("2026-02-06T03:00:00.000Z"); // Thu Feb 5 9pm CST
    const satComp = new Date("2026-02-07T06:00:00.000Z"); // Sat Feb 7 12am CST
    expect(calendarDaysBetween(thuNight, satComp, "America/Chicago")).toBe(2);
  });

  test("same calendar day is 0", () => {
    const morning = new Date("2026-02-07T14:00:00.000Z"); // Sat 8am CST
    const evening = new Date("2026-02-08T03:00:00.000Z"); // Sat 9pm CST
    expect(calendarDaysBetween(morning, evening, "America/Chicago")).toBe(0);
  });

  test("negative (target already passed) clamps to 0", () => {
    const later = new Date("2026-02-10T12:00:00.000Z");
    const earlier = new Date("2026-02-05T12:00:00.000Z");
    expect(calendarDaysBetween(later, earlier, "America/Chicago")).toBe(0);
  });

  test("counted in program tz, not UTC: late-night instant stays on its local day", () => {
    // 01:00 UTC Feb 6 is still Feb 5 evening in Chicago; target 00:00 UTC Feb 7
    // is Feb 6 evening in Chicago → one calendar day apart locally.
    const from = new Date("2026-02-06T01:00:00.000Z"); // Feb 5 (Chicago)
    const to = new Date("2026-02-07T00:00:00.000Z"); // Feb 6 (Chicago)
    expect(calendarDaysBetween(from, to, "America/Chicago")).toBe(1);
  });
});

describe("formatTimeZoneLabel", () => {
  test("maps common US zones to friendly labels", () => {
    expect(formatTimeZoneLabel("America/Chicago")).toBe("Central Time");
    expect(formatTimeZoneLabel("America/New_York")).toBe("Eastern Time");
    expect(formatTimeZoneLabel("America/Denver")).toBe("Mountain Time");
    expect(formatTimeZoneLabel("America/Phoenix")).toBe("Arizona Time");
    expect(formatTimeZoneLabel("America/Los_Angeles")).toBe("Pacific Time");
    expect(formatTimeZoneLabel("America/Anchorage")).toBe("Alaska Time");
    expect(formatTimeZoneLabel("Pacific/Honolulu")).toBe("Hawaii Time");
  });

  test("falls back to the city segment with underscores as spaces", () => {
    expect(formatTimeZoneLabel("Europe/Paris")).toBe("Paris");
    expect(formatTimeZoneLabel("America/Indiana/Indianapolis")).toBe("Indianapolis");
    expect(formatTimeZoneLabel("Pacific/Pago_Pago")).toBe("Pago Pago");
    expect(formatTimeZoneLabel("UTC")).toBe("UTC");
  });
});
