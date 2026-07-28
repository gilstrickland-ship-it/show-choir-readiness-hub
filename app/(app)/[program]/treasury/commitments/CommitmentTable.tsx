import { Fragment } from "react";
import Link from "next/link";
import {
  COMMITMENT_KIND_HEADINGS,
  COMMITMENT_STATUS_LABELS,
  FUNDING_SOURCE_LABELS,
  commitmentAllows,
  commitmentIsOpen,
  commitmentRefLabel,
  commitmentOverspend,
  commitmentRules,
  commitmentTotalCents,
  drawdownSentence,
  formatCents,
  formatDateOnly,
  type CommitmentDrawdown,
  type CommitmentFundingSource,
  type CommitmentKind,
  type CommitmentRules,
  type CommitmentStatus,
  type CommitmentThresholds,
  type LedgerPageRange,
} from "@/lib/treasury";
import { formatDateTimeInTz } from "@/lib/datetime";
import { Pager } from "../shared";
import { moveCommitment, noteCommitment, reviseCommitment } from "./actions";
import { commitmentAnchor } from "./flash";

// The commitments list and, in a row of its own beneath, the one commitment a
// treasurer is working on (spec 006 T174/T175).
//
// THE PANEL OPENS IN ITS OWN FULL-WIDTH ROW, not inside the last cell, and the
// trigger that opens it is pinned to the right edge (T143b, measured on the
// ledger: in the last cell of a seven-column table at 375px the panel landed 502
// pixels into a 343-pixel scroll port — zero pixels of it on screen). It is a
// LINK that sets `?edit=`, which is the same URL a refused write comes back on,
// so opening a panel and returning to one after a failure are one path.
//
// A <details> would not do: it cannot span two table rows, so the panel would be
// back inside a cell.

export interface CommitmentListRow {
  id: string;
  kind: CommitmentKind;
  funding_source: CommitmentFundingSource;
  number: number;
  revision: number;
  revision_of_id: string | null;
  vendor: string;
  purpose: string;
  amount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  budget_line_id: string;
  need_by: string | null;
  status: CommitmentStatus;
  after_the_fact: boolean;
  external_ref: string | null;
  quote_path: string | null;
  board_minutes_ref: string | null;
  note: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  issued_at: string | null;
  received_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  released_cents: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  superseded_at: string | null;
}

// One ledger entry that has been booked against the open commitment.
export interface LinkedEntry {
  id: string;
  entry_date: string;
  direction: string;
  amount_cents: number;
  counterparty: string | null;
  memo: string | null;
}

interface SectionCommon {
  programId: string;
  slug: string;
  timeZone: string;
  // Today on the PROGRAM's calendar. A need-by is a calendar day, so the whole
  // comparison is a string compare — and a UTC host must not decide that a
  // Chicago program's purchase order is late.
  today: string;
  lineName: Map<string, string>;
  // What is left on each row, from SQL (0022). An id this map does NOT carry has
  // no remaining balance to print: it renders "—", never $0.00.
  drawdown: Map<string, CommitmentDrawdown>;
  nameByUser: Map<string, string>;
  // This program's three spending rules (0023). They decide which commitments
  // need two approvals, which need the board minutes before being issued, and
  // which get the three-quotes nudge.
  thresholds: CommitmentThresholds;
  // Who has already approved each commitment, from commitment_audit. THIS IS THE
  // APPROVAL CHAIN: a first approval changes no column on the row, so the audit
  // trail is where it is recorded.
  approvals: Map<string, string[]>;
  // The reader, so the page never offers them a button the database will refuse
  // (their own request, or their own second signature). Null on a support view.
  viewerId: string | null;
  // The treasurer seat: issue, receive, close, cancel, annotate — and the
  // approval that completes a commitment.
  canWrite: boolean;
  // Director, admin or treasurer: raise a request, and restate one.
  canCreate: boolean;
  // Director, admin, treasurer or board member: may record the FIRST of two
  // approvals above the second-approver amount, and nothing else.
  canApprove: boolean;
  openId: string | null;
  error: string | null;
  confirmClose: boolean;
  linked: LinkedEntry[] | null;
  linkedCount: number | null;
  rowHref: (id: string | null) => string;
  closeHref: (id: string) => string;
}

