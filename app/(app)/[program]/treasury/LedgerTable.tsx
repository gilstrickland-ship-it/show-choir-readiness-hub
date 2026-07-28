import Link from "next/link";
import {
  formatCents,
  formatDateOnly,
  type LedgerDirection,
  type LedgerPageRange,
} from "@/lib/treasury";
import { voidEntry, categorizeEntry } from "./actions";
import { LineSelect, optionName, type TagOptions } from "./shared";

// The ledger itself, plus the one correction affordance (spec 005 US8-2). The
// vocabulary is the task, not the mechanism: a treasurer who typed the wrong
// amount is looking for "Fix this entry", and what she finds inside are the two
// things that can honestly happen to money that is already recorded — "Void it"
// (it never should have been there) and "Void & redo" (it belongs, with
// different numbers). Nothing here edits an entry: the 0002 trigger makes every
// money column immutable after insert and forbids un-voiding, which is the
// point (Constitution V) and is why filing an uncategorized row is also a void
// plus a fresh row, said plainly on the form.
//
// The popover opens from `?edit=<entryId>`, so a failed void or a failed filing
// comes back with its message inside the row that produced it (the Wave-2
// section-local error contract) instead of at the top of a long list.

export interface EntryRow {
  id: string;
  entry_date: string;
  direction: LedgerDirection;
  amount_cents: number;
  budget_line_id: string | null;
  competition_id: string | null;
  trip_id: string | null;
  memo: string | null;
  counterparty: string | null;
  receipt_path: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export function LedgerTable({
  programId,
  slug,
  entries,
  balanceById,
  options,
  canWrite,
  openId,
  error,
  range,
  pageHref,
}: {
  programId: string;
  slug: string;
  entries: EntryRow[];
  balanceById: Map<string, number>;
  options: TagOptions;
  canWrite: boolean;
  openId: string | null;
  error: string | null;
  range: LedgerPageRange;
  pageHref: (page: number) => string;
}) {
  const columns = canWrite ? 7 : 6;
  return (
    <>
    <table className="members money-ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th className="right">Amount</th>
          <th>Line</th>
          <th>Paid to / from · memo</th>
          <th>Receipt</th>
          <th className="right">Balance</th>
          {canWrite && <th></th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const voided = !!e.voided_at;
          const tag =
            optionName(options.comps, e.competition_id) ??
            optionName(options.trips, e.trip_id) ??
            "";
          const uncategorized = !e.budget_line_id;
          const party = [e.counterparty, e.memo].filter(Boolean).join(" · ");
          const rowClass = voided
            ? "ledger-voided"
            : uncategorized
              ? "ledger-uncat"
              : undefined;
          return (
            <tr key={e.id} className={rowClass}>
              <td>{formatDateOnly(e.entry_date)}</td>
              <td className="right">
                <span
                  className={
                    voided
                      ? "money-amt"
                      : `money-amt ${e.direction === "in" ? "in" : "out"}`
                  }
                >
                  {e.direction === "in" ? "+ " : "− "}
                  {formatCents(e.amount_cents)}
                </span>
              </td>
              <td>
                {uncategorized ? (
                  <span className="money-uncat">uncategorized</span>
                ) : (
                  <>
                    {optionName(options.lines, e.budget_line_id) ?? "—"}
                    {tag && <span className="muted"> · {tag}</span>}
                  </>
                )}
              </td>
              <td>{party || <span className="muted">—</span>}</td>
              <td>
                {e.receipt_path ? (
                  // The receipt was write-only until now: it uploaded, and
                  // nothing in the app could ever open it again. The link is
                  // program-scoped and re-checks the money read roles, then
                  // hands back a short-lived signed URL.
                  <Link
                    href={`/${slug}/treasury/receipt/${e.id}`}
                    prefetch={false}
                    aria-label={`Open the receipt for the ${formatDateOnly(e.entry_date)} entry`}
                  >
                    📎 Receipt
                  </Link>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="right">
                {voided ? (
                  <span className="muted">—</span>
                ) : (
                  formatCents(balanceById.get(e.id) ?? 0)
                )}
              </td>
              {canWrite && (
                <td>
                  {voided ? (
                    <span className="muted" title={e.void_reason ?? undefined}>
                      voided
                    </span>
                  ) : (
                    <EntryFix
                      programId={programId}
                      slug={slug}
                      entry={e}
                      options={options}
                      uncategorized={uncategorized}
                      open={openId === e.id}
                      error={openId === e.id ? error : null}
                    />
                  )}
                </td>
              )}
            </tr>
          );
        })}
        {entries.length === 0 && (
          <tr>
            <td colSpan={columns} className="muted">
              No entries match.
            </td>
          </tr>
        )}
      </tbody>
    </table>
    <LedgerPager range={range} pageHref={pageHref} />
    </>
  );
}

// How much of the ledger this page is actually showing, said out loud. The list
// used to stop at PostgREST's 1000-row cap with no indication, so a treasurer
// scrolling to the bottom of a long season had no way to know entries were
// missing. Prev/Next are plain links — the page re-renders on the server, so
// paging works with no client JavaScript.
function LedgerPager({
  range,
  pageHref,
}: {
  range: LedgerPageRange;
  pageHref: (page: number) => string;
}) {
  if (range.total === 0) return null;
  return (
    <div className="row-inline">
      <span className="muted">
        Showing {range.firstShown}–{range.lastShown} of {range.total}{" "}
        {range.total === 1 ? "entry" : "entries"}
        {range.pages > 1 ? ` · page ${range.page} of ${range.pages}` : ""}
      </span>
      {range.hasPrev && (
        <Link href={pageHref(range.page - 1)} rel="prev">
          ← Newer
        </Link>
      )}
      {range.hasNext && (
        <Link href={pageHref(range.page + 1)} rel="next">
          Older →
        </Link>
      )}
    </div>
  );
}

// The row's own correction popover. Uncategorized rows lead with the filing
// control, because that is the follow-up the Uncategorized nudge sent them here
// for — done in place, on the row they were already looking at.
function EntryFix({
  programId,
  slug,
  entry,
  options,
  uncategorized,
  open,
  error,
}: {
  programId: string;
  slug: string;
  entry: EntryRow;
  options: TagOptions;
  uncategorized: boolean;
  open: boolean;
  error: string | null;
}) {
  return (
    <details id={`fix-${entry.id}`} open={open}>
      <summary
        className="money-disclosure"
        aria-label={`Fix the ${formatDateOnly(entry.entry_date)} entry for ${formatCents(entry.amount_cents)}`}
      >
        Fix this entry
      </summary>
      <div className="stack money-fix-panel">
        <h3 className="drawer-title">Fix this entry</h3>
        {error && <p className="alert-error">{error}</p>}

        {uncategorized && options.cats.length > 0 && (
          <form action={categorizeEntry} className="stack money-fix-form">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="entryId" value={entry.id} />
            <label>
              Put it on a budget line
              <LineSelect
                name="budget_line_id"
                defaultValue=""
                options={options}
                blankLabel="Pick a line"
              />
            </label>
            <button type="submit" className="secondary">
              Save the line
            </button>
            <p className="muted">
              Filing it voids this row and writes the same amounts back on the
              line. The ledger never edits money in place.
            </p>
          </form>
        )}

        <form action={voidEntry} className="stack money-fix-form">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="entryId" value={entry.id} />
          <label>
            Why?
            <input
              type="text"
              name="reason"
              placeholder="Wrong amount"
              required
              aria-label="Void reason"
            />
          </label>
          <div className="row-inline">
            <button type="submit" className="linklike danger">
              Void it
            </button>
            <button type="submit" name="reenter" value="1" className="linklike">
              Void &amp; redo
            </button>
          </div>
          <p className="muted">
            Either way the row stays visible and stops counting toward the
            balance. Redo reopens Add an entry with these numbers filled in.
          </p>
        </form>
      </div>
    </details>
  );
}
