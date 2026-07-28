import Link from "next/link";
import {
  formatCents,
  stillAvailable,
  type CategoryDirection,
  type CommitmentTotals,
  type LedgerSeasonTotals,
} from "@/lib/treasury";

// The board snapshot's on-screen half (spec 005 Wave 12 / T162) — the same
// season figures the PDF prints, in the same meaning, said in the ledger's
// words. THE NUMBERS AND WHAT THEY MEAN ARE A FIDUCIARY CONTROL: this file may
// change how they are labelled and laid out, never what is counted. Two lines
// in particular are verbatim by intent — "Reconciled through {Month YYYY}" /
// "No months reconciled yet." (the reconciliation control, restated identically
// in lib/pdf/documents) and the download link's name.
//
// Every figure here is a 0019 SQL aggregate, and BOTH aggregates can fail on
// their own: the category rollups come from ledger_line_actuals, the header
// figures and the uncategorized count from ledger_season_totals. A failure in
// either renders "—" and says so. Not "$0.00" — that is a number a treasurer
// reads to a board, and this is the page she reads it from.
//
// A category's figure is that category's OWN direction: an income category
// reports money in, an expense category money out (lib/treasury
// actualForDirection), which is the same split the header figures use and the
// same one the downloadable PDF prints. The column says so, because "Total so
// far" over a directional figure is how the two surfaces came to disagree.

export interface SnapshotCatRow {
  id: string;
  name: string;
  direction: CategoryDirection;
}

const DIRECTION_WORDS: Record<CategoryDirection, string> = {
  income: "Money in",
  expense: "Money out",
};

export function BoardSnapshot({
  slug,
  seasonId,
  asOf,
  reconciledThroughLabel,
  reconciledUnavailable,
  cats,
  catActual,
  totals,
  plannedExpense,
  commitments,
  actualsUnavailable,
  structureUnavailable,
}: {
  slug: string;
  seasonId: string;
  asOf: string;
  reconciledThroughLabel: string | null;
  // The reconciliation read having failed — a third state, because "No months
  // reconciled yet" is a statement about the books, not about the read.
  reconciledUnavailable: boolean;
  cats: SnapshotCatRow[];
  catActual: Map<string, number>;
  totals: LedgerSeasonTotals | null;
  // The two halves of "still available", each nullable on its own: what the
  // season planned to spend (the budget's own lines) and what it has already
  // promised (public.commitment_totals). Null is "we could not read it", and a
  // number built from a null operand is never printed.
  plannedExpense: number | null;
  commitments: CommitmentTotals | null;
  actualsUnavailable: boolean;
  structureUnavailable: boolean;
}) {
  // A FRAGMENT, not a wrapper div: `.stack` is `align-items: flex-start` and
  // `table.members` is a scroll container, so a table nested one .stack deeper
  // shrink-wraps to the width of its widest sibling. The category table below
  // measured full width only because an error banner happened to be open beside
  // it — on the healthy page, the one a board actually sees, it collapsed.
  return (
    <>
      <h2>Board snapshot</h2>
      <p className="muted">
        The monthly-meeting summary. Full financial transparency to the board is
        a fiduciary norm — and the treasurer&apos;s protection. As of {asOf}.
      </p>
      {reconciledUnavailable ? (
        <p className="alert-error">
          Which months are reconciled couldn&apos;t be read just now — this is
          blank, not &ldquo;none&rdquo;. Reload to try again.
        </p>
      ) : (
        <p className="muted">
          {reconciledThroughLabel
            ? `Reconciled through ${reconciledThroughLabel}.`
            : "No months reconciled yet."}
        </p>
      )}

      {/* The banner used to key on the totals rpc only, so a failed per-line
          read printed $0.00 in every category rollup with nothing saying so. It
          names whichever one is missing now. */}
      {(!totals || actualsUnavailable) && (
        <p className="alert-error">
          {!totals && actualsUnavailable
            ? "The season totals and the category rollups could not be read just now, so the figures below are blank rather than wrong."
            : !totals
              ? "The season totals could not be read just now, so the header figures below are blank rather than wrong."
              : "The category rollups could not be read just now, so the Total column below is blank rather than wrong."}{" "}
          Reload to try again — do not present this page to the board until it
          shows numbers.
        </p>
      )}

      {structureUnavailable && (
        <p className="alert-error">
          The budget&apos;s categories could not be read just now, so the
          breakdown below is shorter than the budget is — not empty. Reload to
          try again.
        </p>
      )}

      <dl className="detail-list">
        <dt>Money in</dt>
        <dd className="num">{totals ? formatCents(totals.inCents) : "—"}</dd>
        <dt>Money out</dt>
        <dd className="num">{totals ? formatCents(totals.outCents) : "—"}</dd>
        <dt>Net (in − out)</dt>
        <dd className="num">
          <strong>{totals ? formatCents(totals.netCents) : "—"}</strong>
        </dd>
      </dl>

      <StillAvailableBlock
        slug={slug}
        plannedExpense={plannedExpense}
        spentExpense={totals?.outCents ?? null}
        commitments={commitments}
      />

      <h3>By category</h3>
      <table className="members money-ledger">
        <thead>
          <tr>
            <th>Category</th>
            <th>In or out</th>
            <th className="right">So far this season</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{DIRECTION_WORDS[c.direction]}</td>
              <td className="right">
                {actualsUnavailable
                  ? "—"
                  : formatCents(catActual.get(c.id) ?? 0)}
              </td>
            </tr>
          ))}
          {cats.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No budget categories yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* "Every entry is on a budget line" is a CLAIM, and it was being made out
          of `totals?.uncategorizedCount ?? 0` — so a failed totals read told a
          board the books were tidy. With no count in hand this page now says it
          has no count. */}
      {!totals ? (
        <p className="muted">
          Whether every entry is on a budget line couldn&apos;t be read just
          now.
        </p>
      ) : totals.uncategorizedCount > 0 ? (
        <p className="alert-error">
          {totals.uncategorizedCount}{" "}
          {totals.uncategorizedCount === 1 ? "entry is" : "entries are"} not on
          a budget line yet, totaling{" "}
          {formatCents(totals.uncategorizedCents)} — so that money is not in the
          category totals above.{" "}
          <Link href={`/${slug}/treasury?uncategorized=1`}>
            Put them on a line
          </Link>
          .
        </p>
      ) : (
        <p className="muted">Every entry is on a budget line.</p>
      )}

      {/* `className="secondary"` here was a dead class: `.secondary` is only
          defined for `button` and for `.button-link`, so the one control this
          whole section exists to hand over rendered as an 18px line of body
          text. It is a button-shaped link now, like the competition packet's. */}
      <p>
        <a
          href={`/api/pdf/board-snapshot?season=${seasonId}`}
          className="button-link secondary"
        >
          Download board snapshot (PDF)
        </a>
      </p>
    </>
  );
}

