// Host-mode module (Wave I / I1). Shared row types, enum tuples, and friendly
// label maps for the hosting surface. Kept out of any "use server" actions
// module (a server-actions file may only export async functions) so pages,
// actions, and the I2 PDF pipeline all import from one place — the wave-B
// convention (see lib/events.ts, lib/treasury.ts).
//
// Constitution III: hosted_schools stores ADULT professional director contact +
// a performer COUNT only. No visiting-school student data, ever. Free-text
// fields (venue_notes, arrival_notes, costume_colors, label) surface the
// standing no-health label below.

export const NO_HEALTH_LABEL = "Do not enter health or medical information.";

// Write is director/admin (RLS hosted_*_write). board_member reads (mirrors the
// read-only money seat); treasurer/costume_manager have no hosting access. The
// canonical definition lives in lib/nav.ts alongside the other role constants;
// re-exported here so the I2 actions (which import domain constants from this
// module) get it from one source.
export { HOSTING_WRITE_ROLES } from "@/lib/nav";

// ---------------------------------------------------------------------------
// hosted_event_status
// ---------------------------------------------------------------------------

export const HOSTED_EVENT_STATUSES = ["planning", "scheduled", "done"] as const;
export type HostedEventStatus = (typeof HOSTED_EVENT_STATUSES)[number];

export const HOSTED_EVENT_STATUS_LABELS: Record<HostedEventStatus, string> = {
  planning: "Planning",
  scheduled: "Scheduled",
  done: "Done",
};

// ---------------------------------------------------------------------------
// hosted_slot_kind
// ---------------------------------------------------------------------------

export const HOSTED_SLOT_KINDS = [
  "warmup",
  "perform",
  "break",
  "awards",
  "meal",
  "other",
] as const;
export type HostedSlotKind = (typeof HOSTED_SLOT_KINDS)[number];

export const HOSTED_SLOT_KIND_LABELS: Record<HostedSlotKind, string> = {
  warmup: "Warm-up",
  perform: "Perform",
  break: "Break",
  awards: "Awards",
  meal: "Meal",
  other: "Other",
};

// Schedule-generator defaults (I2): per-school warm-up + perform minutes. Kept
// here so the generator and the builder form read the same numbers.
export const DEFAULT_WARMUP_MINUTES = 25;
export const DEFAULT_PERFORM_MINUTES = 25;

// ---------------------------------------------------------------------------
// Row types (hand-written, mirroring the wave-B convention). Nullable columns
// are `| null` to match Supabase's returned shape.
// ---------------------------------------------------------------------------

export interface HostedEventRow {
  id: string;
  program_id: string;
  season_id: string;
  name: string;
  event_date: string | null;
  venue_notes: string | null;
  host_contact: string | null;
  status: HostedEventStatus;
  created_at: string;
  updated_at: string;
}

export interface HostedSchoolRow {
  id: string;
  program_id: string;
  hosted_event_id: string;
  school_name: string;
  ensemble_name: string | null;
  director_name: string | null;
  director_email: string | null;
  director_phone: string | null;
  performer_count: number | null;
  division: string | null;
  costume_colors: string | null;
  homeroom: string | null;
  arrival_notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HostedSlotRow {
  id: string;
  program_id: string;
  hosted_event_id: string;
  hosted_school_id: string | null;
  kind: HostedSlotKind;
  label: string | null;
  starts_at: string | null;
  duration_minutes: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Schedule generator (I2) — a pure, deterministic ladder. Kept here (not in the
// "use server" actions module) so it unit-tests directly and the builder form
// reads the same defaults. Times are computed in epoch-ms and returned as ISO
// UTC strings; the caller resolves the program-tz wall-clock start into a UTC
// instant (lib/datetime.zonedWallToUtc) before calling. No tz math lives here —
// the ladder is offset arithmetic only, which is exactly what makes it testable.
//
// Ladder (spec I1): each school gets a warm-up slot immediately followed by a
// perform slot, and its warm-up leads its own perform by warmupMinutes. The
// CADENCE between consecutive schools is the LONGER of the two durations, so a
// perform slot never starts before the previous school's perform has finished.
// Concretely, for school i (0-based in sort_order), with cadence = max(w, p):
//   warmup[i].start  = start + i * cadence
//   perform[i].start = warmup[i].start + warmupMinutes   (perform follows warmup)
// With the 25/25 defaults cadence == warmupMinutes, so warm-up[i+1] == perform[i]
// and the schedule is a seamless back-to-back pipeline. When perform is LONGER
// than warm-up (e.g. 15/30) the cadence widens to the perform length, keeping
// every school's stage time from colliding. The director reorders/edits after —
// this only seeds.

export interface GeneratedSlotInput {
  hosted_school_id: string;
  kind: HostedSlotKind; // 'warmup' | 'perform'
  label: string;
  starts_at: string; // ISO UTC
  duration_minutes: number;
  sort_order: number;
}

export function generateHostSchedule(opts: {
  startUtcMs: number;
  schools: { id: string; name: string }[];
  warmupMinutes: number;
  performMinutes: number;
}): GeneratedSlotInput[] {
  const { startUtcMs, schools, warmupMinutes, performMinutes } = opts;
  const w = Math.max(0, Math.round(warmupMinutes));
  const p = Math.max(0, Math.round(performMinutes));
  // Cadence between consecutive schools is the longer of the two durations, so no
  // two perform slots overlap even when a performance runs longer than warm-up.
  const cadence = Math.max(w, p);
  const out: GeneratedSlotInput[] = [];
  schools.forEach((school, i) => {
    const warmupStart = startUtcMs + i * cadence * 60_000;
    const performStart = warmupStart + w * 60_000;
    out.push({
      hosted_school_id: school.id,
      kind: "warmup",
      label: `${school.name} — Warm-up`,
      starts_at: new Date(warmupStart).toISOString(),
      duration_minutes: w,
      sort_order: i * 2,
    });
    out.push({
      hosted_school_id: school.id,
      kind: "perform",
      label: `${school.name} — Perform`,
      starts_at: new Date(performStart).toISOString(),
      duration_minutes: p,
      sort_order: i * 2 + 1,
    });
  });
  return out;
}

// "Shift remaining" (I2) — the "running 20 minutes behind" one-tap fix. Given the
// event's slots, a pivot slot id, and ±minutes, return the new starts_at for the
// pivot AND every slot at or after it (by starts_at). Pure so the arithmetic is
// unit-tested; the action applies the returned updates in one transaction. Slots
// with no starts_at can't be shifted (nothing to move) and are skipped. Positive
// pushes later, negative pulls earlier — reversible by shifting back.
export function computeShiftRemaining(
  slots: { id: string; starts_at: string | null }[],
  pivotId: string,
  deltaMinutes: number,
): { id: string; starts_at: string }[] {
  const pivot = slots.find((s) => s.id === pivotId);
  if (!pivot || !pivot.starts_at) return [];
  const threshold = new Date(pivot.starts_at).getTime();
  const deltaMs = Math.round(deltaMinutes) * 60_000;
  const out: { id: string; starts_at: string }[] = [];
  for (const s of slots) {
    if (!s.starts_at) continue;
    const ms = new Date(s.starts_at).getTime();
    if (Number.isNaN(ms) || ms < threshold) continue;
    out.push({ id: s.id, starts_at: new Date(ms + deltaMs).toISOString() });
  }
  return out;
}
