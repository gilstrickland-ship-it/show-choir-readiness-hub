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

// ============================================================================
// Cross-tenant reference guards (Constitution I, defense in depth).
// ----------------------------------------------------------------------------
// A server action proving the CALLER is a director of the program they claimed
// does not prove the uuids they posted belong to that program. Every action that
// accepts a competition id / ensemble id from a form resolves it here first, so
// a hand-edited hidden field can never stamp this program's rows onto another
// program's records. RLS still gates the write; this is the layer that makes the
// failure a friendly message instead of an invisible poisoned row.
// ============================================================================

// The competition row an action is allowed to touch: its id AND the season it
// belongs to, read off the stored row. Callers that need the season take it from
// here rather than from a hidden field — a posted season is one more id to check,
// and a form that doesn't carry one (the slim ensemble-change confirm) would
// otherwise silently skip the season-scoped cleanup.
export interface ResolvedCompetition {
  id: string;
  season_id: string;
}

export async function resolveCompetition(
  supabase: SupabaseClient,
  programId: string,
  competitionId: string,
): Promise<ResolvedCompetition | null> {
  if (!programId || !competitionId) return null;
  const { data } = await supabase
    .from("competitions")
    .select("id, season_id")
    .eq("id", competitionId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as ResolvedCompetition | null) ?? null;
}

// The competition id, only when it belongs to `programId`. Null otherwise —
// callers redirect to their surface's existing error state.
export async function resolveCompetitionId(
  supabase: SupabaseClient,
  programId: string,
  competitionId: string,
): Promise<string | null> {
  return (await resolveCompetition(supabase, programId, competitionId))?.id ?? null;
}

// True when every posted ensemble id belongs to `programId`. A partial match is
// a rejection, not a silent drop: quietly ignoring an id would change who a
// competition/event is for without saying so.
export async function ensemblesInProgram(
  supabase: SupabaseClient,
  programId: string,
  ensembleIds: string[],
): Promise<boolean> {
  if (ensembleIds.length === 0) return true;
  const { data } = await supabase
    .from("ensembles")
    .select("id")
    .eq("program_id", programId)
    .in("id", ensembleIds);
  return ((data as { id: string }[] | null) ?? []).length === ensembleIds.length;
}

