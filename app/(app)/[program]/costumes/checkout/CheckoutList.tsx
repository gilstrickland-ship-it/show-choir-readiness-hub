import { NO_HEALTH_LABEL } from "@/lib/costumes";
import { toggleCheckout } from "./actions";

// The comp-day hand-out list: one tap per row, big enough for a phone held in a
// school hallway with a garment bag over the other arm. Students marked absent
// for the competition render greyed and carry no button — they are skipped, not
// checked out (§4).
//
// This is the surface the rest of Wardrobe was rebuilt to match, so it kept its
// shape; what it lost was a block of inline styles that only globals.css could
// keep consistent with everything around it.

export type CheckoutState = "pending" | "out" | "in";

export const STATE_LABEL: Record<CheckoutState, string> = {
  pending: "Not out",
  out: "Checked out",
  in: "Checked in",
};

export interface CheckoutRow {
  id: string;
  state: CheckoutState;
  studentId: string | null;
  /** student name (assignment) or piece label (direct). */
  primary: string;
  /** piece label + kind + set. */
  secondary: string;
  sortKey: string;
  isDirect: boolean;
}

export function CheckoutList({
  programId,
  slug,
  competitionId,
  rows,
  absent,
  canWrite,
}: {
  programId: string;
  slug: string;
  competitionId: string;
  rows: CheckoutRow[];
  absent: Set<string>;
  canWrite: boolean;
}) {
  return (
    <>
      <ul className="checkout-list">
        {rows.map((r) => {
          const isAbsent = r.studentId != null && absent.has(r.studentId);
          return (
            <li
              key={r.id}
              className={isAbsent ? "checkout-row is-absent" : "checkout-row"}
            >
              <div>
                <div className="checkout-who">{r.primary}</div>
                <div className="muted">{r.secondary}</div>
              </div>
              {isAbsent ? (
                <span className="badge">absent — skipped</span>
              ) : canWrite ? (
                <form action={toggleCheckout}>
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="competitionId" value={competitionId} />
                  <input type="hidden" name="checkoutId" value={r.id} />
                  <button
                    type="submit"
                    className={
                      r.state === "out"
                        ? "secondary checkout-toggle"
                        : "checkout-toggle"
                    }
                    aria-label={`${r.state === "out" ? "Check in" : "Check out"}: ${r.primary} — ${r.secondary} (now: ${STATE_LABEL[r.state]})`}
                  >
                    {r.state === "out" ? "Check in" : "Check out"}
                    <br />
                    <span className="checkout-toggle-state">
                      now: {STATE_LABEL[r.state]}
                    </span>
                  </button>
                </form>
              ) : (
                <span className="badge">{STATE_LABEL[r.state]}</span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="muted">{NO_HEALTH_LABEL}</p>
    </>
  );
}
