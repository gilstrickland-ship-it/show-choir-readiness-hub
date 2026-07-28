import { flashSection, type FlashMap } from "@/lib/flash";

// The ledger's URL contract (spec 005 Wave 8 / T142) — the app's shared flash
// shape (lib/flash), with the money surface's own codes.
//
// It lives in its own module rather than in `shared.tsx` beside LineSelect
// because both halves of the contract read it: the page renders from it and the
// server actions type their redirects against it, and an action module should
// not have to pull a React component in to learn which section its message
// belongs to.
//
//   page — the banner under the tabs: the add-entry drawer, the receipt upload,
//          the reconciliation record. Nothing here belongs to one row.
//   row  — inside ONE entry's "Fix this entry" panel, which reopens on
//          `?edit=<entryId>`. The page falls these back to the banner when that
//          row will not actually render (filtered out, on another page, or
//          voided and therefore drawn as inert text with no panel): a money
//          failure that renders NOWHERE is worse than one in the wrong place.

export type LedgerSection = "page" | "row";

export type LedgerOkKey = "saved";

export type LedgerErrorKey =
  | "entry"
  | "entry_tag"
  | "entry_season"
  | "entry_line"
  | "entry_competition"
  | "entry_trip"
  | "entry_commitment"
  | "receipt_type"
  | "receipt_upload"
  | "reconcile"
  | "void"
  | "void_reason"
  | "void_missing"
  | "void_already"
  | "void_archived"
  | "categorize"
  | "categorize_already"
  | "categorize_voided"
  | "categorize_missing"
  | "categorize_archived"
  | "categorize_line";

const LEDGER_OK: FlashMap<LedgerOkKey, LedgerSection> = {
  saved: { section: "page", message: "Saved." },
};

const LEDGER_ERROR: FlashMap<LedgerErrorKey, LedgerSection> = {
  entry: {
    section: "page",
    message:
      "Could not save the entry. Check the amount (e.g. 1,234.56), direction, and date.",
  },
  entry_tag: {
    section: "page",
    message:
      "That budget line, competition, trip, or commitment isn't in this season. Pick one from this season's lists.",
  },
  // One sentence per rejection the database can raise (0020). These used to be
  // one message about the amount format, so a tag from last season sent the
  // treasurer to re-check a number that was fine.
  entry_season: {
    section: "page",
    message:
      "That season isn't this program's, or it's archived — an archived season's books are closed. Nothing was saved.",
  },
  entry_line: {
    section: "page",
    message:
      "That budget line isn't on this season's budget. Pick one from this season's list. Nothing was saved.",
  },
  entry_competition: {
    section: "page",
    message:
      "That competition isn't in this season. Pick one from this season's list. Nothing was saved.",
  },
  entry_trip: {
    section: "page",
    message:
      "That trip isn't in this season. Pick one from this season's list. Nothing was saved.",
  },
  entry_commitment: {
    section: "page",
    message:
      "That commitment isn't in this season. Pick one from this season's list. Nothing was saved.",
  },
  receipt_type: { section: "page", message: "Receipts must be a PDF or image." },
  receipt_upload: {
    section: "page",
    message: "The receipt failed to upload. The entry was not saved.",
  },
  reconcile: {
    section: "page",
    message: "Could not update the reconciliation record.",
  },

  void: { section: "row", message: "Could not void that entry. Nothing changed." },
  void_reason: {
    section: "row",
    message: "A void needs a reason. Nothing changed.",
  },
  void_missing: {
    section: "row",
    message:
      "That entry isn't in this program. Reload the page and try again — nothing changed.",
  },
  void_already: {
    section: "row",
    message: "That entry was already voided. Nothing changed.",
  },
  void_archived: {
    section: "row",
    message: "That season is archived, so its books are closed. Nothing changed.",
  },
  categorize: {
    section: "row",
    message:
      "Could not put that entry on a budget line. Nothing changed — the entry is still there, uncategorized.",
  },
  // The double-submit case, said plainly: the filing WORKED, and the row this
  // message is about is the voided original it replaced.
  categorize_already: {
    section: "row",
    message:
      "Already filed. That amount is on a budget line now — this row is the voided original it replaced, and the replacement is in the list above.",
  },
  categorize_voided: {
    section: "row",
    message:
      "That entry was voided, so there is nothing to file. Nothing changed.",
  },
  categorize_missing: {
    section: "row",
    message:
      "That entry isn't in this program. Reload the page and try again — nothing changed.",
  },
  categorize_archived: {
    section: "row",
    message: "That season is archived, so its books are closed. Nothing changed.",
  },
  categorize_line: {
    section: "row",
    message:
      "That budget line isn't on this season's budget. Pick one from this season's list — nothing changed.",
  },
};

// An unrecognized `?error=` still says "Something went wrong." here. Over money
// a stale or renamed code means a write really did fail, and a treasurer who
// sees nothing at all assumes it worked.
export const LEDGER_FLASH_MAPS = {
  ok: LEDGER_OK,
  error: LEDGER_ERROR,
  fallbackSection: "page" as const,
};

export function ledgerErrorSection(key: LedgerErrorKey): LedgerSection {
  return flashSection(LEDGER_ERROR, key);
}

// True when this code belongs inside one entry's fix panel rather than the
// page banner — the answer the actions use to decide whether to address a row.
export function isRowLedgerError(key: LedgerErrorKey): boolean {
  return ledgerErrorSection(key) === "row";
}

// The anchor a row-addressed message scrolls to.
export function entryAnchor(entryId: string): string {
  return `fix-${entryId}`;
}