// The season id, only when it belongs to `programId`. Seasons are the parent of
// competitions, events, hosted events, budgets and costume sets, so the same
// guard is needed on every one of those create paths.
export async function resolveSeasonId(
  supabase: SupabaseClient,
  programId: string,
  seasonId: string,
): Promise<string | null> {
  if (!programId || !seasonId) return null;
  const { data } = await supabase
    .from("seasons")
    .select("id")
    .eq("id", seasonId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// ============================================================================
// Multi-ensemble eligibility helpers (Feature 004, research D5).
// ----------------------------------------------------------------------------
// A competition's participating ensembles live in the `competition_ensembles`
// junction; an event's targeted ensembles in `event_ensembles` (zero rows =
// whole program). Every "who is in this competition" read resolves through the
// junction → ensemble_members (Constitution VI), deduplicated per student so a
// double-rostered student appears exactly once.
// ============================================================================

// The ensemble ids participating in one competition (the junction rows).
export async function competitionEnsembleIds(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("competition_ensembles")
    .select("ensemble_id")
    .eq("competition_id", competitionId);
  return ((data as { ensemble_id: string }[] | null) ?? []).map((r) => r.ensemble_id);
}

// A short, order-independent fingerprint of an ensemble SET.
//
// Removing an ensemble is destructive (it deletes attendance rows and
// comp-scoped costume checkouts), so it is confirmed on a screen that names the
// students who lose eligibility. That screen is a round trip: the set can move
// under the director between the page rendering and the button being pressed,
// and the old confirm applied the removal anyway — so an ensemble somebody else
// added in between was dropped without ever appearing in what was approved.
//
// The confirm form carries this fingerprint of the set it DISPLAYED; the action
// recomputes it from the set it re-reads and refuses when they differ. Cheap
// enough to ride in a form field (FNV-1a, plus the count, so two sets of
// different sizes cannot collide) — the guard is against concurrency, not
// against an attacker: forging it only forces the confirmation you were already
// entitled to see.
export function ensembleSetFingerprint(ensembleIds: readonly string[]): string {
  const joined = [...new Set(ensembleIds)].sort().join(",");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    // FNV prime, via Math.imul so the multiply stays 32-bit.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${new Set(ensembleIds).size}-${hash.toString(36)}`;
}

// competition_id → its participating ensemble ids, for a batch of competitions
// (list/season pages that would otherwise N+1). Scoped by program_id.
export async function competitionEnsembleMap(
  supabase: SupabaseClient,
  programId: string,
  competitionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (competitionIds.length === 0) return map;
  const { data } = await supabase
    .from("competition_ensembles")
    .select("competition_id, ensemble_id")
    .eq("program_id", programId)
    .in("competition_id", competitionIds);
  for (const r of (data as { competition_id: string; ensemble_id: string }[] | null) ?? []) {
    const list = map.get(r.competition_id) ?? [];
    list.push(r.ensemble_id);
    map.set(r.competition_id, list);
  }
  return map;
}

// event_id → its targeted ensemble ids for a batch of events. An event absent
// from the returned map (zero rows) targets the whole program (D2).
export async function eventEnsembleMap(
  supabase: SupabaseClient,
  programId: string,
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (eventIds.length === 0) return map;
  const { data } = await supabase
    .from("event_ensembles")
    .select("event_id, ensemble_id")
    .eq("program_id", programId)
    .in("event_id", eventIds);
  for (const r of (data as { event_id: string; ensemble_id: string }[] | null) ?? []) {
    const list = map.get(r.event_id) ?? [];
    list.push(r.ensemble_id);
    map.set(r.event_id, list);
  }
  return map;
}

// The targeted ensemble ids for one event (empty = whole program).
export async function eventEnsembleIds(
  supabase: SupabaseClient,
  eventId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("event_ensembles")
    .select("ensemble_id")
    .eq("event_id", eventId);
  return ((data as { ensemble_id: string }[] | null) ?? []).map((r) => r.ensemble_id);
}

// Distinct active-season student ids across a competition's participating
// ensembles (the competition roster). Reads through ensemble_members
// (Constitution VI); a double-rostered student appears once. Pass ensembleIds
// when already loaded to skip the junction round-trip.
export async function competitionRoster(
  supabase: SupabaseClient,
  args: {
    programId: string;
    seasonId: string;
    competitionId?: string;
    ensembleIds?: string[];
  },
): Promise<string[]> {
  const { programId, seasonId } = args;
  const ensembleIds =
    args.ensembleIds ??
    (args.competitionId
      ? await competitionEnsembleIds(supabase, args.competitionId)
      : []);
  if (ensembleIds.length === 0) return [];

  const { data } = await supabase
    .from("ensemble_members")
    .select("student_id")
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .in("ensemble_id", ensembleIds);
  return Array.from(
    new Set(((data as { student_id: string }[] | null) ?? []).map((m) => m.student_id)),
  );
}

// Idempotent attendance seed (§5, Constitution X, invariant §9.5). Upserts an
// `expected` row for every active-season member of the competition's
// PARTICIPATING ensembles (the union, deduplicated per student), ignoring
// duplicates so it never clobbers a status a staffer already set — safe to
// re-run when the roster changes ("reseed"). No ensembles ⇒ no eligibility
// list ⇒ nothing to seed. Adding an ensemble later reseeds only its members
// (existing rows are untouched by ignoreDuplicates).
export async function seedAttendance(
  supabase: SupabaseClient,
  args: {
    programId: string;
    competitionId: string;
    ensembleIds: string[];
    seasonId: string | null;
  },
): Promise<{ seeded: number; error?: string }> {
  const { programId, competitionId, ensembleIds, seasonId } = args;
  if (ensembleIds.length === 0 || !seasonId) return { seeded: 0 };

  const studentIds = await competitionRoster(supabase, {
    programId,
    seasonId,
    ensembleIds,
  });

  const rows = studentIds.map((student_id) => ({
    program_id: programId,
    competition_id: competitionId,
    student_id,
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
