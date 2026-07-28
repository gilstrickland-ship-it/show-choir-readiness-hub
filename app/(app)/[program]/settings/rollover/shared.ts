import { flashSection, type FlashMap } from "@/lib/flash";

// The Seasons page's URL contract (spec 005 Wave 13 / T165), in the app's one
// flash idiom (lib/flash).
//
// The page has two message areas, and it always did — they were just not named.
// A rollover step that refuses is about the wizard the director is standing in;
// archiving a season is about the table below it. Both used to print at the top,
// and archive/unarchive rode two bespoke params (`?archived=1`, `?unarchived=1`)
// whose only job was to print one line each.

export type RolloverSection = "wizard" | "seasons";

export type RolloverOkKey = "archived" | "unarchived";
export type RolloverErrorKey =
  | "label"
  | "create"
  | "activate"
  | "season"
  | "archive"
  | "archive_active"
  | "archived_label"
  | "unarchive";

const ROLLOVER_OK: FlashMap<RolloverOkKey, RolloverSection> = {
  archived: {
    section: "seasons",
    message: "Season archived — it is read-only from here on.",
  },
  unarchived: {
    section: "seasons",
    message: "Season unarchived — it can be changed again.",
  },
};

const ROLLOVER_ERROR: FlashMap<RolloverErrorKey, RolloverSection> = {
  label: { section: "wizard", message: "Give the season a name, like 2027-28." },
  create: {
    section: "wizard",
    message: "Couldn't create the season. Try again.",
  },
  activate: {
    section: "wizard",
    message: "Couldn't switch to the new season. Try again.",
  },
  season: {
    section: "wizard",
    message: "That season isn't one of this program's. Start the rollover again.",
  },
  archive: {
    section: "seasons",
    message: "Couldn't archive that season. Try again.",
  },
  // Archiving freezes every season-scoped write (the vault, §9.4). Doing it to
  // the ACTIVE season leaves the program unable to write anything at all, with
  // no season to fall back to — so it is refused, not just hidden.
  archive_active: {
    section: "seasons",
    message:
      "You can't archive the season you're working in. Make another season the active one first, then archive this one.",
  },
  // The rollover wizard reuses a same-label season so a director can back up and
  // re-submit. An ARCHIVED one is not a season to reuse: adopting it would carry
  // the new year's roster into a frozen season and then un-freeze it by making
  // it active.
  archived_label: {
    section: "wizard",
    message:
      "There's already an archived season with that name. Give the new season a different name, or unarchive that one first if it's the one you meant.",
  },
  unarchive: {
    section: "seasons",
    message: "Couldn't unarchive that season. Try again.",
  },
};

export const ROLLOVER_FLASH_MAPS = {
  ok: ROLLOVER_OK,
  error: ROLLOVER_ERROR,
  fallbackSection: "wizard" as const,
};

export const ROLLOVER_ANCHOR: Record<RolloverSection, string> = {
  wizard: "rollover",
  seasons: "all-seasons",
};

export function rolloverOkAnchor(key: RolloverOkKey): string {
  return ROLLOVER_ANCHOR[flashSection(ROLLOVER_OK, key)];
}

export function rolloverErrorAnchor(key: RolloverErrorKey): string {
  return ROLLOVER_ANCHOR[flashSection(ROLLOVER_ERROR, key)];
}
