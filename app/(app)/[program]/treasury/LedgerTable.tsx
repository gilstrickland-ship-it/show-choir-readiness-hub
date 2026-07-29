import { Fragment } from "react";
import Link from "next/link";
import {
  formatCents,
  formatDateOnly,
  type LedgerDirection,
  type LedgerPageRange,
} from "@/lib/treasury";
import { voidEntry, categorizeEntry } from "./actions";
import { entryAnchor } from "./flash";
import { LineSelect, Pager, optionName, type TagOptions } from "./shared";

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
// The panel opens from `?edit=<entryId>`, so a failed void or a failed filing
// comes back with its message inside the row that produced it (the Wave-2
// section-local error contract) instead of at the top of a long list.
//
// It opens in a row of its OWN, spanning every column, rather than inside the
// last cell (spec 005 T143b). Measured at 375px: in the last cell of this
// seven-column table the panel landed 502px into a 343px scroll port — zero
// pixels of it on screen, on the surface where a message about a refused void
// has to be read. The trigger moved with it: it is a link that sets `?edit=`,
// which is the same URL a refused write already comes back on, so opening a
// panel and returning to one after a failure are now one path, not two.

export interface EntryRow {
  id: string;
  entry_date: string;
  direction: LedgerDirection;
  amount_cents: number;
  budget_line_id: string | null;
  competition_id: string | null;
  trip_id: string | null;
  // The drawdown link (spec 006 R3). Frozen by the void-only trigger like every
  // other reference on an entry: moving a payment from one purchase order to
  // another after the fact is the alteration the whole feature exists to stop.
  commitment_id: string | null;
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
  showBalance,
  options,
  canWrite,
  openId,
  error,
  range,
  pageHref,
  rowHref,
}: {
  programId: string;
  slug: string;
  entries: EntryRow[];
  // The ONLY authority on a row's balance. An id it does not carry has no
  // balance to print — see below.
  balanceById: Map<string, number>;
  // False with no active season: a season balance "as of" an entry is not a
  // thing that exists, so the column does not appear rather than printing a
  // blank (or, as it did, a zero) on every row.
  showBalance: boolean;
  options: TagOptions;
  canWrite: boolean;
  openId: string | null;
  error: string | null;
  range: LedgerPageRange;
  pageHref: (page: number) => string;
  // This page's URL with one row's panel open (or none), keeping every filter
  // and the current page. Built by the page — the only thing that knows what
  // the filters are.
  rowHref: (entryId: string | null) => string;
}) {
  const columns = 5 + (showBalance ? 1 : 0) + (canWrite ? 1 : 0);
  return (
    <>
    <table className="members money-ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th className="num">Amount</th>
          <th>Line</th>
          <th>Paid to / from · memo</th>
          <th>Receipt</th>
          {showBalance && <th className="num">Balance</th>}
          {canWrite && <th className="table-action"></th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const voided = !!e.voided_at;
          // The commitment comes FIRST when there is one: "which purchase order
          // is this against?" is the question a bookkeeper asks of a payment,
          // and the competition or trip is the one she asks of a report.
          const tag =
            optionName(options.commits, e.commitment_id) ??
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
          const open = canWrite && !voided && openId === e.id;
          return (
            <Fragment key={e.id}>
            <tr className={rowClass}>
              <td>{formatDateOnly(e.entry_date)}</td>
              <td className="num">
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
              {showBalance && (
                <td className="num">
                  {/* `?? 0` here was a money bug wearing a default value: a
                      failed running-balance read printed $0.00 down the whole
                      column, beside a metric strip that was still right. A
                      balance we do not have reads as "—", the same as a voided
                      row's, because a zero is a claim and a dash is not. */}
                  {voided || !balanceById.has(e.id) ? (
                    <span className="muted">—</span>
                  ) : (
                    formatCents(balanceById.get(e.id) as number)
                  )}
                </td>
              )}
              {canWrite && (
                <td className="table-action">
                  {voided ? (
                    <span className="muted" title={e.void_reason ?? undefined}>
                      voided
                    </span>
                  ) : (
                    <Link
                      href={rowHref(open ? null : e.id)}
                      className="money-disclosure"
                      aria-expanded={open}
                      aria-controls={open ? entryAnchor(e.id) : undefined}
                      aria-label={`Fix the ${formatDateOnly(e.entry_date)} entry for ${formatCents(e.amount_cents)}`}
                    >
                      {open ? "Close" : "Fix this entry"}
                    </Link>
                  )}
                </td>
              )}
            </tr>
            {open && (
              <tr className="table-panel-row" id={entryAnchor(e.id)}>
                <td colSpan={columns}>
                  <div className="table-panel">
                    <EntryFix
                      programId={programId}
                      slug={slug}
                      entry={e}
                      options={options}
                      uncategorized={uncategorized}
                      error={error}
                    />
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
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
    <Pager
      range={range}
      pageHref={pageHref}
      noun={{ one: "entry", many: "entries" }}
    />
    </>
  );
}

// The row's own correction panel — rendered only when its row is the open one,
// in the full-width row beneath it. Uncategorized rows lead with the filing
// control, because that is the follow-up the Uncategorized nudge sent them here
// for — done in place, on the row they were already looking at.
function EntryFix({
  programId,
  slug,
  entry,
  options,
  uncategorized,
  error,
}: {
  programId: string;
  slug: string;
  entry: EntryRow;
  options: TagOptions;
  uncategorized: boolean;
  error: string | null;
}) {
  return (
      <div className="stack money-fix-panel">
        <h3 className="drawer-title">
          Fix the {formatDateOnly(entry.entry_date)} entry ·{" "}
          {formatCents(entry.amount_cents)}
        </h3>
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
  );
}
