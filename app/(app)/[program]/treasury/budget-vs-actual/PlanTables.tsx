import {
  actualForDirection,
  formatCents,
  lineVariance,
  type CategoryDirection,
  type LedgerSeasonTotals,
  type LineActual,
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

const WORDS: Record<
  CategoryDirection,
  { heading: string; actual: string; variance: string; empty: string }
> = {
  income: {
    heading: "Money in",
    actual: "Taken in so far",
    variance: "Ahead or behind",
    empty: "No money-in categories yet.",
  },
  expense: {
    heading: "Money out",
    actual: "Spent so far",
    variance: "Still available",
    empty: "No money-out categories yet.",
  },
};

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
          <th className="right">Planned</th>
          <th className="right">Actual so far</th>
          <th className="right">Difference</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Money in</td>
          <td className="right">{figure(plannedIn)}</td>
          <td className="right">{figure(totals?.inCents ?? null)}</td>
          <td className="right">
            {figure(
              totals && plannedIn !== null
                ? lineVariance(plannedIn, totals.inCents, "income")
                : null,
            )}
          </td>
        </tr>
        <tr>
          <td>Money out</td>
          <td className="right">{figure(plannedOut)}</td>
          <td className="right">{figure(totals?.outCents ?? null)}</td>
          <td className="right">
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
          <td className="right">
            <strong>{figure(plannedNet)}</strong>
          </td>
          <td className="right">
            <strong>{figure(totals?.netCents ?? null)}</strong>
          </td>
          {/* This cell used to be a hard-coded "—", which on a page where "—"
              means "we could not read it" said the wrong thing about a number
              that is perfectly computable: how the season's net is running
              against the net the budget planned for. Positive is good news
              here too — more in, or less out, than planned. */}
          <td className="right">
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
// blank, not a zero.
export function LineSection({
  direction,
  cats,
  linesByCat,
  actualByLine,
  unavailable,
}: {
  direction: CategoryDirection;
  cats: CatRow[];
  linesByCat: Map<string, LineRow[]>;
  actualByLine: Map<string, LineActual>;
  unavailable: boolean;
}) {
  const words = WORDS[direction];
  const secCats = cats.filter((c) => c.direction === direction);
  const known = (cents: number): number | null => (unavailable ? null : cents);

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
            <th className="right">Planned</th>
            <th className="right">{words.actual}</th>
            <th className="right">{words.variance}</th>
          </tr>
        </thead>
        {secCats.map((c) => {
          const catLines = linesByCat.get(c.id) ?? [];
          let catPlanned = 0;
          let catActual = 0;
          const rows = catLines.map((l) => {
            const actual = actualForDirection(actualByLine.get(l.id), direction);
            catPlanned += l.planned_cents;
            catActual += actual;
            return {
              line: l,
              actual,
              variance: lineVariance(l.planned_cents, actual, direction),
            };
          });
          return (
            <tbody key={c.id}>
              <tr>
                <td colSpan={4}>
                  <strong>{c.name}</strong>
                </td>
              </tr>
              {rows.map(({ line, actual, variance }) => (
                <tr key={line.id}>
                  <td style={{ paddingLeft: "1.5rem" }}>{line.name}</td>
                  <td className="right">{formatCents(line.planned_cents)}</td>
                  <td className="right">{figure(known(actual))}</td>
                  <td className="right">{figure(known(variance))}</td>
                </tr>
              ))}
              {catLines.length === 0 ? (
                // A category with no lines used to print a row of $0.00s and
                // then a subtotal of the same zeros — three figures saying
                // nothing, on a page read for its figures.
                <tr>
                  <td colSpan={4} className="muted" style={{ paddingLeft: "1.5rem" }}>
                    No lines in this category yet.
                  </td>
                </tr>
              ) : (
                <tr>
                  <td style={{ paddingLeft: "1.5rem" }} className="muted">
                    {c.name} subtotal
                  </td>
                  <td className="right">{formatCents(catPlanned)}</td>
                  <td className="right">{figure(known(catActual))}</td>
                  <td className="right">
                    {figure(
                      known(lineVariance(catPlanned, catActual, direction)),
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
              <td colSpan={4} className="muted">
                {words.empty}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </>
  );
}
