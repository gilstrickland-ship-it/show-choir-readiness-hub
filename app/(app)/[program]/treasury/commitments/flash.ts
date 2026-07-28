import { flashSection, type FlashMap } from "@/lib/flash";

// The commitments surface's URL contract — the app's shared flash shape
// (lib/flash), with this surface's own codes. Same two sections the ledger uses,
// for the same reason:
//
//   page — the banner under the tabs: raising a request, and anything that
//          happened to no particular row.
//   row  — inside ONE commitment's panel, which reopens on `?edit=<id>`. A
//          refused approval belongs beside the document it was refused for, not
//          at the top of a list the treasurer then has to scroll back down.
//
// Every sentence here is written for a volunteer treasurer, and the vocabulary
// is a requirement rather than a preference (spec 006 R9): the word
// "encumbrance" appears nowhere, a district commitment is a purchase order and a
// booster one is approved spending.

export type CommitmentSection = "page" | "row";

export type CommitmentOkKey =
  | "created"
  | "approved"
  | "approval_recorded"
  | "issued"
  | "received"
  | "closed"
  | "cancelled"
  | "revised"
  | "saved";

export type CommitmentErrorKey =
  // Raising a request
  | "create"
  | "create_amount"
  | "create_line"
  | "create_season"
  | "create_denied"
  // Moving one through its lifecycle
  | "act"
  | "act_state"
  | "act_self"
  | "act_denied"
  | "act_archived"
  | "act_missing"
  | "act_reason"
  | "act_second"
  | "act_twice"
  | "act_board"
  // Restating one
  | "revise"
  | "revise_amount"
  | "revise_state"
  | "revise_shape"
  | "revise_denied";

const COMMITMENT_OK: FlashMap<CommitmentOkKey, CommitmentSection> = {
  created: {
    section: "page",
    message:
      "Request raised. It is committed against its budget line from now, before any money moves — the treasurer approves it next.",
  },
  approved: { section: "page", message: "Approved." },
  // The first of two. It says what has happened and what has not, because "your
  // approval is recorded" on its own would read as "this is approved".
  approval_recorded: {
    section: "page",
    message:
      "Your approval is recorded. This one is over the amount your program allows on a single approval, so it is still a request until the treasurer approves it too.",
  },
  issued: { section: "page", message: "Marked as issued." },
  received: { section: "page", message: "Receipt recorded." },
  closed: {
    section: "page",
    message:
      "Closed, and whatever was left on it is available again — the amount released is recorded on the commitment.",
  },
  cancelled: {
    section: "page",
    message: "Cancelled. It no longer commits anything against its budget line.",
  },
  revised: {
    section: "page",
    message:
      "Revision recorded. The original stays exactly as it was, marked as replaced — a change to a purchase order is a new document, not an edit.",
  },
  saved: { section: "page", message: "Saved." },
};

const COMMITMENT_ERROR: FlashMap<CommitmentErrorKey, CommitmentSection> = {
  create: {
    section: "page",
    message:
      "Could not raise that request. Check the amount (e.g. 1,234.56) and that a budget line is picked.",
  },
  create_amount: {
    section: "page",
    message:
      "An amount above zero is what makes this a commitment. Nothing was saved.",
  },
  create_line: {
    section: "page",
    message:
      "That budget line isn't on this season's budget. Pick one from this season's list — a commitment with no line has nothing to be committed against. Nothing was saved.",
  },
  create_season: {
    section: "page",
    message:
      "That season isn't this program's, or it's archived — an archived season's books are closed. Nothing was saved.",
  },
  create_denied: {
    section: "page",
    message:
      "Your seat can't raise a request in this program. Nothing was saved.",
  },

  act: {
    section: "row",
    message: "Could not record that. Nothing changed.",
  },
  act_state: {
    section: "row",
    message:
      "That has already happened, or this commitment isn't at that step yet. Reload the page to see where it stands — nothing changed.",
  },
  // The whole point of the feature, said plainly rather than as a permission
  // error: the person who asks for the money is not the person who approves it.
  act_self: {
    section: "row",
    message:
      "You raised this request, so you can't also approve it. Someone else on the treasury side approves it — that separation is the reason a purchase order is worth anything. Nothing changed.",
  },
  act_denied: {
    section: "row",
    message:
      "Only the treasurer approves, issues, receives and closes a commitment. Nothing changed.",
  },
  act_archived: {
    section: "row",
    message: "That season is archived, so its books are closed. Nothing changed.",
  },
  act_missing: {
    section: "row",
    message:
      "That commitment isn't in this program. Reload the page and try again — nothing changed.",
  },
  act_reason: {
    section: "row",
    message: "Closing or cancelling needs a reason. Nothing changed.",
  },
  // The two thresholds that BLOCK (spec 006 D6). Both name the rule rather than
  // the mechanism, and both say where the number is set — a refusal a volunteer
  // cannot act on is a refusal she will find a way around.
  act_second: {
    section: "row",
    message:
      "This is over the amount your program allows on one approval, so it needs two. Somebody else — a director, an admin or a board member — approves it first, then the treasurer. Your director can change the amount in Settings → Spending rules. Nothing changed.",
  },
  act_twice: {
    section: "row",
    message:
      "You have already approved this one, and one person cannot be both of its two approvals. Nothing changed.",
  },
  act_board: {
    section: "row",
    message:
      "This is over the amount your program sends to the board, so the board minutes have to be on it before it is issued. Add them under “Reference numbers and notes” below. Nothing changed.",
  },

  revise: {
    section: "row",
    message:
      "Could not record the revision. Nothing changed — the original is untouched.",
  },
  revise_amount: {
    section: "row",
    message:
      "A revision needs an amount above zero (e.g. 1,234.56). Nothing changed.",
  },
  revise_state: {
    section: "row",
    message:
      "That commitment is closed, cancelled, or has already been revised, so there is nothing to restate. Nothing changed.",
  },
  revise_shape: {
    section: "row",
    message:
      "A revision keeps the original's kind, funding source and season. A different one of those is a different commitment, not a revision. Nothing changed.",
  },
  revise_denied: {
    section: "row",
    message:
      "Once a commitment is approved, only the treasurer restates it — otherwise somebody else's approval would ride along on an amount nobody re-approved. Nothing changed.",
  },
};

// An unrecognized `?error=` still says "Something went wrong." — over money a
// stale or renamed code means a write really did fail, and a treasurer who sees
// nothing at all assumes it worked.
export const COMMITMENT_FLASH_MAPS = {
  ok: COMMITMENT_OK,
  error: COMMITMENT_ERROR,
  fallbackSection: "page" as const,
};

export function commitmentErrorSection(
  key: CommitmentErrorKey,
): CommitmentSection {
  return flashSection(COMMITMENT_ERROR, key);
}

// True when this code belongs inside one commitment's panel rather than the page
// banner — the answer the actions use to decide whether to address a row.
export function isRowCommitmentError(key: CommitmentErrorKey): boolean {
  return commitmentErrorSection(key) === "row";
}

// The anchor a row-addressed message scrolls to.
export function commitmentAnchor(id: string): string {
  return `commitment-${id}`;
}
