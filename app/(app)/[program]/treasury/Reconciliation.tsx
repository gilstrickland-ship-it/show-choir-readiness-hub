import Link from "next/link";
import { formatDateOnly, formatMonthKey } from "@/lib/treasury";
import { zonedDateKey } from "@/lib/datetime";
import { markReconciled, unmarkReconciled } from "./actions";

// The monthly bank-statement check (Wave L), lifted out of the ledger page so
// that page reads as load-then-compose. Unchanged in behavior: a month with
// live entries can be marked reconciled, un-marking asks first via
// `?confirm=unmark_<month>`, and a reconciliation is a status record — the only
// reversible row on this surface, because it asserts a check was done rather
// than moving money.

export function Reconciliation({
  programId,
  slug,
  months,
  reconciledBy,
  canWrite,
  confirmMonth,
  timeZone,
}: {
  programId: string;
  slug: string;
  months: string[];
  reconciledBy: Map<string, { date: string; note: string | null }>;
  canWrite: boolean;
  confirmMonth: string | null;
  // "Reconciled on" is an INSTANT (created_at), so it has to be bucketed to the
  // program's calendar day before it is printed. Rendering the raw ISO prefix
  // showed the UTC day, which dates an evening reconciliation to tomorrow.
  timeZone: string;
}) {
  return (
    <div className="confirm-box stack" style={{ width: "100%" }}>
      <h2 style={{ margin: 0 }}>Reconciliation</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Each month, compare the ledger to the bank statement, then mark it
        reconciled here. The board can see how current the books are — that
        protects you.
      </p>
      <table className="members">
        <thead>
          <tr>
            <th>Month</th>
            <th>Status</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {months.map((mKey) => {
            const rec = reconciledBy.get(mKey);
            return (
              <tr key={mKey}>
                <td>{formatMonthKey(mKey)}</td>
                <td>
                  {rec ? (
                    <span>
                      <strong>Reconciled ✓</strong>{" "}
                      {formatDateOnly(zonedDateKey(rec.date, timeZone))}
                      {rec.note ? (
                        <span className="muted"> · {rec.note}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="muted">Not reconciled</span>
                  )}
                </td>
                {canWrite && (
                  <td>
                    {rec ? (
                      confirmMonth === mKey ? (
                        <span className="row-inline">
                          <form action={unmarkReconciled}>
                            <input
                              type="hidden"
                              name="programId"
                              value={programId}
                            />
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="month" value={mKey} />
                            <button type="submit" className="linklike danger">
                              Confirm un-mark
                            </button>
                          </form>
                          <Link href={`/${slug}/treasury`}>Cancel</Link>
                        </span>
                      ) : (
                        <Link
                          href={`/${slug}/treasury?confirm=unmark_${mKey}`}
                          className="linklike danger"
                        >
                          Un-mark
                        </Link>
                      )
                    ) : (
                      <form action={markReconciled} className="row-inline">
                        <input
                          type="hidden"
                          name="programId"
                          value={programId}
                        />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="month" value={mKey} />
                        <input
                          type="text"
                          name="note"
                          placeholder="Note (optional)"
                          aria-label={`Reconciliation note for ${formatMonthKey(mKey)}`}
                        />
                        <button type="submit" className="secondary">
                          Mark reconciled
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
