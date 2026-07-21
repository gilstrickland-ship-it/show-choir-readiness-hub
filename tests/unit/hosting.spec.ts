// ============================================================================
// Unit tests — host-mode schedule generator + shift-remaining (Wave I2)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no tz math (runs under vitest.unit.config.ts).
// Covers the deterministic warm-up/perform ladder and the ±minutes "running
// behind" shift arithmetic that the schedule builder relies on.
// ============================================================================

import { describe, test, expect } from "vitest";
import { generateHostSchedule, computeShiftRemaining } from "@/lib/hosting";

// A fixed UTC anchor keeps the assertions offset-only (no timezone in play).
const START = Date.parse("2026-09-12T13:00:00.000Z"); // ms

describe("generateHostSchedule", () => {
  const schools = [
    { id: "s1", name: "Alpha HS" },
    { id: "s2", name: "Bravo HS" },
    { id: "s3", name: "Charlie HS" },
  ];

  test("emits a warm-up + perform pair per school in sort_order", () => {
    const slots = generateHostSchedule({
      startUtcMs: START,
      schools,
      warmupMinutes: 25,
      performMinutes: 25,
    });
    expect(slots).toHaveLength(6);
    expect(slots.map((s) => s.kind)).toEqual([
      "warmup",
      "perform",
      "warmup",
      "perform",
      "warmup",
      "perform",
    ]);
    expect(slots.map((s) => s.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(slots[0].label).toBe("Alpha HS — Warm-up");
    expect(slots[1].label).toBe("Alpha HS — Perform");
    expect(slots[0].hosted_school_id).toBe("s1");
  });

  test("ladder: school 1 warm-up at start, perform one warm-up later", () => {
    const slots = generateHostSchedule({
      startUtcMs: START,
      schools,
      warmupMinutes: 25,
      performMinutes: 25,
    });
    expect(slots[0].starts_at).toBe(new Date(START).toISOString()); // warmup 1
    expect(slots[1].starts_at).toBe(
      new Date(START + 25 * 60_000).toISOString(),
    ); // perform 1
  });

  test("ladder: next school's warm-up begins when the prior school performs", () => {
    const slots = generateHostSchedule({
      startUtcMs: START,
      schools,
      warmupMinutes: 25,
      performMinutes: 25,
    });
    const perform1 = slots[1].starts_at;
    const warmup2 = slots[2].starts_at;
    expect(warmup2).toBe(perform1);
    // School 3 warm-up == school 2 perform, and cadence is warmupMinutes.
    expect(slots[4].starts_at).toBe(slots[3].starts_at);
    expect(slots[4].starts_at).toBe(
      new Date(START + 2 * 25 * 60_000).toISOString(),
    );
  });

  test("performMinutes governs the perform slot duration, warmupMinutes the warm-up", () => {
    const slots = generateHostSchedule({
      startUtcMs: START,
      schools: [{ id: "s1", name: "Alpha HS" }],
      warmupMinutes: 20,
      performMinutes: 30,
    });
    expect(slots[0].duration_minutes).toBe(20); // warm-up
    expect(slots[1].duration_minutes).toBe(30); // perform
    // Cadence is warmupMinutes: perform starts 20 min after warm-up.
    expect(slots[1].starts_at).toBe(new Date(START + 20 * 60_000).toISOString());
  });

  test("cadence is the longer duration: a 15/30 schedule never overlaps perform slots", () => {
    const slots = generateHostSchedule({
      startUtcMs: START,
      schools,
      warmupMinutes: 15,
      performMinutes: 30,
    });
    const performs = slots.filter((s) => s.kind === "perform");
    // No perform starts before the previous perform finishes.
    for (let i = 1; i < performs.length; i++) {
      const prevEnd =
        Date.parse(performs[i - 1].starts_at) +
        performs[i - 1].duration_minutes * 60_000;
      expect(Date.parse(performs[i].starts_at)).toBeGreaterThanOrEqual(prevEnd);
    }
    // Concretely: cadence = max(15, 30) = 30; each perform leads by warm-up (15).
    expect(performs[0].starts_at).toBe(new Date(START + 15 * 60_000).toISOString());
    expect(performs[1].starts_at).toBe(new Date(START + 45 * 60_000).toISOString());
    expect(performs[2].starts_at).toBe(new Date(START + 75 * 60_000).toISOString());
  });

  test("no schools yields no slots", () => {
    expect(
      generateHostSchedule({
        startUtcMs: START,
        schools: [],
        warmupMinutes: 25,
        performMinutes: 25,
      }),
    ).toEqual([]);
  });
});

describe("computeShiftRemaining", () => {
  const slots = [
    { id: "a", starts_at: new Date(START).toISOString() },
    { id: "b", starts_at: new Date(START + 25 * 60_000).toISOString() },
    { id: "c", starts_at: new Date(START + 50 * 60_000).toISOString() },
  ];

  test("shifts the pivot and every later slot by +minutes", () => {
    const out = computeShiftRemaining(slots, "b", 10);
    expect(out.map((o) => o.id)).toEqual(["b", "c"]); // 'a' is before the pivot
    expect(out[0].starts_at).toBe(
      new Date(START + 25 * 60_000 + 10 * 60_000).toISOString(),
    );
    expect(out[1].starts_at).toBe(
      new Date(START + 50 * 60_000 + 10 * 60_000).toISOString(),
    );
  });

  test("negative minutes pull the tail earlier (reversible)", () => {
    const forward = computeShiftRemaining(slots, "a", 15);
    // Apply forward, then reverse: original times return.
    const shifted = slots.map((s) => {
      const f = forward.find((x) => x.id === s.id);
      return f ? { id: s.id, starts_at: f.starts_at } : s;
    });
    const back = computeShiftRemaining(shifted, "a", -15);
    expect(back.find((x) => x.id === "c")!.starts_at).toBe(slots[2].starts_at);
  });

  test("first slot as pivot moves the whole schedule", () => {
    const out = computeShiftRemaining(slots, "a", 5);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  test("unknown pivot or untimed pivot is a no-op", () => {
    expect(computeShiftRemaining(slots, "zzz", 10)).toEqual([]);
    expect(
      computeShiftRemaining([{ id: "x", starts_at: null }], "x", 10),
    ).toEqual([]);
  });

  test("untimed slots in the list are skipped, timed ones still shift", () => {
    const mixed = [
      { id: "a", starts_at: new Date(START).toISOString() },
      { id: "n", starts_at: null },
      { id: "c", starts_at: new Date(START + 50 * 60_000).toISOString() },
    ];
    const out = computeShiftRemaining(mixed, "a", 10);
    expect(out.map((o) => o.id)).toEqual(["a", "c"]);
  });
});
