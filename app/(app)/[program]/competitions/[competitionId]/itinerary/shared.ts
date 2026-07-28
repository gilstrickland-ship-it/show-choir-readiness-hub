import { flashSection, type FlashMap } from "@/lib/flash";

// The itinerary editor's URL contract (spec 005 Wave 10 / T156) — the shape
// lib/flash defines, filled in with what this surface's writes can say.
//
// What it replaces: FOUR search params whose only job was to print a message —
// `published`, `accepted`, `error`, plus a `published=1` that the share-link
// rotate also emitted so rotating a link claimed the itinerary had just been
// published. Every one of them rendered in a pile at the top of the page, above
// a table, a drawer and a publish gate, none of which owned the message.
//
// Now every code names its own section, once, here:
//
//   page   — the banner above the schedule: publishing, unpublishing, the parse
//            landing, and anything no single control owns.
//   drawer — inside the "+ Add an item" drawer, which reopens on its own refusal.
//   row    — inside ONE item's edit panel (arrives with `?edit=<itemId>`).
//   share  — inside the broadcast-link card, which mints the URL you get once.

export type ItinSection = "page" | "drawer" | "row" | "share";

export type ItinOkKey =
  | "published"
  | "unpublished"
  | "accepted"
  | "added"
  | "saved"
  | "removed"
  | "link";

export type ItinErrorKey =
  | "add"
  | "itinerary"
  | "save"
  | "remove"
  | "gone"
  | "share";

const ITIN_OK: FlashMap<ItinOkKey, ItinSection> = {
  published: {
    section: "page",
    message: "Itinerary published — families can see it now.",
  },
  unpublished: {
    section: "page",
    message: "Back to a draft. Families no longer see these times.",
  },
  accepted: {
    section: "page",
    message: "Parsed itinerary applied — check the items below, then publish.",
  },
  added: { section: "page", message: "Item added." },
  saved: { section: "page", message: "Item saved." },
  removed: { section: "page", message: "Item removed." },
  link: {
    section: "share",
    message: "New broadcast link made — the old one stopped working.",
  },
};

const ITIN_ERROR: FlashMap<ItinErrorKey, ItinSection> = {
  add: { section: "drawer", message: "Couldn't add that item. Try again." },
  itinerary: {
    section: "drawer",
    message:
      "This competition's itinerary isn't there anymore. Reload the page and try again.",
  },
  save: { section: "row", message: "Couldn't save that item. Try again." },
  remove: { section: "row", message: "Couldn't remove that item. Try again." },
  gone: {
    section: "row",
    message: "That item isn't on this itinerary anymore. Reload the page.",
  },
  share: {
    section: "share",
    message:
      "Couldn't make a broadcast link. The old one has been retired, so make a new one before sharing.",
  },
};

// An unrecognized `?error=` still says something out loud: this surface is the
// one families read, and staff who see nothing assume the change landed.
export const ITIN_FLASH_MAPS = {
  ok: ITIN_OK,
  error: ITIN_ERROR,
  fallbackSection: "page" as const,
};

// The writing half of the contract: an action building a redirect asks the map
// which section its key belongs to rather than repeating the answer at the call
// site, so the row it reopens and the block that renders the message are the
// same decision. Keyed by the union, so both halves compile together.
export function itinErrorSection(key: ItinErrorKey): ItinSection {
  return flashSection(ITIN_ERROR, key);
}

// True when this code belongs to ONE item's panel rather than to the page.
export function isRowItinError(key: ItinErrorKey): boolean {
  return itinErrorSection(key) === "row";
}

// One item's row anchor — the id on its <tr>, and the fragment a refused write
// scrolls back to. `table.members tr[id]` carries the scroll-margin that keeps
// it clear of the sticky header.
export function itemAnchor(itemId: string): string {
  return `item-${itemId}`;
}
