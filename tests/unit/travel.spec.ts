// ============================================================================
// Unit tests — travel helpers + PDF money formatting (T016–T017 pure logic)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no network (runs under vitest.unit.config.ts).
// Covers the queue-eligibility kinds, the one-room-one-bus error detector, and
// the cents→USD formatter the board snapshot renders.
// ============================================================================

import { describe, test, expect } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { relevantKinds, isAlreadyPlacedError } from "@/lib/travel";
import { formatCents } from "@/lib/pdf/queries";

function pgError(code: string, message: string): PostgrestError {
  const base = { code, message, details: "", hint: "", name: "PostgrestError" };
  return { ...base, toJSON: () => base } as PostgrestError;
}

describe("relevantKinds", () => {
  test("day trip needs a bus only", () => {
    expect(relevantKinds(false)).toEqual(["bus"]);
  });
  test("overnight trip needs a room and a bus", () => {
    expect(relevantKinds(true)).toEqual(["room", "bus"]);
  });
});

describe("isAlreadyPlacedError", () => {
  test("detects Postgres unique_violation (23505) from the trigger", () => {
    expect(
      isAlreadyPlacedError(pgError("23505", "student already assigned to a bus group on trip")),
    ).toBe(true);
  });
  test("ignores unrelated errors and null", () => {
    expect(isAlreadyPlacedError(pgError("23503", "fk"))).toBe(false);
    expect(isAlreadyPlacedError(null)).toBe(false);
    expect(isAlreadyPlacedError(undefined)).toBe(false);
  });
});

describe("formatCents", () => {
  test("formats whole and fractional dollars with thousands separators", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(500)).toBe("$5.00");
    expect(formatCents(123456)).toBe("$1,234.56");
  });
  test("formats negative (variance) amounts", () => {
    expect(formatCents(-2500)).toBe("-$25.00");
  });
});
