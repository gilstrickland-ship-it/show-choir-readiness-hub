import Link from "next/link";
import { formatCents, totalForLine, type LineActual } from "@/lib/treasury";

// "What an event cost" (spec 005 Wave 12 / T162) — the per-event report that
// used to be called a per-event cost report and asked to be "run".
//
// The picker is the ledger's filter idiom (treasury/LedgerFilters): a plain GET
// form, so the URL IS the report and a treasurer can send it to a board member;
// the one control that answers the question stays visible; and "Clear" appears
// only once there is something to clear. There is nothing folded into a "More
// filters" disclosure here because there is nothing else to fold — one choice
// is the whole filter, and inventing more of them to justify a disclosure would
// be adding controls, not removing them.

export interface NamedRow {
  id: string;
  name: string;
}

export function EventReport({
  slug,
  comps,
  trips,
  selected,
  eventName,
  byLine,
  lineName,
  unavailable,
}: {
  slug: string;
  comps: NamedRow[];
  trips: NamedRow[];
  // The raw `?event=` value, echoed back into the select so the page a
  // treasurer shares reopens on the report she was reading.
  selected: string;
  // Non-null only when that id resolved to a competition or trip IN THIS
  // program and season. Null with `selected` set means someone typed a URL.
  eventName: string | null;
  byLine: Map<string, LineActual>;
  lineName: Map<string, string>;
  unavailable: boolean;
}) {
  // A rollup of the aggregate's OWN rows (one per budget line), not a sum over
  // a fetched entry list: ledger_line_actuals already did the summing in SQL
  // for this one event, and the breakdown below prints the same rows this total
  // is made of, so the two cannot disagree.
  let inCents = 0;
  let outCents = 0;
  for (const actual of byLine.values()) {
    inCents += actual.inCents;
    outCents += actual.outCents;
  }

  // A FRAGMENT, not a wrapper div: `.stack` is `align-items: flex-start` and
  // `table.members` is a scroll container, so a table nested one .stack deeper
  // shrink-wraps to the width of its widest sibling instead of the page's.
  // MEASURED at 1280px before this change: the breakdown table below rendered
  // 266px wide — the width of the four-row detail list above it.
  return (
    <>
      <h2>What an event cost</h2>
      <p className="muted">
        Pick a competition or trip to see what came in, what went out, and the
        difference — every entry tagged to it.
      </p>

      <form method="get" className="row-inline money-filters">
        <label>
          Competition or trip
          <select name="event" defaultValue={selected}>
            <option value="">Choose one…</option>
            {comps.length > 0 && (
              <optgroup label="Competitions">
                {comps.map((c) => (
                  <option key={c.id} value={`comp:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {trips.length > 0 && (
              <optgroup label="Trips">
                {trips.map((t) => (
                  <option key={t.id} value={`trip:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button type="submit" className="secondary">
          Show it
        </button>
        {selected && <Link href={`/${slug}/treasury/reports`}>Clear</Link>}
      </form>

      {/* A hand-typed or stale id resolved to nothing in this season. It used to
          render as an empty page under an untouched picker, which reads as "this
          event cost nothing". */}
      {selected && !eventName && (
        <p className="muted">
          That competition or trip isn&apos;t in this season.
        </p>
      )}

      {eventName && unavailable && (
        <p className="alert-error">
          What this event cost could not be read just now. Nothing is shown
          rather than zeros — reload to try again.
        </p>
      )}

      {eventName && !unavailable && (
        <>
          <dl className="detail-list">
            <dt>Event</dt>
            <dd>{eventName}</dd>
            <dt>Money in</dt>
            <dd className="num">{formatCents(inCents)}</dd>
            <dt>Money out</dt>
            <dd className="num">{formatCents(outCents)}</dd>
            <dt>Net (in − out)</dt>
            <dd className="num">
              <strong>{formatCents(inCents - outCents)}</strong>
            </dd>
          </dl>
          <table className="members money-ledger">
            <thead>
              <tr>
                <th>Budget line</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...byLine.entries()].map(([lineId, actual]) => (
                <tr key={lineId || "uncat"}>
                  <td>
                    {lineId ? (
                      (lineName.get(lineId) ?? "—")
                    ) : (
                      <span className="money-uncat">Not on a budget line</span>
                    )}
                  </td>
                  <td className="num">{formatCents(totalForLine(actual))}</td>
                </tr>
              ))}
              {byLine.size === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    Nothing is tagged to this event yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
