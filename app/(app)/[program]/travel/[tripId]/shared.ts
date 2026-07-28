import { TRAVEL_GROUP_KINDS, type TravelGroupKind } from "@/lib/travel";
import { flashFrom, type FlashEntry, type FlashMap } from "@/lib/flash";

// Shapes and small helpers shared by the trip page and its section components
// (spec 005 Wave 2). The page runs every query once and hands the rows down;
// no section component queries anything.

export interface GroupRow {
  id: string;
  kind: TravelGroupKind;
  label: string;
  capacity: number | null;
  notes: string | null;
  sort_order: number;
}

export interface AssignmentRow {
  id: string;
  travel_group_id: string;
  student_id: string;
  student: { first_name: string; last_name: string } | null;
}

export interface ChaperoneRow {
  id: string;
  travel_group_id: string;
  guardian_id: string | null;
  name_override: string | null;
  guardian: { name: string } | null;
}

export interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

// "Last, First" — the order a bus manifest is read in.
export function studentName(s: {
  first_name: string;
  last_name: string;
}): string {
  return `${s.last_name}, ${s.first_name}`;
}

// ---- Section-local errors (US6-3) ------------------------------------------
// A failed action comes back on `?error=<code>`, and the message renders inside
// the section that owns what failed — not in one page-top pile the reader has to
// map back to a form. The two codes that could belong to either group section
// also carry `?errorKind=bus|room`, so the message lands in exactly one.
//
// The shape and the prototype-safe lookup are the app's shared ones (lib/flash,
// Wave 8 / T142); this file keeps what is the trip page's own — which codes
// exist, what they say, and which of its four sections owns each.

export type TripSection = "overview" | "group" | "chaperones" | "danger";

const TRIP_ERROR: FlashMap<string, TripSection> = {
  name: { section: "overview", message: "A trip needs a name." },
  dates: { section: "overview", message: "A trip can't end before it starts." },
  overnight_rooms: {
    section: "overview",
    message: "Remove this trip's rooms before making it a day trip.",
  },
  competition: {
    section: "overview",
    message: "Pick a competition from this program's list.",
  },
  save: { section: "overview", message: "Couldn't save the trip. Try again." },
  group: { section: "group", message: "A bus or a room needs a name." },
  group_missing: {
    section: "group",
    message: "That bus or room isn't on this trip anymore.",
  },
  group_delete: {
    section: "group",
    message: "Couldn't delete that bus or room. Try again.",
  },
  room_daytrip: {
    section: "group",
    message: "Rooms are for overnight trips — turn on Overnight in Overview first.",
  },
  assign: { section: "group", message: "Couldn't place that student. Try again." },
  student: {
    section: "group",
    message: "That student isn't on this trip's roster.",
  },
  chaperone: {
    section: "chaperones",
    message: "Pick a guardian or type a name for the chaperone.",
  },
  chaperone_group: {
    section: "chaperones",
    message: "That bus or room isn't on this trip anymore.",
  },
  chaperone_guardian: {
    section: "chaperones",
    message: "Pick a parent from this program's list.",
  },
  chaperone_name: {
    section: "chaperones",
    message: "Keep a one-off helper's name under 120 characters.",
  },
  trip_delete: {
    section: "danger",
    message: "Couldn't delete this trip. Try again.",
  },
};

// The code rides in the URL, so the lookup has to be a lookup and not a walk up
// Object.prototype — ?error=constructor would otherwise hand React a function to
// render. Anything unrecognized shows nothing, as it always did.
export function tripError(code: string | null): FlashEntry<TripSection> | null {
  return flashFrom(TRIP_ERROR, code);
}

// A group kind off the URL (?errorKind=, ?conflictKind=), or null when it isn't
// one. Same reason: an unchecked value reached GROUP_KIND_LABEL[kind] and took
// the page down with a TypeError.
export function asGroupKind(value: string | null): TravelGroupKind | null {
  return value && (TRAVEL_GROUP_KINDS as readonly string[]).includes(value)
    ? (value as TravelGroupKind)
    : null;
}

// The writing half of the same contract: an action building a redirect says
// which group section its message belongs in. Allow-listed through asGroupKind
// so anything that isn't a kind adds no query at all — the page then falls back
// to the Buses section rather than rendering an attacker-chosen fragment.
export function kindQuery(kind: string): string {
  const k = asGroupKind(kind);
  return k ? `&errorKind=${k}` : "";
}
