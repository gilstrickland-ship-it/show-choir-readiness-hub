import { flashFrom, flashSection, type FlashEntry, type FlashMap } from "@/lib/flash";

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
// This file is now the CONTENT of that contract and nothing else: the shape, the
// prototype-safe lookup, and the writing half live in lib/flash, where the trip
// page, the ledger and shifts read them too (Wave 8 / T142). What stays here is
// what is genuinely host-mode's — which codes exist, what they say, and which
// of the three sections owns each one.

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

export type HostFlash = FlashEntry<HostSection>;

const HOST_OK: FlashMap<HostOkKey, HostSection> = {
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

const HOST_ERROR: FlashMap<HostErrorKey, HostSection> = {
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
  return flashFrom(HOST_OK, code);
}

export function hostError(code: string | null): HostFlash | null {
  return flashFrom(HOST_ERROR, code);
}

// The writing half of the contract: an action building a redirect asks the map
// which section its key belongs to rather than repeating the answer at the call
// site, so the anchor it scrolls to and the section that renders the message can
// never drift apart. Keyed by the union, so both halves are compile-checked.
export function hostOkSection(key: HostOkKey): HostSection {
  return flashSection(HOST_OK, key);
}

export function hostErrorSection(key: HostErrorKey): HostSection {
  return flashSection(HOST_ERROR, key);
}

// The page reads both codes in one call; the maps are not exported, so nothing
// outside this file can look a code up without the guards.
export const HOST_FLASH_MAPS = { ok: HOST_OK, error: HOST_ERROR } as const;

// The page anchor each section's messages scroll to — the same strings the
// actions append to their redirects, kept in one place so the two halves of the
// contract can't drift.
export const HOST_ANCHOR: Record<HostSection, string> = {
  overview: "overview",
  schools: "schools",
  schedule: "schedule",
};
