import {
  COMMITMENT_FUNDING_SOURCES,
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  FUNDING_SOURCE_LABELS,
  NO_HEALTH_LABEL,
  type CommitmentKind,
} from "@/lib/treasury";
import { LineSelect, type LineOptions } from "../shared";
import { createCommitment } from "./actions";

// Raising a request (spec 006 §6). Five decisions, in the order a director makes
// them: who, what for, how much, out of which budget line, by when. The two
// choices above them — what kind of promise this is, and which purse it comes
// out of — are one row, because they change what every label underneath MEANS.
//
// THE BUDGET LINE IS REQUIRED, and it is the only required select on any money
// form in this app. A ledger entry may arrive uncategorized and be filed later;
// a commitment may not, because a commitment with no line has nothing to be
// committed against — no line, no encumbrance, no math.
//
// Shipping and tax sit behind a disclosure but are on THIS form rather than
// "later, before issue", because 0021 freezes them at insert: after that they
// can only change through a revision. Omitting them is the documented top cause
// of an invoice arriving larger than the purchase order, so the disclosure says
// so rather than hiding them silently.
//
// NOTHING REQUIRED LIVES INSIDE THE DISCLOSURE. A required field inside a
// collapsed <details> cannot be focused, so the browser refuses the whole submit
// and reports nothing anyone can see — the form simply stops working (the ledger
// drawer learned this the hard way).
//
// NO STUDENT ANYWHERE ON THIS FORM, ever (R8). A commitment ties to a budget
// line, which is a program-wide purpose. Tying committed money to an individual
// student is the private-benefit hazard that cost a real booster club its tax
// exemption.

// What the two subtypes call the counterparty and the money. Same machinery,
// different words: an inbound promise is not a purchase order with the sign
// flipped, and labelling it as one would teach a false model (decision D4).
const KIND_WORDS: Record<
  CommitmentKind,
  { who: string; whoHint: string; what: string; whatHint: string; amount: string; by: string }
> = {
  spending: {
    who: "Vendor",
    whoHint: "Premiere Costume Co",
    what: "What it is for",
    whatHint: "Premiere costumes — spring set",
    amount: "Amount we have promised to pay",
    by: "Needed by",
  },
  expected: {
    who: "Who has promised it",
    whoHint: "District activity office · Rotary Club · Eastside Schools",
    what: "What it is for",
    whatHint: "District allocation · grant award · entry fees they owe us",
    amount: "Amount promised to us",
    by: "Expected by",
  },
};

export function AddCommitment({
  programId,
  slug,
  seasonId,
  options,
  kind,
  open,
}: {
  programId: string;
  slug: string;
  seasonId: string;
  options: LineOptions;
  // Which subtype the drawer opens on. The page passes the section the director
  // pressed "add" in, so raising expected money never starts on a form that
  // calls the payer a vendor.
  kind: CommitmentKind;
  open: boolean;
}) {
  const words = KIND_WORDS[kind];
  const isSpending = kind === "spending";
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">
        {isSpending ? "+ Commit money" : "+ Record money promised"}
      </summary>
      <div className="drawer-panel" id="add-commitment">
        <h2 className="drawer-title">
          {isSpending ? "Commit money to something" : "Record money promised to us"}
        </h2>
        <p className="muted">
          {isSpending
            ? "This is money the program has promised but has not paid yet. It comes out of the budget line's still-available balance from now — which is the whole point — and out of the bank account later, when you record the payment."
            : "This is money somebody has promised the program. It is tracked and reported separately and does NOT raise what you can spend: you may not spend money you have merely been promised."}
        </p>
        <form action={createCommitment} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="seasonId" value={seasonId} />

          <div className="row-inline">
            <label>
              What kind
              <select name="kind" defaultValue={kind}>
                {COMMITMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {COMMITMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Which account
              {/* The two purses (spec §3). Numbering, identity and tax treatment
                  never mix across them — a booster must never issue, or appear
                  to issue, the district's purchase order. Only the reporting
                  blends. */}
              <select name="funding_source" defaultValue="district">
                {COMMITMENT_FUNDING_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {FUNDING_SOURCE_LABELS[s]}
                    {s === "district" ? " (district account)" : " (booster account)"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="money-decisions">
            <label>
              {words.who}
              <input
                type="text"
                name="vendor"
                required
                placeholder={words.whoHint}
              />
            </label>
            <label>
              {words.what}
              <input
                type="text"
                name="purpose"
                required
                placeholder={words.whatHint}
              />
            </label>
            <label>
              {words.amount} $
              <input
                type="text"
                name="amount"
                inputMode="decimal"
                required
                placeholder="3,200.00"
              />
            </label>
            <label>
              {words.by}
              <input type="date" name="need_by" />
            </label>
          </div>

          <label>
            Budget line
            <LineSelect
              name="budget_line_id"
              defaultValue=""
              options={options}
              blankLabel="Pick a line"
              required
            />
          </label>

          <details className="stack">
            <summary className="money-disclosure">
              Shipping, tax and reference numbers — optional
            </summary>
            <div className="stack money-connect">
              <p className="muted">
                Leaving shipping and tax out is the most common reason an invoice
                arrives bigger than the purchase order. They are fixed once this
                is saved — changing them later means recording a revision — so
                put in your best estimate now if you have one.
              </p>
              <div className="row-inline">
                <label>
                  Shipping $
                  <input
                    type="text"
                    name="shipping"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Tax $
                  <input
                    type="text"
                    name="tax"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
              </div>
              <label>
                {isSpending
                  ? "The district's own PO number, if it has one"
                  : "Their reference number, if there is one"}
                <input type="text" name="external_ref" placeholder="e.g. 24-01187" />
              </label>
              <label>
                Note
                <input type="text" name="note" placeholder="Anything worth remembering" />
              </label>
            </div>
          </details>

          {/* R6, in neutral copy. After-the-fact commitments are the #1
              documented policy violation, and blocking them means they are
              simply never recorded — so they are allowed and marked, and the
              count of them is one of the most useful numbers on a board
              snapshot. */}
          <label className="checkbox-inline">
            <input type="checkbox" name="after_the_fact" value="1" />
            Recorded after the purchase
          </label>

          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit">
            {isSpending ? "Raise this request" : "Record it"}
          </button>
          <p className="muted">
            {isSpending
              ? "You are asking; the treasurer approves. Whoever raises a request cannot be the one who approves it — that separation is what makes a purchase order worth anything, and the database enforces it."
              : "The treasurer records the money when it actually arrives, on the ledger, against this."}
          </p>
        </form>
      </div>
    </details>
  );
}
