import Link from "next/link";
import {
  GUARDIAN_EMAIL_STATUS_LABELS,
  guardianAnchor,
  type GuardianEmailStatus,
} from "@/lib/roster/students";
import {
  updateGuardian,
  removeGuardian,
  resetGuardianEmailStatus,
  sendFamilyLinks,
  resetFamilyLinks,
} from "../actions";

// One guardian, and the two things a director does to one (spec 005 US10-1):
// send this family their links, or edit them.
//
// The row used to carry FIVE verbs — four always-open inputs and a Save,
// "Email links to this family", "Reset this family's links", "Mark deliverable
// again" and "Remove" — stacked in the last cell of a table with no hierarchy
// between the everyday one and the two that cannot be undone. This is that row
// with two affordances: the send, and an Edit panel holding everything else.
//
// It is a CARD, not a table row, and that is the Wave-4 lesson taken one step
// further. `table.members` is `display:block; overflow-x:auto`, so an Edit panel
// in the last cell of a five-column table opens several hundred pixels into a
// scroller: on a 375px phone the guardian panel measured ZERO pixels on screen
// where it opened. Expanding the row instead of floating over it fixes the
// clipping but not the offset. A family is one to three people, never a list you
// scan — so it is a stack of cards (the Wave-5 shift idiom), each the width of
// the page, and the panel opens at the left edge where it can be read.

export interface GuardianListRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  email_status: GuardianEmailStatus;
}

export function GuardianCard({
  programId,
  slug,
  studentId,
  guardian,
  canWrite,
  open,
  confirm,
  error,
}: {
  programId: string;
  slug: string;
  studentId: string;
  guardian: GuardianListRow;
  canWrite: boolean;
  // The panel reopens on `?edit=<guardianId>`, and a refused save comes back on
  // it so the message lands inside the panel that produced it. `?confirm=` is
  // the second press of a two-press destructive action, scoped to this card.
  open: boolean;
  confirm: "reset" | "remove" | null;
  error: string | null;
}) {
  const anchor = guardianAnchor(guardian.id);
  const detail = `/${slug}/roster/${studentId}`;
  const panelHref = `${detail}?edit=${guardian.id}#${anchor}`;
  const deliverable = guardian.email_status === "ok";
  const contact = [guardian.email, guardian.phone].filter(Boolean).join(" · ");

  return (
    <div className="confirm-box guardian-card" id={anchor}>
      <div className="guardian-card-head">
        <strong>{guardian.name}</strong>
        {guardian.relationship && (
          <span className="muted">{guardian.relationship}</span>
        )}
        <span className={`family-link ${deliverable ? "delivering" : "bouncing"}`}>
          <span
            className={`status-dot ${deliverable ? "ok" : "alert"}`}
            aria-hidden="true"
          />
          {GUARDIAN_EMAIL_STATUS_LABELS[guardian.email_status]}
        </span>
      </div>
      <div className="muted">{contact || "No email or phone on file"}</div>

      {canWrite && (
        <div className="stack guardian-card-actions">
          <form action={sendFamilyLinks}>
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="guardianId" value={guardian.id} />
            <button type="submit" className="secondary" disabled={!guardian.email}>
              Send family links
            </button>
          </form>
          {!guardian.email && (
            <p className="muted">Add an email in Edit before you can send.</p>
          )}

          <details open={open}>
            <summary
              className="people-disclosure"
              aria-label={`Edit ${guardian.name}`}
            >
              Edit
            </summary>
            <div className="stack people-edit-panel">
              <h4 className="drawer-title">Edit guardian</h4>
              {error && <p className="alert-error">{error}</p>}

              <form action={updateGuardian} className="stack people-edit-form">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="guardianId" value={guardian.id} />
                <label>
                  Name
                  <input
                    type="text"
                    name="name"
                    defaultValue={guardian.name}
                    required
                  />
                </label>
                <div className="row-inline">
                  <label>
                    Email
                    <input
                      type="email"
                      name="email"
                      defaultValue={guardian.email ?? ""}
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      type="tel"
                      name="phone"
                      defaultValue={guardian.phone ?? ""}
                    />
                  </label>
                </div>
                <label>
                  Relationship
                  <input
                    type="text"
                    name="relationship"
                    defaultValue={guardian.relationship ?? ""}
                    placeholder="Mother, Father, …"
                  />
                </label>
                <button type="submit" className="secondary">
                  Save guardian
                </button>
                <p className="muted">
                  Correcting a bad address here is what ends a bounce — the next
                  send goes to the new one.
                </p>
              </form>

              {!deliverable && (
                <form action={resetGuardianEmailStatus} className="people-edit-form">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="guardianId" value={guardian.id} />
                  <button type="submit" className="secondary">
                    Mark deliverable again
                  </button>
                  <p className="muted">
                    Turns this address back on for announcements and the weekly
                    digest. Use it once a bounced address is fixed, or if the
                    family asked to start receiving email again.
                  </p>
                </form>
              )}

              <div className="people-edit-form stack">
                {confirm === "reset" ? (
                  <div className="confirm-box stack">
                    <p>
                      Reset this family&apos;s links? Every link already emailed
                      to them stops working, and a fresh set appears once on this
                      page for you to send on.
                    </p>
                    <div className="row-inline">
                      <form action={resetFamilyLinks}>
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="studentId" value={studentId} />
                        <input type="hidden" name="guardianId" value={guardian.id} />
                        <button type="submit" className="danger">
                          Reset the links
                        </button>
                      </form>
                      <Link href={panelHref}>Keep them</Link>
                    </div>
                  </div>
                ) : (
                  <>
                    <Link
                      href={`${detail}?edit=${guardian.id}&confirm=reset#${anchor}`}
                      className="linklike"
                    >
                      Reset this family&apos;s links…
                    </Link>
                    <p className="muted">
                      Only if a link left the family — a forwarded email, a link
                      in the wrong hands. Sending links again does not need this.
                    </p>
                  </>
                )}
              </div>

              <div className="people-edit-form stack">
                {confirm === "remove" ? (
                  <div className="confirm-box stack">
                    <p>
                      Remove {guardian.name}? They stop receiving program email
                      and their family links stop working.
                    </p>
                    <div className="row-inline">
                      <form action={removeGuardian}>
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="studentId" value={studentId} />
                        <input type="hidden" name="guardianId" value={guardian.id} />
                        <button type="submit" className="danger">
                          Remove {guardian.name}
                        </button>
                      </form>
                      <Link href={panelHref}>Keep them</Link>
                    </div>
                  </div>
                ) : (
                  <Link
                    href={`${detail}?edit=${guardian.id}&confirm=remove#${anchor}`}
                    className="linklike danger"
                  >
                    Remove this guardian…
                  </Link>
                )}
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
