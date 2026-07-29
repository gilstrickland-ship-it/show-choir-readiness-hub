import Link from "next/link";
import {
  actualForDirection,
  formatCents,
  lineVariance,
  stillAvailable,
  type CategoryDirection,
  type CommitmentTotals,
  type LedgerSeasonTotals,
  type LineActual,
  type LineCommitment,
} from "@/lib/treasury";

// The two tables Budget vs Actual is made of (spec 005 Wave 12 / T162): the
// season summary and one section per direction. They live here so the page
// stays a load-and-compose file like the ledger's (RQ-6b), and so the ONE rule
// this surface exists to honour is stated in one place instead of at fourteen
// call sites: a figure we could not read renders "—", never "$0.00".
//
// THE COLUMN NAMES ARE THE DIRECTION. "Variance" is a word from a finance
// textbook, and it means two different things in the two halves of this page —
// on an expense line a positive variance is money you have not spent yet, on an
// income line it is money you took in beyond the plan. A treasurer should not
// have to hold that conversion in her head while reading numbers aloud, so the
// header says which one it is: "Still available" over money out, "Ahead or
// behind" over money in. Same arithmetic (lib/treasury lineVariance), same
// sign convention — positive is good news in both columns — said in words.

export interface CatRow {
  id: string;
  name: string;
  direction: CategoryDirection;
  sort_order: number;
}

export interface LineRow {
  id: string;
  category_id: string;
  name: string;
  planned_cents: number;
  sort_order: number;
}

