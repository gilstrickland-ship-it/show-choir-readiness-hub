import { flashSection, type FlashMap } from "@/lib/flash";

// The competitions LIST's URL contract (spec 005 Wave 10 / T157) — the shape
// lib/flash defines, filled in with the two jobs this page still owns.
//
// It replaces five hand-rolled `?error=` branches printed in a row above the
// table, none of which said which control had refused: "Pick a competition and
// try again" belonged to a packet form further up the page, the other four to a
// create form further down it. Two sections now, and each message renders inside
// the block that produced it.
//
//   add     — the every-field create form at `#add` (the Season drawer's
//             "More options →" target; the quick path is the drawer itself).
//   packets — the inbound-packet attach box, which only exists when an emailed
//             host packet landed with no competition on it.

export type CompListSection = "add" | "packets";

export type CompListErrorKey =
  | "name"
  | "season"
  | "ensemble"
  | "save"
  | "attach";

const COMP_LIST_ERROR: FlashMap<CompListErrorKey, CompListSection> = {
  name: { section: "add", message: "A competition needs a name." },
  season: {
    section: "add",
    message: "Activate a season before adding competitions.",
  },
  ensemble: {
    section: "add",
    message: "Pick at least one ensemble for the competition.",
  },
  save: { section: "add", message: "Couldn't save. Try again." },
  attach: {
    section: "packets",
    message: "Couldn't attach the packet. Pick a competition and try again.",
  },
};

// An unrecognized `?error=` still says something out loud: a stale or renamed
// code means a create really did fail, and staff who see nothing try again.
export const COMP_LIST_FLASH_MAPS = {
  error: COMP_LIST_ERROR,
  fallbackSection: "add" as const,
};

// The page anchor each section's messages scroll to — the same strings the
// actions append to their redirects, kept in one place so the two halves of the
// contract can't drift. `#add` is also the Season drawer's link target, and has
// to keep working (spec 005 US1).
export const COMP_LIST_ANCHOR: Record<CompListSection, string> = {
  add: "add",
  packets: "packets",
};

// The writing half: an action asks the map where its key belongs, so the anchor
// the URL carries and the block that renders the message are one decision.
export function compListErrorAnchor(key: CompListErrorKey): string {
  return COMP_LIST_ANCHOR[flashSection(COMP_LIST_ERROR, key)];
}
