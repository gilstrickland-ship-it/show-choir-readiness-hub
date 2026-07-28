import type { Role } from "@/lib/auth";

// Constants for the events surface (§5a). Kept out of the "use server" actions
// module — a server-actions file may only export async functions, so shared
// constants live here and are imported by both the actions and the pages.
//
// Events write: director/admin (events_write in RLS; §2). All members read.

export const EVENTS_WRITE_ROLES: readonly Role[] = ["director", "admin"];

export const EVENT_KINDS = [
  "rehearsal",
  "fitting",
  "fundraiser",
  "banquet",
  "other",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// Friendly labels for the event-kind dropdown. Stored enum value is unchanged.
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  rehearsal: "Rehearsal",
  fitting: "Fitting",
  fundraiser: "Fundraiser",
  banquet: "Banquet",
  other: "Other",
};

// Move an event's end instant by however far its start moved, so a date fix
// keeps the event's LENGTH. This is what a director means by "the Tuesday
// rehearsal is now Thursday": the 7–9pm rehearsal is still two hours long. The
// Season page's row popover edits the start without showing the end, so without
// this a spine date fix would leave the end stranded on the old day.
//
// Both arguments are UTC instants, so the arithmetic is duration arithmetic and
// crossing a DST boundary is a non-event: the wall-clock end lands where the
// wall-clock start did. Returns null when there is nothing to move — no end
// time, a start that was or became unset, or unparseable input — and the caller
// leaves the stored end alone.
//
// Pure (no DB, no network), so tests/unit covers it directly.
export function shiftedEndInstant(
  previousStart: string | null,
  nextStart: string | null,
  previousEnd: string | null,
): string | null {
  if (!previousStart || !nextStart || !previousEnd) return null;
  const from = Date.parse(previousStart);
  const to = Date.parse(nextStart);
  const end = Date.parse(previousEnd);
  if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(end)) return null;
  return new Date(end + (to - from)).toISOString();
}
