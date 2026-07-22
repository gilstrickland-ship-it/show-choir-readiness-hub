import { describe, test, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  competitionRoster,
  competitionEnsembleMap,
  eventEnsembleMap,
  seedAttendance,
} from "@/lib/competitions";

// Multi-ensemble eligibility helpers (Feature 004, T104). The load-bearing
// property is DEDUP: a student rostered in two of a competition's participating
// ensembles must appear exactly once in the roster, in the seed, and in totals.
// These tests drive the helpers with a tiny fake Supabase query-builder that
// returns canned rows per table and captures the attendance upsert.

interface Captured {
  upsert?: { rows: Record<string, unknown>[]; opts: unknown };
}

// Minimal chainable stub: select/eq/in return `this`; awaiting resolves to the
// canned data for the last `from(table)`. upsert resolves immediately and records
// the payload.
function fakeClient(
  data: Record<string, unknown[]>,
  captured: Captured = {},
): SupabaseClient {
  const builder: Record<string, unknown> = {
    _table: "",
    from(t: string) {
      builder._table = t;
      return builder;
    },
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    in() {
      return builder;
    },
    upsert(rows: Record<string, unknown>[], opts: unknown) {
      captured.upsert = { rows, opts };
      return Promise.resolve({ error: null });
    },
    then(resolve: (v: { data: unknown[] }) => void) {
      resolve({ data: data[builder._table as string] ?? [] });
    },
  };
  return builder as unknown as SupabaseClient;
}

describe("competitionRoster", () => {
  test("dedupes a double-rostered student across participating ensembles", async () => {
    const supabase = fakeClient({
      ensemble_members: [
        { student_id: "s1" }, // ensemble A
        { student_id: "s2" }, // ensemble A
        { student_id: "s1" }, // ensemble B — same student, double-rostered
        { student_id: "s3" }, // ensemble B
      ],
    });
    const roster = await competitionRoster(supabase, {
      programId: "p1",
      seasonId: "sea1",
      ensembleIds: ["ensA", "ensB"],
    });
    expect(roster.slice().sort()).toEqual(["s1", "s2", "s3"]);
  });

  test("returns empty when no ensembles participate (no eligibility list)", async () => {
    const supabase = fakeClient({ ensemble_members: [{ student_id: "s1" }] });
    const roster = await competitionRoster(supabase, {
      programId: "p1",
      seasonId: "sea1",
      ensembleIds: [],
    });
    expect(roster).toEqual([]);
  });
});

describe("seedAttendance", () => {
  test("upserts one expected row per distinct student, ignoring duplicates", async () => {
    const captured: Captured = {};
    const supabase = fakeClient(
      {
        ensemble_members: [
          { student_id: "s1" },
          { student_id: "s1" }, // double-rostered
          { student_id: "s2" },
        ],
      },
      captured,
    );
    const res = await seedAttendance(supabase, {
      programId: "p1",
      competitionId: "c1",
      ensembleIds: ["ensA", "ensB"],
      seasonId: "sea1",
    });
    expect(res.seeded).toBe(2);
    expect(captured.upsert?.rows).toHaveLength(2);
    expect(captured.upsert?.rows.map((r) => r.student_id).sort()).toEqual(["s1", "s2"]);
    expect(captured.upsert?.rows.every((r) => r.status === "expected")).toBe(true);
    expect(captured.upsert?.opts).toMatchObject({
      onConflict: "competition_id,student_id",
      ignoreDuplicates: true,
    });
  });

  test("no ensembles ⇒ nothing seeded, no upsert", async () => {
    const captured: Captured = {};
    const supabase = fakeClient({ ensemble_members: [] }, captured);
    const res = await seedAttendance(supabase, {
      programId: "p1",
      competitionId: "c1",
      ensembleIds: [],
      seasonId: "sea1",
    });
    expect(res.seeded).toBe(0);
    expect(captured.upsert).toBeUndefined();
  });
});

describe("competitionEnsembleMap / eventEnsembleMap", () => {
  test("groups junction rows by parent id", async () => {
    const supabase = fakeClient({
      competition_ensembles: [
        { competition_id: "c1", ensemble_id: "e1" },
        { competition_id: "c1", ensemble_id: "e2" },
        { competition_id: "c2", ensemble_id: "e1" },
      ],
    });
    const map = await competitionEnsembleMap(supabase, "p1", ["c1", "c2"]);
    expect(map.get("c1")?.slice().sort()).toEqual(["e1", "e2"]);
    expect(map.get("c2")).toEqual(["e1"]);
  });

  test("event map omits whole-program events (zero rows)", async () => {
    const supabase = fakeClient({
      event_ensembles: [{ event_id: "ev1", ensemble_id: "e1" }],
    });
    const map = await eventEnsembleMap(supabase, "p1", ["ev1", "ev2"]);
    expect(map.get("ev1")).toEqual(["e1"]);
    expect(map.has("ev2")).toBe(false); // whole program
  });

  test("empty id list short-circuits to an empty map", async () => {
    const supabase = fakeClient({});
    expect((await competitionEnsembleMap(supabase, "p1", [])).size).toBe(0);
    expect((await eventEnsembleMap(supabase, "p1", [])).size).toBe(0);
  });
});