// A figure we do not have is a BLANK, never a zero. "$0.00 spent" is a claim
// about a season that a treasurer reads to a board; "—" is the absence of one.
//
// That includes PLANNED. The rule used to be stated as "planned amounts are
// budget rows, always known" — and they are, right up until the read of those
// rows fails, at which point the whole-season summary printed "$0.00 Planned"
// beside real actuals and computed a full-budget Difference from it. A planned
// total is known only when the budget's categories and lines were actually read.
function figure(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

// The middle column is where spec 006 lands on this page. On the money-out side
// it is "Committed" — promised to a vendor, not yet paid — and it is SUBTRACTED
// from Still available, because a line with $3,200 planned, $800 spent and
// $2,400 already committed has $0 free, not $2,400.
//
// On the money-in side the same column is "Expected" and is NOT added to
// anything. Money someone has promised the program is not spending authority
// until it arrives (spec §2, decision D4); adding it would be the mirror of the
// mistake this page exists to correct. Its column stands beside "Ahead or
// behind" rather than inside it.
const WORDS: Record<
  CategoryDirection,
  {
    heading: string;
    actual: string;
    promised: string;
    variance: string;
    empty: string;
  }
> = {
  income: {
    heading: "Money in",
    actual: "Taken in so far",
    promised: "Expected",
    variance: "Ahead or behind",
    empty: "No money-in categories yet.",
  },
  expense: {
    heading: "Money out",
    actual: "Spent so far",
    promised: "Committed",
    variance: "Still available",
    empty: "No money-out categories yet.",
  },
};

// A line's promised figure, read the way its category means it — the same rule
// actualForDirection applies to the ledger: an expense line carries commitments,
// an income line carries expected money, and neither ever reads the other's.
function promisedForDirection(
  promised: LineCommitment | undefined,
  direction: CategoryDirection,
): number {
  if (!promised) return 0;
  return direction === "income"
    ? promised.openExpectedCents
    : promised.openCommittedCents;
}

// THE FOUR NUMBERS (spec 006 §1), in the order the money runs. This is the whole
// feature stated in one strip: a budget says what was planned and a ledger says
// what moved, and between them sits what has been promised — which is why "still
// available" was a lie the moment a director signed a vendor.
//
// Only money OUT has a still-available: only spending authority can be committed
// against. Expected money gets its own cell, marked as not-yet-available, for
// exactly the reason it is not in the subtraction.
//
// Every figure is null-safe on its own and a total is withheld unless all three
// of its operands are real. "$0.00 committed" is a number a director would act
// on; a dash is not.
export function StillAvailableStrip({
  slug,
  plannedOut,
  spentOut,
  commitments,
}: {
  slug: string;
  plannedOut: number | null;
  spentOut: number | null;
  commitments: CommitmentTotals | null;
}) {
  const available =
    plannedOut !== null && spentOut !== null && commitments !== null
      ? stillAvailable(plannedOut, spentOut, commitments.openCommittedCents)
      : null;
  const committed = commitments?.openCommittedCents ?? null;
  const expected = commitments?.openExpectedCents ?? null;
  return (
    <>
      <div className="metric-strip">
        <div className="metric-cell">
          <div className="metric-label">Planned</div>
          <div className="metric-value">{figure(plannedOut)}</div>
          <div className="metric-sub">money out, this season&apos;s budget</div>
        </div>
        <div className={`metric-cell${committed ? " warn" : ""}`}>
          <div className="metric-label">Committed</div>
          <div className="metric-value">{figure(committed)}</div>
          <div className="metric-sub">
            {commitments === null ? (
              "could not be read"
            ) : (
              <>
                promised, not yet paid ·{" "}
                <Link
                  href={`/${slug}/treasury/commitments`}
                  className="metric-link"
                >
                  see them
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Spent</div>
          <div className="metric-value alert">{figure(spentOut)}</div>
          <div className="metric-sub">money that has actually left</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Still available</div>
          <div className="metric-value">{figure(available)}</div>
          <div className="metric-sub">planned − spent − committed</div>
        </div>
      </div>
      {expected !== null && expected > 0 && (
        <p className="muted">
          Expected in: {formatCents(expected)} — money someone has promised the
          program. It is not counted as available: you may not spend money you
          have merely been promised.
        </p>
      )}
    </>
  );
}

// Whole-season figures. Planned comes off the budget lines and every actual is
// `ledger_season_totals`, the 0019 SQL aggregate — and EITHER side can be
// missing, independently, which is why this takes the totals row and two
// nullable planned figures rather than numbers a caller has already defaulted
// to zero. A Difference is printed only when both of its operands are real.
export function SeasonSummary({
  plannedIn,
  plannedOut,
  totals,
}: {
  plannedIn: number | null;
  plannedOut: number | null;
  totals: LedgerSeasonTotals | null;
}) {
  const plannedNet =
    plannedIn === null || plannedOut === null ? null : plannedIn - plannedOut;
  return (
    <table className="members money-ledger">
      <thead>
        <tr>
          <th>Whole season</th>
          <th className="num">Planned</th>
          <th className="num">Actual so far</th>
          <th className="num">Difference</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Money in</td>
          <td className="num">{figure(plannedIn)}</td>
          <td className="num">{figure(totals?.inCents ?? null)}</td>
          <td className="num">
            {figure(
              totals && plannedIn !== null
                ? lineVariance(plannedIn, totals.inCents, "income")
                : null,
            )}
          </td>
        </tr>
        <tr>
          <td>Money out</td>
          <td className="num">{figure(plannedOut)}</td>
          <td className="num">{figure(totals?.outCents ?? null)}</td>
          <td className="num">
            {figure(
              totals && plannedOut !== null
                ? lineVariance(plannedOut, totals.outCents, "expense")
                : null,
            )}
          </td>
        </tr>
        <tr>
          <td>
            <strong>Net (in − out)</strong>
          </td>
          <td className="num">
            <strong>{figure(plannedNet)}</strong>
          </td>
          <td className="num">
            <strong>{figure(totals?.netCents ?? null)}</strong>
          </td>
          {/* This cell used to be a hard-coded "—", which on a page where "—"
              means "we could not read it" said the wrong thing about a number
              that is perfectly computable: how the season's net is running
              against the net the budget planned for. Positive is good news
              here too — more in, or less out, than planned. */}
          <td className="num">
            <strong>
              {figure(
                totals && plannedNet !== null
                  ? totals.netCents - plannedNet
                  : null,
              )}
            </strong>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// One direction's categories and lines. `unavailable` is the per-line aggregate
// (`ledger_line_actuals`) having failed — it fails INDEPENDENTLY of the season
// totals, and when it does every actual and every difference in this table is a
// blank, not a zero. `commitmentsUnavailable` is the same story for
// `commitment_line_totals`, and it takes the variance column with it: "still
// available" computed without the committed figure is the old wrong number, so
// it is withheld rather than quietly reverted to it.
export function LineSection({
  direction,
  cats,
  linesByCat,
  actualByLine,
  committedByLine,
  unavailable,
  commitmentsUnavailable,
}: {
  direction: CategoryDirection;
  cats: CatRow[];
  linesByCat: Map<string, LineRow[]>;
  actualByLine: Map<string, LineActual>;
  committedByLine: Map<string, LineCommitment>;
  unavailable: boolean;
  commitmentsUnavailable: boolean;
}) {
  const words = WORDS[direction];
  const secCats = cats.filter((c) => c.direction === direction);
  const known = (cents: number): number | null => (unavailable ? null : cents);
  const promisedKnown = (cents: number): number | null =>
    commitmentsUnavailable ? null : cents;
  // An expense line's variance now depends on BOTH reads; an income line's does
  // not, because expected money is never part of it.
  const varianceKnown = (cents: number): number | null =>
    unavailable || (direction === "expense" && commitmentsUnavailable)
      ? null
      : cents;

  // A FRAGMENT, not a wrapper div, and this is load-bearing rather than tidy.
  // `.stack` is `align-items: flex-start`, and `table.members` is a scroll
  // container (`display:block; overflow-x:auto`) whose max-content contribution
  // is therefore ~nothing — so a table nested one .stack deeper shrink-wrapped
  // to the width of the widest OTHER child of that stack. MEASURED before this
  // change, at 1280px: these two tables rendered 81px and 94px wide, the width
  // of their own <h2>, with four money columns scrolling inside them. The page
  // section has a definite width; its direct children do not have to guess.
  return (
    <>
      <h2>{words.heading}</h2>
      <table className="members money-ledger">
        <thead>
          <tr>
            <th>Budget line</th>
            <th className="num">Planned</th>
            <th className="num">{words.actual}</th>
            <th className="num">{words.promised}</th>
            <th className="num">{words.variance}</th>
          </tr>
        </thead>
        {secCats.map((c) => {
          const catLines = linesByCat.get(c.id) ?? [];
          let catPlanned = 0;
          let catActual = 0;
          let catPromised = 0;
          const rows = catLines.map((l) => {
            const actual = actualForDirection(actualByLine.get(l.id), direction);
            const promised = promisedForDirection(
              committedByLine.get(l.id),
              direction,
            );
            catPlanned += l.planned_cents;
            catActual += actual;
            catPromised += promised;
            return {
              line: l,
              actual,
              promised,
              // The one line of arithmetic this whole feature exists for. An
              // expense line's "still available" now has the promised money
              // taken out of it; an income line's "ahead or behind" is
              // untouched, because expected money is not income until it lands.
              variance:
                direction === "expense"
                  ? stillAvailable(l.planned_cents, actual, promised)
                  : lineVariance(l.planned_cents, actual, direction),
            };
          });
          return (
            <tbody key={c.id}>
              <tr>
                <td colSpan={5}>
                  <strong>{c.name}</strong>
                </td>
              </tr>
              {rows.map(({ line, actual, promised, variance }) => (
                <tr key={line.id}>
                  <td style={{ paddingLeft: "1.5rem" }}>{line.name}</td>
                  <td className="num">{formatCents(line.planned_cents)}</td>
                  <td className="num">{figure(known(actual))}</td>
                  <td className="num">{figure(promisedKnown(promised))}</td>
                  <td className="num">{figure(varianceKnown(variance))}</td>
                </tr>
              ))}
              {catLines.length === 0 ? (
                // A category with no lines used to print a row of $0.00s and
                // then a subtotal of the same zeros — three figures saying
                // nothing, on a page read for its figures.
                <tr>
                  <td colSpan={5} className="muted" style={{ paddingLeft: "1.5rem" }}>
                    No lines in this category yet.
                  </td>
                </tr>
              ) : (
                <tr>
                  <td style={{ paddingLeft: "1.5rem" }} className="muted">
                    {c.name} subtotal
                  </td>
                  <td className="num">{formatCents(catPlanned)}</td>
                  <td className="num">{figure(known(catActual))}</td>
                  <td className="num">{figure(promisedKnown(catPromised))}</td>
                  <td className="num">
                    {figure(
                      varianceKnown(
                        direction === "expense"
                          ? stillAvailable(catPlanned, catActual, catPromised)
                          : lineVariance(catPlanned, catActual, direction),
                      ),
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
        {secCats.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={5} className="muted">
                {words.empty}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </>
  );
}