export function CommitmentSection({
  kind,
  rows,
  range,
  pageHref,
  summary,
  addHref,
  ...common
}: SectionCommon & {
  kind: CommitmentKind;
  rows: CommitmentListRow[];
  range: LedgerPageRange;
  pageHref: (page: number) => string;
  // The live head — what this section adds up to right now, so the heading is a
  // fact rather than a label.
  summary: string;
  // Opens the one drawer already set to THIS subtype, so recording a grant award
  // never starts on a form that calls the payer a vendor. Null for a seat that
  // cannot raise one.
  addHref: string | null;
}) {
  // The detail panel opens for EVERY money seat, not only the writers. A board
  // member reading the snapshot is exactly the person who needs to see what a
  // commitment promised and what has been paid against it; what her seat does
  // not get is the forms inside.
  const columns = 6;
  const held = kind === "spending" ? "Still committed" : "Still expected";
  return (
    <>
      <div className="travel-section-head">
        <h2>{COMMITMENT_KIND_HEADINGS[kind]}</h2>
        <span className="travel-section-summary">{summary}</span>
        {addHref && (
          <Link href={addHref} className="money-disclosure">
            {kind === "spending" ? "Commit money" : "Record money promised"}
          </Link>
        )}
      </div>
      <table className="members money-ledger">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Who · what for</th>
            <th>Budget line</th>
            <th className="right">Amount</th>
            <th className="right">{held}</th>
            <th className="table-action"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CommitmentRow
              key={row.id}
              row={row}
              columns={columns}
              {...common}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns} className="muted">
                {kind === "spending"
                  ? "Nothing committed yet. Anything the program has promised a vendor belongs here — it comes out of the budget line before the cheque is written."
                  : "Nothing promised to the program yet. A district allocation, a grant award, a sponsorship pledge, or an invoice to another district that owes you entry fees all belong here."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager
        range={range}
        pageHref={pageHref}
        noun={{ one: "commitment", many: "commitments" }}
      />
    </>
  );
}

