import type { Role } from "@/lib/auth";
import type { PostgrestError } from "@supabase/supabase-js";

// Shared constants + helpers for the travel surface (§6, T016).
//
// Reads: every active member (travel rosters are visible to all roles per §2 —
// the flag is the gate). Writes: director/admin. RLS enforces the same; these
// gate the UI and the server-action re-check (Constitution I, defense in depth).

export const TRAVEL_WRITE_ROLES: readonly Role[] = ["director", "admin"];

export const TRAVEL_GROUP_KINDS = ["room", "bus"] as const;
export type TravelGroupKind = (typeof TRAVEL_GROUP_KINDS)[number];

export const GROUP_KIND_LABEL: Record<TravelGroupKind, string> = {
  room: "Room",
  bus: "Bus",
};

export const GROUP_KIND_LABEL_PLURAL: Record<TravelGroupKind, string> = {
  room: "Rooms",
  bus: "Buses",
};

// A trip's relevant group kinds. Day trips move by bus only; overnight trips
// (invitationals, spring tour) add rooms (§6). Drives which kinds a student must
// be placed into before they leave the unassigned queue.
export function relevantKinds(isOvernight: boolean): readonly TravelGroupKind[] {
  return isOvernight ? ["room", "bus"] : ["bus"];
}

// The one-room-one-bus-per-trip constraint trigger (0001_foundation.sql) raises a
// unique_violation, as does the plain unique(travel_group_id, student_id) index.
// Both surface as Postgres 23505 through PostgREST — either way the student is
// already placed, so one friendly message covers both (§6 "surface violations
// kindly").
export function isAlreadyPlacedError(
  error: PostgrestError | null | undefined,
): boolean {
  return error?.code === "23505";
}
