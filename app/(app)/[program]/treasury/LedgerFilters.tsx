import Link from "next/link";
import { LEDGER_DIRECTIONS, LEDGER_DIRECTION_LABELS } from "@/lib/treasury";
import { LineSelect, type TagOptions } from "./shared";

// The ledger filter row (spec 005 US8-3). Two controls answer the question a
// treasurer actually arrives with — "where is that payment to the bus company?"
// — so search and in/out stay visible; the five that answer a report's question
// (a date window, a line, a competition, a trip, voided rows) fold into one
// "More filters". The summary counts what is on, and the disclosure starts OPEN
// whenever any of them is, because a filtered list that doesn't say why is how
// a treasurer concludes money is missing.
//
// A plain GET form: the URL is the filter state, so it is shareable, and the
// default (no query at all) renders exactly the list it always did.

export function LedgerFilters({
  slug,
  options,
  q,
  direction,
  from,
  to,
  line,
  competition,
  trip,
  includeVoided,
  uncategorizedOnly,
}: {
  slug: string;
  options: TagOptions;
  q: string;
  direction: string;
  from: string;
  to: string;
  line: string;
  competition: string;
  trip: string;
  includeVoided: boolean;
  uncategorizedOnly: boolean;
}) {
  const moreOn = [from, to, line, competition, trip].filter(Boolean).length +
    (includeVoided ? 1 : 0);

  return (
    <form method="get" className="row-inline money-filters">
      <label>
        Search
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Payee or memo"
        />
      </label>
      <label>
        In or out
        <select name="direction" defaultValue={direction}>
          <option value="all">All</option>
          {LEDGER_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {LEDGER_DIRECTION_LABELS[d]}
            </option>
          ))}
        </select>
      </label>

      <details className="stack money-more" open={moreOn > 0}>
        <summary className="money-disclosure">
          More filters — {moreOn > 0 ? `${moreOn} on` : "none on"}
        </summary>
        <div className="row-inline money-more-panel">
          <label>
            From
            <input type="date" name="from" defaultValue={from} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={to} />
          </label>
          <label>
            Budget line
            <LineSelect
              name="line"
              defaultValue={line}
              options={options}
              blankLabel="All lines"
            />
          </label>
          <label>
            Competition
            <select name="competition" defaultValue={competition}>
              <option value="">All</option>
              {options.comps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trip
            <select name="trip" defaultValue={trip}>
              <option value="">All</option>
              {options.trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              name="voided"
              value="1"
              defaultChecked={includeVoided}
            />
            Show voided entries
          </label>
        </div>
      </details>

      {/* The Uncategorized nudge filters through this same form, so its state
          has to survive pressing Filter. */}
      {uncategorizedOnly && (
        <input type="hidden" name="uncategorized" value="1" />
      )}
      <button type="submit" className="secondary">
        Filter
      </button>
      <Link href={`/${slug}/treasury`}>Clear</Link>
    </form>
  );
}
