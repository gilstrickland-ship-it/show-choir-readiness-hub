import type { Role } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared constants + helpers for the competitions surface (§5).
//
// Reads: every active member (competitions are visible to all roles per §2).
// Writes: director/admin. Attendance additionally allows costume_manager
// (matrix "Attendance edit"). RLS enforces the same; these gate the UI and the
// server-action re-check (Constitution I, defense in depth).

export const COMPETITION_WRITE_ROLES: readonly Role[] = ["director", "admin"];
export const ATTENDANCE_WRITE_ROLES: readonly Role[] = [
  "director",
  "admin",
  "costume_manager",
];

export const COMPETITION_STATUSES = ["planned", "confirmed", "done"] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

// Friendly labels for the competition status enum. The stored value is unchanged;
// only the displayed text differs (mirrors the treasury/hosting label-map idiom).
export const COMPETITION_STATUS_LABELS: Record<CompetitionStatus, string> = {
  planned: "Planned",
  confirmed: "Confirmed",
  done: "Done",
};

export const ATTENDANCE_STATUSES = ["expected", "absent", "partial"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ITINERARY_ITEM_KINDS = [
  "depart",
  "arrive",
  "homeroom",
  "warmup",
  "perform",
  "meal",
  "awards",
  "load",
  "other",
] as const;
export type ItineraryItemKind = (typeof ITINERARY_ITEM_KINDS)[number];

// Friendly labels for the itinerary-item kind dropdown. The stored enum value is
// unchanged; only the displayed text differs.
export const ITINERARY_ITEM_KIND_LABELS: Record<ItineraryItemKind, string> = {
  depart: "Depart",
  arrive: "Arrive",
  homeroom: "Homeroom",
  warmup: "Warm-up",
  perform: "Perform",
  meal: "Meal",
  awards: "Awards",
  load: "Load",
  other: "Other",
};

// Common caption awards, offered as checkboxes on the results form; the program
// can free-add anything not listed. Stored in competition_results.captions jsonb
// as { "Best Vocals": true, ... }.
export const COMMON_CAPTIONS: readonly string[] = [
  "Grand Champion",
  "Best Vocals",
  "Best Choreography",
  "Best Band",
  "Best Crew",
  "Best Show Design",
  "Best Soloist",
  "Best Costumes",
  "People's Choice",
];

// Idempotent attendance seed (§5, Constitution X, invariant §9.5). Upserts an
// `expected` row for every ensemble_member of the competition's ensemble+season,
// ignoring duplicates so it never clobbers a status a staffer already set — safe
// to re-run when the roster changes ("reseed"). No ensemble ⇒ no eligibility
// list ⇒ nothing to seed.
export async function seedAttendance(
  supabase: SupabaseClient,
  args: {
    programId: string;
    competitionId: string;
    ensembleId: string | null;
    seasonId: string | null;
  },
): Promise<{ seeded: number; error?: string }> {
  const { programId, competitionId, ensembleId, seasonId } = args;
  if (!ensembleId || !seasonId) return { seeded: 0 };

  const { data: members, error: readErr } = await supabase
    .from("ensemble_members")
    .select("student_id")
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .eq("ensemble_id", ensembleId);
  if (readErr) return { seeded: 0, error: readErr.message };

  const rows = ((members as { student_id: string }[] | null) ?? []).map((m) => ({
    program_id: programId,
    competition_id: competitionId,
    student_id: m.student_id,
    status: "expected" as const,
  }));
  if (rows.length === 0) return { seeded: 0 };

  const { error } = await supabase
    .from("attendance")
    .upsert(rows, {
      onConflict: "competition_id,student_id",
      ignoreDuplicates: true,
    });
  return { seeded: rows.length, error: error?.message };
}

// Normalize a captions jsonb blob to the set of caption names marked true.
export function activeCaptions(
  captions: Record<string, unknown> | null | undefined,
): string[] {
  if (!captions) return [];
  return Object.entries(captions)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}
