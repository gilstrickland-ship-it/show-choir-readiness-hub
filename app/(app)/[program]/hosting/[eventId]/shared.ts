// The host command center's URL contract (spec 005 Wave 7 / US11).
//
// The page used to declare EIGHT search params whose only job was to show a
// toast — `saved`, `created`, `school_saved`, `school_removed`, `slot_saved`,
// `slot_removed`, `generated`, `shifted` (plus `dir` to decorate the last one) —
// each with its own hand-rolled render branch at the top of the page, far from
// the form that produced it. They collapse here into ONE `?ok=<key>` and ONE
// `?error=<key>`, and every key names the section it belongs to, so a message
// renders inside the section that owns what happened (the Wave-2 trip contract).
//
// Both lookups go through Object.hasOwn: the code rides in the URL, so
// `?error=constructor` must resolve to nothing rather than walking up
// Object.prototype and handing React a function to render.

export type HostSection = "overview" | "schools" | "schedule";

// Every key an action may put on the URL. The unions are the contract: the
// actions type their redirect helpers with them, so a key that isn't in the maps
// below cannot be emitted, and a key in a map that no action emits shows up in
// review rather than rotting silently.
export type HostOkKey =
  | "created"
  | "saved"
  | "school_saved"
  | "school_removed"
  | "slot_saved"
  | "slot_removed"
  | "generated"
  | "shifted_later"
  | "shifted_earlier";

export type HostErrorKey =
  | "archived"
  | "name"
  | "enddate"
  | "save"
  | "school_name"
  | "school_missing"
  | "school_save"
  | "school"
  | "slot_missing"
  | "start"
  | "noschools"
  | "delta"
  | "slot_save";

export interface HostFlash {
  section: HostSection;
  message: string;
}

const HOST_OK: Record<HostOkKey, HostFlash> = {
  created: { section: "overview", message: "Invitational created." },
  saved: { section: "overview", message: "Saved." },
  school_saved: { section: "schools", message: "School saved." },
  school_removed: {
    section: "schools",
    message:
      "School removed. Its schedule slots stayed, now with no school on them.",
  },
  slot_saved: { section: "schedule", message: "Schedule slot saved." },
  slot_removed: { section: "schedule", message: "Slot removed." },
  generated: {
    section: "schedule",
    message: "Schedule generated from your schools.",
  },
  // The shift's size used to ride the URL as `?shifted=20&dir=later`. The new
  // times are on screen a line below the message, so the number is already
  // there; the direction is the part that confirms the sign of what was typed,
  // and it fits in the key.
  shifted_later: {
    section: "schedule",
    message: "Moved that slot and everything after it that day later.",
  },
  shifted_earlier: {
    section: "schedule",
    message: "Moved that slot and everything after it that day earlier.",
  },
};

const HOST_ERROR: Record<HostErrorKey, HostFlash> = {
  archived: {
    section: "overview",
    message: "This season is archived — nothing here can be changed.",
  },
  name: { section: "overview", message: "The invitational needs a name." },
  enddate: {
    section: "overview",
    message:
      "The last day can't be before the first day. Leave it blank for a single-day event.",
  },
  save: {
    section: "overview",
    message: "Couldn't save the invitational. Try again.",
  },
  school_name: { section: "schools", message: "A school needs a name." },
  school_missing: {
    section: "schools",
    message: "That school isn't on this invitational anymore. Reload the page.",
  },
  school_save: {
    section: "schools",
    message: "Couldn't save that school. Try again.",
  },
  school: {
    section: "schedule",
    message: "Pick a visiting school from this invitational's list.",
  },
  slot_missing: {
    section: "schedule",
    message: "That slot isn't on this schedule anymore. Reload the page.",
  },
  start: {
    section: "schedule",
    message: "Pick a start time to generate the schedule.",
  },
  noschools: {
    section: "schedule",
    message: "Add at least one school before generating a schedule.",
  },
  delta: {
    section: "schedule",
    message: "Enter a non-zero number of minutes to shift.",
  },
  slot_save: {
    section: "schedule",
    message: "Couldn't save the schedule. Try again.",
  },
};

export function hostOk(code: string | null): HostFlash | null {
  if (!code || !Object.hasOwn(HOST_OK, code)) return null;
  return HOST_OK[code as HostOkKey];
}

export function hostError(code: string | null): HostFlash | null {
  if (!code || !Object.hasOwn(HOST_ERROR, code)) return null;
  return HOST_ERROR[code as HostErrorKey];
}

// The writing half of the contract: an action building a redirect asks the map
// which section its key belongs to rather than repeating the answer at the call
// site, so the anchor it scrolls to and the section that renders the message can
// never drift apart. Keyed by the union, so both halves are compile-checked.
export function hostOkSection(key: HostOkKey): HostSection {
  return HOST_OK[key].section;
}

export function hostErrorSection(key: HostErrorKey): HostSection {
  return HOST_ERROR[key].section;
}

// The page anchor each section's messages scroll to — the same strings the
// actions append to their redirects, kept in one place so the two halves of the
// contract can't drift.
export const HOST_ANCHOR: Record<HostSection, string> = {
  overview: "overview",
  schools: "schools",
  schedule: "schedule",
};