// THE FOUR NUMBERS (spec 006 §1), in the order the money runs. A board told
// "$40,000 planned, $8,000 spent" concludes $32,000 is free; when $12,000 of it
// is already promised to vendors that conclusion is wrong, and this is the block
// that says so out loud.
//
// The identical block is printed by the downloadable PDF (lib/pdf/documents
// StillAvailable) off the identical arithmetic (lib/treasury stillAvailable) and
// the identical aggregate definitions, because this page and that handout go to
// the same meeting.
//
// Expected money sits BELOW the total and outside the subtraction, deliberately:
// a grant award or a district allocation that has not arrived does not raise
// what may be spent (§2). Treating it as available is exactly the mistake the
// asymmetry exists to prevent.
function StillAvailableBlock({
  slug,
  plannedExpense,
  spentExpense,
  commitments,
}: {
  slug: string;
  plannedExpense: number | null;
  spentExpense: number | null;
  commitments: CommitmentTotals | null;
}) {
  const known =
    plannedExpense !== null && spentExpense !== null && commitments !== null;
  const flags: string[] = [];
  if (commitments) {
    if (commitments.staleCount > 0) {
      flags.push(`${commitments.staleCount} past its need-by date`);
    }
    if (commitments.overspentCount > 0) {
      flags.push(`${commitments.overspentCount} paid past its amount`);
    }
    if (commitments.afterTheFactCount > 0) {
      flags.push(`${commitments.afterTheFactCount} recorded after the purchase`);
    }
  }
  return (
    <>
      <h3>Still available</h3>
      {!known && (
        <p className="alert-error">
          {commitments === null
            ? "What the program has already committed could not be read just now, so the still-available figure is blank rather than wrong — and a blank here is the point: what a budget says is left is not what is free to spend."
            : "The budget's planned figures could not be read just now, so the still-available figure is blank rather than wrong."}{" "}
          Reload to try again.
        </p>
      )}
      <dl className="detail-list">
        <dt>Planned (expenses)</dt>
        <dd className="num">
          {plannedExpense === null ? "—" : formatCents(plannedExpense)}
        </dd>
        <dt>Committed — promised, not yet paid</dt>
        <dd className="num">
          {commitments === null
            ? "—"
            : formatCents(commitments.openCommittedCents)}
        </dd>
        <dt>Spent (money out this season)</dt>
        <dd className="num">
          {spentExpense === null ? "—" : formatCents(spentExpense)}
        </dd>
        <dt>Still available to spend</dt>
        <dd className="num">
          <strong>
            {known
              ? formatCents(
                  stillAvailable(
                    plannedExpense,
                    spentExpense,
                    commitments.openCommittedCents,
                  ),
                )
              : "—"}
          </strong>
        </dd>
      </dl>
      {commitments && (
        <p className={flags.length > 0 ? "alert-error" : "muted"}>
          {commitments.openCount === 1
            ? "1 open commitment"
            : `${commitments.openCount} open commitments`}
          {flags.length > 0 ? ` · ${flags.join(" · ")}` : ""}.{" "}
          <Link href={`/${slug}/treasury/commitments`}>See them</Link>.
        </p>
      )}
      {commitments && commitments.openExpectedCents > 0 && (
        <p className="muted">
          Expected in: {formatCents(commitments.openExpectedCents)} — promised to
          the program and not yet received, so it is not counted as available.
        </p>
      )}
    </>
  );
}
