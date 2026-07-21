import type { Role } from "@/lib/auth";

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
// read-only money seat); treasurer/costume_manager have no hosting access.
// Re-export the nav constants' shape here so I2 actions can import either module.
export const HOSTING_WRITE_ROLES: readonly Role[] = ["director", "admin"];

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
