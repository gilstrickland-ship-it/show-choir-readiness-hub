import { flashSection, type FlashMap } from "@/lib/flash";

// The shifts page's URL contract (spec 005 Wave 8 / T142) — the same shape the
// host command center uses, now shared through lib/flash.
//
// What it replaces: FIVE search params whose only job was to print a toast
// (`created`, `saved`, `deleted`, `signed`, `cancelled`, one render branch
// each), plus THREE separate error objects and a private `message()` helper that
// the page then had to fall through in order. The section a message belongs to
// was implied by which of the three objects held the code — so the same code
// could mean two things and the page needed a paragraph of comment to say which.
//
// Now every code names its own section, once, here. `?ok=` and `?error=` are the
// only message params the page reads.
//
//   page    — the banner above the list: things no single control owns.
//   drawer  — inside the "Add a shift" drawer, which reopens on its own failure.
//   panel   — inside ONE shift's Edit panel (arrives with `?edit=<shiftId>`).
//   signup  — beside ONE shift's add-a-name box; must NOT spring Edit open.

export type ShiftSection = "page" | "drawer" | "panel" | "signup";

export type ShiftOkKey =
  | "created"
  | "suggested"
  | "saved"
  | "deleted"
  | "signed"
  | "cancelled";

// `row_title` and `title` say the same sentence on purpose: they are the same
// rule failing in two different forms, and a code can only name one home. They
// used to share the single code `title`, which is why the page had to work out
// from the presence of `?edit=` which of two maps to read it from.
export type ShiftErrorKey =
  | "title"
  | "season"
  | "save"
  | "attach"
  | "share"
  | "row_title"
  | "in_use"
  | "name"
  | "shift";

const SHIFT_OK: FlashMap<ShiftOkKey, ShiftSection> = {
  // The count used to ride the URL as `?created=<n>`. The shifts it made are
  // listed directly below the message, so the number was already on screen —
  // and "Created 3 shift(s)." was never a sentence anyone writes.
  created: { section: "page", message: "Shift added." },
  suggested: {
    section: "page",
    message: "Shifts added from the itinerary.",
  },
  saved: { section: "page", message: "Shift saved." },
  deleted: { section: "page", message: "Shift deleted." },
  signed: { section: "page", message: "Signup added." },
  cancelled: { section: "page", message: "Signup cancelled." },
};

const SHIFT_ERROR: FlashMap<ShiftErrorKey, ShiftSection> = {
  title: { section: "drawer", message: "A shift needs a title." },
  season: {
    section: "drawer",
    message: "Activate a season before adding shifts.",
  },
  save: { section: "drawer", message: "Couldn't save. Try again." },
  attach: {
    section: "drawer",
    message:
      "That competition, trip, or event isn't part of this program. Reload the page and pick one from the list.",
  },
  share: {
    section: "page",
    message:
      "Couldn't make a signup link. The old link has been retired, so make a new one before sharing.",
  },
  row_title: { section: "panel", message: "A shift needs a title." },
  in_use: {
    section: "panel",
    message:
      "Couldn't delete this shift — something still refers to it, so it's still here.",
  },
  name: { section: "signup", message: "A signup needs a name." },
  shift: {
    section: "signup",
    message: "That shift isn't part of this program. Reload the page and try again.",
  },
};

// An unrecognized `?error=` still says something out loud here: a stale or
// renamed code means a write really did fail, and staff who see nothing assume
// it worked.
export const SHIFT_FLASH_MAPS = {
  ok: SHIFT_OK,
  error: SHIFT_ERROR,
  fallbackSection: "page" as const,
};

// The writing half: an action asks the map where its key belongs, so the URL it
// builds (a row address plus an anchor, or a plain page message) and the block
// that renders the message are the same decision.
export function shiftErrorSection(key: ShiftErrorKey): ShiftSection {
  return flashSection(SHIFT_ERROR, key);
}

// True when this code belongs to one shift's row rather than to the page.
export function isRowShiftError(key: ShiftErrorKey): boolean {
  const section = shiftErrorSection(key);
  return section === "panel" || section === "signup";
}

export function shiftAnchor(shiftId: string): string {
  return `shift-${shiftId}`;
}
