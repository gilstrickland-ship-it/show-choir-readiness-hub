// ============================================================================
// Unit tests — duration-preserving end shift (spec 005 US2)
// ----------------------------------------------------------------------------
// The Season page's row popover edits an event's START without showing its end.
// So when the start moves, the end has to move with it, or a date fix leaves a
// 7–9pm rehearsal starting Thursday and ending Tuesday. Pure function; no DB,
// no network.
// ============================================================================

import { describe, test, expect } from "vitest";
import { shiftedEndInstant } from "@/lib/events";

describe("shiftedEndInstant", () => {
  test("moves the end by exactly as far as the start moved", () => {
    expect(
      shiftedEndInstant(
        "2026-09-15T00:00:00.000Z", // Tue 7:00pm Central
        "2026-09-17T00:00:00.000Z", // Thu 7:00pm Central
        "2026-09-15T02:00:00.000Z", // Tue 9:00pm Central
      ),
    ).toBe("2026-09-17T02:00:00.000Z");
  });

  test("a shift within the day keeps the event's length", () => {
    // 7:00→9:00pm becomes 8:30→10:30pm: still two hours.
    expect(
      shiftedEndInstant(
        "2026-09-15T00:00:00.000Z",
        "2026-09-15T01:30:00.000Z",
        "2026-09-15T02:00:00.000Z",
      ),
    ).toBe("2026-09-15T03:30:00.000Z");
  });

  test("crossing a DST boundary keeps the wall clock, not just the length", () => {
    // 2026-03-07 7–9pm CST (UTC-6) moved a week later, into CDT (UTC-5). The
    // new start is 7:00pm CDT = 00:00Z; the shifted end lands 02:00Z, which is
    // 9:00pm CDT — the same two hours, ending at the same time on the clock.
    expect(
      shiftedEndInstant(
        "2026-03-08T01:00:00.000Z",
        "2026-03-15T00:00:00.000Z",
        "2026-03-08T03:00:00.000Z",
      ),
    ).toBe("2026-03-15T02:00:00.000Z");
  });

  test("an event with no end has nothing to move", () => {
    expect(
      shiftedEndInstant(
        "2026-09-15T00:00:00.000Z",
        "2026-09-17T00:00:00.000Z",
        null,
      ),
    ).toBeNull();
  });

  test("no delta to compute means the stored end is left alone", () => {
    const end = "2026-09-15T02:00:00.000Z";
    // The event had no start to move away from…
    expect(shiftedEndInstant(null, "2026-09-17T00:00:00.000Z", end)).toBeNull();
    // …or the start was cleared rather than moved.
    expect(shiftedEndInstant("2026-09-15T00:00:00.000Z", null, end)).toBeNull();
  });

  test("unparseable input fails closed", () => {
    expect(shiftedEndInstant("not a date", "2026-09-17T00:00:00.000Z", "x")).toBeNull();
    expect(
      shiftedEndInstant(
        "2026-09-15T00:00:00.000Z",
        "2026-09-17T00:00:00.000Z",
        "whenever",
      ),
    ).toBeNull();
  });

  test("a start that didn't actually move leaves the end where it is", () => {
    expect(
      shiftedEndInstant(
        "2026-09-15T00:00:00.000Z",
        "2026-09-15T00:00:00.000Z",
        "2026-09-15T02:00:00.000Z",
      ),
    ).toBe("2026-09-15T02:00:00.000Z");
  });
});
