import type { Role } from "@/lib/auth";
import type { ItineraryItemKind } from "@/lib/competitions";

// Volunteer shifts (§8, T024). Shift *writes* are director/admin/treasurer/
// costume_manager (matches the shifts_write RLS policy) — the same people who run
// competition-day logistics. Signups arrive through the tokenized parent surface
// (§8a) or are entered by staff on a parent's behalf.
//
// The interesting part here is `suggestShifts`: a PURE derivation of DRAFT shift
// suggestions from a published itinerary + costume set transitions. It creates
// nothing — the director confirms editable pre-filled rows (Constitution IV
// spirit: derive a draft, never auto-commit). Kept pure (no DB, no env) so
// tests/unit covers it directly.

export const SHIFT_WRITE_ROLES: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
  "costume_manager",
];

// What a shift can attach to. `none` is a free-standing shift (a car wash).
export const SHIFT_ATTACH_KINDS = [
  "competition",
  "trip",
  "event",
  "none",
] as const;
export type ShiftAttachKind = (typeof SHIFT_ATTACH_KINDS)[number];

// ---- suggestShifts (pure derivation) --------------------------------------

// An itinerary item, reduced to just what the derivation needs. Times are ISO
// UTC strings (itinerary_items.starts_at/ends_at as stored) or null.
export interface SuggestItem {
  kind: ItineraryItemKind;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location?: string | null;
}

// A costume set for the performing ensemble, with whether any student is
// assigned a piece in it this season (an empty set implies no quick-change).
export interface CostumeSetInfo {
  id: string;
  name: string;
  sort_order: number;
  hasAssignments: boolean;
}

export type ShiftSuggestionOrigin =
  | "meal"
  | "load"
  | "checkin"
  | "quickchange";

// A single DRAFT suggestion. Rendered as an editable pre-filled row; nothing is
// created until the director confirms.
export interface ShiftSuggestion {
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  needed_count: number;
  notes: string | null;
  origin: ShiftSuggestionOrigin;
}

// Earliest item (by starts_at) of a given kind, or null.
function earliestOfKind(
  items: SuggestItem[],
  kind: ItineraryItemKind,
): SuggestItem | null {
  const withTime = items
    .filter((i) => i.kind === kind && i.starts_at)
    .sort((a, b) => (a.starts_at as string).localeCompare(b.starts_at as string));
  if (withTime.length > 0) return withTime[0];
  // Fall back to any item of the kind (time-less), so a check-in window still
  // suggests even before times are filled in.
  return items.find((i) => i.kind === kind) ?? null;
}

// Derive draft shift suggestions from itinerary items + costume set transitions.
// Deterministic and ordered by start time (null times sort last). Rules:
//   • each meal item        → a "Meal crew" shift for that window
//   • each load item        → a "Load crew" shift for that window
//   • arrive → homeroom      → a "Check-in crew" shift spanning that window
//   • consecutive costume sets (by sort_order, both with assignments)
//                            → a "Quick-change crew" shift placed in the gap
//                              between consecutive perform items
export function suggestShifts(args: {
  items: SuggestItem[];
  costumeSets: CostumeSetInfo[];
}): ShiftSuggestion[] {
  const { items, costumeSets } = args;
  const out: ShiftSuggestion[] = [];

  // Meal crew — one per meal item.
  for (const item of items.filter((i) => i.kind === "meal")) {
    out.push({
      title: `Meal crew — ${item.title}`,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      needed_count: 2,
      notes: item.location ? `At ${item.location}.` : null,
      origin: "meal",
    });
  }

  // Load crew — one per load item.
  for (const item of items.filter((i) => i.kind === "load")) {
    out.push({
      title: `Load crew — ${item.title}`,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      needed_count: 4,
      notes: item.location ? `At ${item.location}.` : null,
      origin: "load",
    });
  }

  // Check-in crew — the arrival → homeroom window (bag/roster check).
  const arrive = earliestOfKind(items, "arrive");
  if (arrive) {
    const homeroom = earliestOfKind(items, "homeroom");
    out.push({
      title: "Check-in crew",
      starts_at: arrive.starts_at,
      ends_at: homeroom?.starts_at ?? arrive.ends_at,
      needed_count: 2,
      notes: "Check students in and to their homeroom.",
      origin: "checkin",
    });
  }

  // Quick-change crew — one per consecutive costume-set transition, placed in
  // the gap between consecutive perform items. Sets are ordered by sort_order and
  // only sets with assignments count (an empty set has nobody to change).
  const dressedSets = [...costumeSets]
    .filter((s) => s.hasAssignments)
    .sort((a, b) => a.sort_order - b.sort_order);
  const performGaps = items
    .filter((i) => i.kind === "perform")
    .sort((a, b) =>
      (a.starts_at ?? "").localeCompare(b.starts_at ?? ""),
    );
  for (let k = 0; k + 1 < dressedSets.length; k++) {
    const from = dressedSets[k];
    const to = dressedSets[k + 1];
    // Gap k is between perform item k and k+1.
    const before = performGaps[k];
    const after = performGaps[k + 1];
    out.push({
      title: `Quick-change crew — ${from.name}→${to.name}`,
      starts_at: before ? before.ends_at ?? before.starts_at : null,
      ends_at: after ? after.starts_at : null,
      needed_count: 3,
      notes:
        before && after
          ? null
          : "Set the change window in review — no matching perform items yet.",
      origin: "quickchange",
    });
  }

  // Stable order by start time; time-less suggestions sort last.
  return out.sort((a, b) => {
    if (a.starts_at && b.starts_at) return a.starts_at.localeCompare(b.starts_at);
    if (a.starts_at) return -1;
    if (b.starts_at) return 1;
    return 0;
  });
}