function CommitmentRow({
  row,
  columns,
  ...c
}: SectionCommon & { row: CommitmentListRow; columns: number }) {
  const draw = c.drawdown.get(row.id);
  const open = commitmentIsOpen(row);
  const stale = open && row.need_by !== null && row.need_by < c.today;
  const over = draw ? commitmentOverspend(draw.totalCents, draw.drawnCents) : 0;
  const panelOpen = c.openId === row.id;
  const ref = commitmentRefLabel(row.funding_source, row.number, row.revision);
  const rowClass = !open ? "ledger-voided" : stale || over > 0 ? "ledger-uncat" : undefined;
  return (
    <Fragment>
      <tr className={rowClass}>
        <td>
          {ref}
          <br />
          <span className="muted">{COMMITMENT_STATUS_LABELS[row.status]}</span>
        </td>
        <td>
          {row.vendor}
          <br />
          <span className="muted">{row.purpose}</span>
        </td>
        <td>{c.lineName.get(row.budget_line_id) ?? "—"}</td>
        <td className="right">
          {/* The committed total is amount + shipping + tax, and it is stated
              ONCE (lib/treasury commitmentTotalCents) so the row and the SQL
              cannot come to mean different things by it. `draw` is the SQL's
              own answer when we have it; the fallback is the same definition
              over the row already in hand. */}
          {formatCents(draw ? draw.totalCents : commitmentTotalCents(row))}
        </td>
        <td className="right">
          {/* A remaining balance we could not read is a dash. `?? 0` here would
              print "$0.00 still committed" against a live purchase order, which
              is a sentence a treasurer would act on. */}
          {!draw ? (
            <span className="muted">—</span>
          ) : open ? (
            formatCents(draw.remainingCents)
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="table-action">
          <Link
            href={c.rowHref(panelOpen ? null : row.id)}
            className="money-disclosure"
            aria-expanded={panelOpen}
            aria-controls={panelOpen ? commitmentAnchor(row.id) : undefined}
            aria-label={`Open ${ref} — ${row.vendor}`}
          >
            {panelOpen ? "Close" : "Open"}
          </Link>
        </td>
      </tr>
      {panelOpen && (
        <tr className="table-panel-row" id={commitmentAnchor(row.id)}>
          <td colSpan={columns}>
            <div className="table-panel">
              <CommitmentDetail row={row} draw={draw} {...c} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// One commitment, whole: what it promised, what has been paid against it, what
// is left, who asked and who approved, and every move it can still make.
function CommitmentDetail({
  row,
  draw,
  ...c
}: SectionCommon & { row: CommitmentListRow; draw: CommitmentDrawdown | undefined }) {
  const ref = commitmentRefLabel(row.funding_source, row.number, row.revision);
  const open = commitmentIsOpen(row);
  const stale = open && row.need_by !== null && row.need_by < c.today;
  const over = draw ? commitmentOverspend(draw.totalCents, draw.drawnCents) : 0;
  const lineLabel = c.lineName.get(row.budget_line_id) ?? "this budget line";
  const rules = commitmentRules(commitmentTotalCents(row), c.thresholds);
  const when = (ts: string | null): string =>
    ts ? formatDateTimeInTz(new Date(ts), c.timeZone) : "—";
  const who = (id: string | null): string =>
    id ? (c.nameByUser.get(id) ?? "someone on the staff") : "—";

  // `.panel stack`, NOT the ledger's `.money-fix-panel`. That one is capped at
  // 17rem because it holds two short forms; MEASURED at 1280 this panel inside
  // it came out 272px wide with a nine-row definition list, a payments list and
  // four disclosures stacked down it. A commitment's detail is a section, not a
  // control — `.panel` is the class the app already uses for exactly that, and
  // the inputs inside stay their natural size because `.stack` sizes its flex
  // children to their content.
  return (
    <div className="panel stack">
      <h3 className="drawer-title">
        {ref} · {row.vendor}
      </h3>
      {c.error && <p className="alert-error">{c.error}</p>}

      {/* THE DRAWDOWN, IN ONE SENTENCE (R3). */}
      <p>
        {draw ? (
          <strong>{drawdownSentence(row.kind, draw.totalCents, draw.drawnCents)}</strong>
        ) : (
          <span className="muted">
            What is left on this could not be read just now — blank rather than
            wrong. Reload to try again.
          </span>
        )}
      </p>

      {over > 0 && (
        // R5: overspend WARNS, never blocks. Reality overruns commitments, and a
        // block would simply mean the payment is recorded somewhere else.
        <p className="alert-error">
          {formatCents(over)} more has been {row.kind === "spending" ? "paid" : "received"}{" "}
          than this committed. That is allowed and recorded — nothing was
          blocked. If the extra is real, record a revision so the document
          matches the money.
        </p>
      )}
      {stale && (
        <p className="alert-error">
          Past its {row.kind === "spending" ? "need-by" : "expected-by"} date (
          {formatDateOnly(row.need_by)}) and still open. An open commitment from
          a date that has passed is money held out of the budget for something
          that may never happen.
        </p>
      )}
      {/* D6's THIRD number, and the only one that never blocks anything. It is a
          nudge, so it is worded as one, it appears while it can still be acted
          on (before the money moves), and it goes away the moment the treasurer
          records where the quotes are filed — a nudge that cannot be satisfied
          is just noise. */}
      {rules.nudgeThreeQuotes && open && !row.quote_path && (
        <p className="muted">
          Over {formatCents(c.thresholds.threeQuotesCents)} — get three quotes if
          you can, and record where they are filed under &ldquo;Reference numbers
          and notes&rdquo; below. This is a reminder, not a rule: nothing here is
          blocked either way.
        </p>
      )}
      {row.after_the_fact && (
        <p className="muted">Recorded after the purchase.</p>
      )}
      {row.revision_of_id && (
        <p className="muted">
          This replaces an earlier version of {ref.split(" · ")[0]}. The original
          is still in the list under &ldquo;replaced by a revision&rdquo;,
          exactly as it was written.
        </p>
      )}

      <dl className="detail-list">
        <dt>What for</dt>
        <dd>{row.purpose}</dd>
        <dt>Budget line</dt>
        <dd>{lineLabel}</dd>
        <dt>Account</dt>
        <dd>
          {FUNDING_SOURCE_LABELS[row.funding_source]} ·{" "}
          {row.funding_source === "district" ? "district" : "booster"} account
        </dd>
        <dt>Amount</dt>
        <dd className="num">
          {formatCents(row.amount_cents)}
          {row.shipping_cents > 0 || row.tax_cents > 0
            ? ` + ${formatCents(row.shipping_cents)} shipping + ${formatCents(row.tax_cents)} tax`
            : ""}
        </dd>
        <dt>{row.kind === "spending" ? "Needed by" : "Expected by"}</dt>
        <dd>{formatDateOnly(row.need_by)}</dd>
        <dt>Requested</dt>
        <dd>
          {who(row.requested_by)} · {when(row.requested_at)}
        </dd>
        <dt>Approved</dt>
        <dd>
          {row.approved_at
            ? `${who(row.approved_by)} · ${when(row.approved_at)}`
            : "not yet"}
        </dd>
        {row.issued_at && (
          <>
            <dt>Issued</dt>
            <dd>{when(row.issued_at)}</dd>
          </>
        )}
        {row.received_at && (
          <>
            <dt>Received</dt>
            <dd>{when(row.received_at)}</dd>
          </>
        )}
        {row.closed_at && (
          <>
            <dt>Closed</dt>
            <dd>
              {when(row.closed_at)}
              {row.close_reason ? ` · ${row.close_reason}` : ""}
              {/* R4: the released amount is RECORDED, and said out loud
                  afterwards as well as before. A null is not zero — it means the
                  amount could not be read at the moment of closing, and saying
                  "$0.00 released" would be a permanent claim about where the
                  money went. */}
              {row.released_cents === null
                ? " · the amount released was not recorded"
                : ` · ${formatCents(row.released_cents)} released back to ${lineLabel}`}
            </dd>
          </>
        )}
        {row.cancelled_at && (
          <>
            <dt>Cancelled</dt>
            <dd>
              {when(row.cancelled_at)}
              {row.cancel_reason ? ` · ${row.cancel_reason}` : ""}
            </dd>
          </>
        )}
        {row.external_ref && (
          <>
            <dt>
              {row.funding_source === "district"
                ? "District PO number"
                : "Reference"}
            </dt>
            <dd>{row.external_ref}</dd>
          </>
        )}
        {row.quote_path && (
          <>
            <dt>Quotes</dt>
            <dd>{row.quote_path}</dd>
          </>
        )}
        {row.board_minutes_ref && (
          <>
            <dt>Board minutes</dt>
            <dd>{row.board_minutes_ref}</dd>
          </>
        )}
        {row.note && (
          <>
            <dt>Note</dt>
            <dd>{row.note}</dd>
          </>
        )}
      </dl>

      <LinkedEntries
        slug={c.slug}
        row={row}
        entries={c.linked}
        count={c.linkedCount}
        canWrite={c.canWrite}
      />

      {/* Approval is its own block, above the rest of the lifecycle, because
          since 0023 it is the one move whose seat is not simply "treasurer" —
          above the second-approver amount the FIRST approval comes from a
          director, an admin or a board member, and the treasurer's finishes it. */}
      {commitmentAllows(row, "approve") && (
        <Approval
          programId={c.programId}
          slug={c.slug}
          row={row}
          rules={rules}
          thresholds={c.thresholds}
          approvals={c.approvals.get(row.id) ?? []}
          nameByUser={c.nameByUser}
          viewerId={c.viewerId}
          canWrite={c.canWrite}
          canApprove={c.canApprove}
        />
      )}

      {c.canWrite && open && (
        <Lifecycle
          programId={c.programId}
          slug={c.slug}
          row={row}
          draw={draw}
          rules={rules}
          thresholds={c.thresholds}
          lineLabel={lineLabel}
          confirmClose={c.confirmClose}
          closeHref={c.closeHref}
        />
      )}

      {c.canCreate && commitmentAllows(row, "revise") && (
        <Revise programId={c.programId} slug={c.slug} row={row} />
      )}

      {c.canWrite && (
        <References programId={c.programId} slug={c.slug} row={row} />
      )}
    </div>
  );
}

// What has actually been booked against this document, and the one link that
// makes most entries never touch the drawdown select at all (R3): the ledger
// drawer opens pre-filled with this commitment, its budget line, its vendor, its
// purpose and what is still owed on it.
function LinkedEntries({
  slug,
  row,
  entries,
  count,
  canWrite,
}: {
  slug: string;
  row: CommitmentListRow;
  entries: LinkedEntry[] | null;
  count: number | null;
  canWrite: boolean;
}) {
  const verb = row.kind === "spending" ? "payment" : "receipt";
  return (
    <div className="stack">
      <div className="travel-section-head">
        <h4>
          {verb === "payment" ? "Payments" : "Receipts"} against this
        </h4>
        <span className="travel-section-summary">
          {entries === null
            ? "could not be read"
            : count === null
              ? `${entries.length} shown`
              : count === 1
                ? `1 ${verb}`
                : `${count} ${verb}s`}
        </span>
      </div>
      {entries === null ? (
        <p className="muted">
          The entries booked against this could not be read just now. The
          drawdown figure above comes from the database and is unaffected.
        </p>
      ) : entries.length === 0 ? (
        <p className="muted">
          Nothing has been recorded against this yet.
        </p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              {formatDateOnly(e.entry_date)} · {e.direction === "in" ? "+" : "−"}
              {formatCents(e.amount_cents)}
              {e.counterparty ? ` · ${e.counterparty}` : ""}
              {e.memo ? ` · ${e.memo}` : ""}
            </li>
          ))}
        </ul>
      )}
      {count !== null && entries !== null && count > entries.length && (
        <p className="muted">
          Showing the {entries.length} most recent of {count}.
        </p>
      )}
      {canWrite && (
        <p>
          <Link
            href={`/${slug}/treasury?commit=${encodeURIComponent(row.id)}#add-entry`}
            className="button-link secondary"
          >
            Record a {verb} against this
          </Link>
        </p>
      )}
    </div>
  );
}

// THE SIGNATURES (spec 006 D6 / 0023). One approval, or two above the program's
// second-approver amount — and every version of the sentence says who is still
// owed, because a treasurer looking for a button that is not there needs to know
// why rather than conclude the page is broken.
//
// What is offered is never wider than what the database will accept: the
// requester is offered nothing, a person who has already approved is offered
// nothing, and the treasurer's approval is deliberately not offered as the FIRST
// of two — an audit row cannot be taken back, so spending her signature on the
// first slot would strand the document (0023 §3 refuses it outright).
function Approval({
  programId,
  slug,
  row,
  rules,
  thresholds,
  approvals,
  nameByUser,
  viewerId,
  canWrite,
  canApprove,
}: {
  programId: string;
  slug: string;
  row: CommitmentListRow;
  rules: CommitmentRules;
  thresholds: CommitmentThresholds;
  approvals: string[];
  nameByUser: Map<string, string>;
  viewerId: string | null;
  canWrite: boolean;
  canApprove: boolean;
}) {
  // The requester's own name never counts as a signature — 0021's CHECK says so
  // for the completing approval and 0023 says so for the first.
  const signed = approvals.filter((id) => id !== row.requested_by);
  const iSigned = !!viewerId && signed.includes(viewerId);
  const isRequester = !!viewerId && viewerId === row.requested_by;
  const needsTwo = rules.needsSecondApproval;
  const firstOfTwo = needsTwo && signed.length === 0;

  // Who may press, right now, for this document.
  const mayPress =
    !isRequester &&
    !iSigned &&
    (firstOfTwo ? canApprove && !canWrite : canWrite);

  const names = signed.map((id) => nameByUser.get(id) ?? "someone on the staff");

  return (
    <div className="stack money-fix-form">
      <h4>Approval</h4>
      {needsTwo ? (
        <p className="muted">
          Over {formatCents(thresholds.secondApproverCents)}, so this one needs
          two approvals.{" "}
          {signed.length === 0
            ? "A director, an admin or a board member approves it first; the treasurer's approval is the one that finishes it."
            : `Approved so far by ${names.join(", ")}. The treasurer's approval finishes it.`}
        </p>
      ) : (
        <p className="muted">
          One approval, from the treasurer — and never from whoever raised the
          request. The database refuses that, not just this page.
        </p>
      )}
      {isRequester && (
        <p className="muted">
          You raised this request, so you cannot approve it.
        </p>
      )}
      {iSigned && !isRequester && (
        <p className="muted">
          Your approval is recorded. One person cannot be both of its two
          approvals.
        </p>
      )}
      {mayPress && (
        <form action={moveCommitment}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="commitmentId" value={row.id} />
          <button type="submit" name="act" value="approve">
            {firstOfTwo ? "Add my approval" : "Approve it"}
          </button>
        </form>
      )}
    </div>
  );
}

// Issue → receive → close, plus cancel. Only the moves this document can
// actually make are rendered, and `commitmentAllows` is the same function the
// server action asks — a control that is merely hidden is a control that still
// works when posted. (Approving lives in its own block above.)
function Lifecycle({
  programId,
  slug,
  row,
  draw,
  rules,
  thresholds,
  lineLabel,
  confirmClose,
  closeHref,
}: {
  programId: string;
  slug: string;
  row: CommitmentListRow;
  draw: CommitmentDrawdown | undefined;
  rules: CommitmentRules;
  thresholds: CommitmentThresholds;
  lineLabel: string;
  confirmClose: boolean;
  closeHref: (id: string) => string;
}) {
  // D6's second blocking rule: above the board amount the minutes have to be on
  // the document before it can be issued. Stated where the Issue button is, and
  // enforced by the server action and by 0023's trigger underneath it.
  const boardMissing =
    rules.needsBoardMinutes && !(row.board_minutes_ref ?? "").trim();
  const hidden = (
    <>
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="commitmentId" value={row.id} />
    </>
  );
  return (
    <div className="stack money-fix-form">
      <h4>What happens next</h4>
      <div className="row-inline">
        {commitmentAllows(row, "issue") && !boardMissing && (
          <form action={moveCommitment}>
            {hidden}
            <button type="submit" name="act" value="issue" className="secondary">
              Mark as issued
            </button>
          </form>
        )}
        {commitmentAllows(row, "receive_partial") && (
          <form action={moveCommitment}>
            {hidden}
            <button
              type="submit"
              name="act"
              value="receive_partial"
              className="secondary"
            >
              Some of it arrived
            </button>
          </form>
        )}
        {commitmentAllows(row, "receive_full") && (
          <form action={moveCommitment}>
            {hidden}
            <button
              type="submit"
              name="act"
              value="receive_full"
              className="secondary"
            >
              All of it arrived
            </button>
          </form>
        )}
      </div>

      {/* The board rule, said where the missing button was rather than after
          pressing it. The server action refuses this too (and 0023's trigger
          under that), so this is the explanation, not the control. */}
      {commitmentAllows(row, "issue") && boardMissing && (
        <p className="alert-error">
          Over {formatCents(thresholds.boardApprovalCents)}, so this cannot be
          issued until the board minutes are written on it. Add them under
          &ldquo;Reference numbers and notes&rdquo; below and the button comes
          back.
        </p>
      )}

      {/* R4: closing RELEASES THE REMAINDER, and says so before it happens with
          the actual amount and the actual line. Never automatic: silently
          re-inflating an available balance hides under-delivery. */}
      {confirmClose ? (
        <form action={moveCommitment} className="stack confirm-box">
          {hidden}
          <p>
            <strong>
              {draw
                ? `Closing this releases ${formatCents(draw.remainingCents)} back to ${lineLabel}.`
                : `Closing this releases whatever is left back to ${lineLabel}.`}
            </strong>{" "}
            The commitment stays in the list with what it released written on it.
          </p>
          <label>
            Why?
            <input
              type="text"
              name="reason"
              placeholder="Delivered in full · vendor cancelled"
              required
              aria-label="Reason for closing"
            />
          </label>
          <div className="row-inline">
            <button type="submit" name="act" value="close">
              Close it and release the rest
            </button>
            <Link href={closeHref(row.id)}>Never mind</Link>
          </div>
        </form>
      ) : (
        <div className="row-inline">
          <Link href={closeHref(row.id)} className="money-disclosure">
            Close it
          </Link>
        </div>
      )}

      <details className="stack">
        <summary className="money-disclosure">Cancel it instead</summary>
        <form action={moveCommitment} className="stack money-fix-form">
          {hidden}
          <p className="muted">
            Cancel when the promise was never real — the order was never placed,
            the grant was never awarded. It stops committing money immediately
            and stays in the list. Use Close when something did happen and the
            rest should go back.
          </p>
          <label>
            Why?
            <input
              type="text"
              name="reason"
              placeholder="Ordered from someone else"
              required
              aria-label="Reason for cancelling"
            />
          </label>
          <button type="submit" name="act" value="cancel" className="linklike danger">
            Cancel this commitment
          </button>
        </form>
      </details>
    </div>
  );
}

// R2: "Change amount" writes a REVISION and supersedes the original. The button
// says what a treasurer means; the file says what actually happens.
function Revise({
  programId,
  slug,
  row,
}: {
  programId: string;
  slug: string;
  row: CommitmentListRow;
}) {
  return (
    <details className="stack">
      <summary className="money-disclosure">Change the amount</summary>
      <form action={reviseCommitment} className="stack money-fix-form">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="commitmentId" value={row.id} />
        <p className="muted">
          This does not edit {commitmentRefLabel(row.funding_source, row.number, row.revision)}.
          It writes a new version of it and marks this one as replaced, keeping
          the same number — because a purchase order that can be altered after
          the fact is not evidence of anything. Both stay in the list.
        </p>
        <div className="row-inline">
          <label>
            New amount $
            <input
              type="text"
              name="amount"
              inputMode="decimal"
              defaultValue={(row.amount_cents / 100).toFixed(2)}
              aria-label="Revised amount"
            />
          </label>
          <label>
            Shipping $
            <input
              type="text"
              name="shipping"
              inputMode="decimal"
              defaultValue={(row.shipping_cents / 100).toFixed(2)}
              aria-label="Revised shipping"
            />
          </label>
          <label>
            Tax $
            <input
              type="text"
              name="tax"
              inputMode="decimal"
              defaultValue={(row.tax_cents / 100).toFixed(2)}
              aria-label="Revised tax"
            />
          </label>
          <label>
            {row.kind === "spending" ? "Needed by" : "Expected by"}
            <input
              type="date"
              name="need_by"
              defaultValue={row.need_by ?? ""}
              aria-label="Revised date"
            />
          </label>
        </div>
        <label>
          Why it changed
          <input
            type="text"
            name="note"
            placeholder="Vendor re-quoted after the fabric change"
          />
        </label>
        <button type="submit" className="secondary">
          Record the change
        </button>
      </form>
    </details>
  );
}

// The attachments to the document — the district's own number, the board
// minutes, a note. Editable on purpose: 0021 freezes what was PROMISED, not the
// paperwork that references it, and every change is recorded in commitment_audit.
function References({
  programId,
  slug,
  row,
}: {
  programId: string;
  slug: string;
  row: CommitmentListRow;
}) {
  return (
    <details className="stack">
      <summary className="money-disclosure">Reference numbers and notes</summary>
      <form action={noteCommitment} className="stack money-fix-form">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="commitmentId" value={row.id} />
        <label>
          {row.funding_source === "district"
            ? "The district's own PO number"
            : "Reference number"}
          <input
            type="text"
            name="external_ref"
            defaultValue={row.external_ref ?? ""}
            placeholder="e.g. 24-01187"
          />
        </label>
        {/* The three-quotes nudge's anchor (D6). A place, not an upload: this
            app stores no vendor documents, and "Shared drive → Quotes → 2027
            risers" is what a treasurer can actually hand an auditor. */}
        <label>
          Where the quotes are filed
          <input
            type="text"
            name="quote_path"
            defaultValue={row.quote_path ?? ""}
            placeholder="e.g. Shared drive → Quotes → 2027 risers"
          />
        </label>
        <label>
          Board minutes
          <input
            type="text"
            name="board_minutes_ref"
            defaultValue={row.board_minutes_ref ?? ""}
            placeholder="e.g. Minutes of 12 Mar 2026, item 7"
          />
        </label>
        <label>
          Note
          <input type="text" name="note" defaultValue={row.note ?? ""} />
        </label>
        <button type="submit" className="secondary">
          Save these
        </button>
        <p className="muted">
          These describe the paperwork, not the promise. The amount, the vendor,
          the purpose and the budget line are fixed — changing those means
          recording a revision.
        </p>
      </form>
    </details>
  );
}
