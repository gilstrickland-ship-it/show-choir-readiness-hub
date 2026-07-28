import { formatDateTimeInTz, toZonedInputValue } from "@/lib/datetime";
import {
  updateShift,
  deleteShift,
  addStaffSignup,
  cancelSignup,
} from "./actions";

// One shift, and the two things staff do to it (spec 005 US9-3): add a name to
// it, or edit it. Both live on the card.
//
// The edit used to be a `?edit=<id>` MODE SWITCH — the whole card turned into a
// form, the title, the times, the open-slot count and the signup list all
// vanished while you corrected a typo, and a "Cancel" link was the only way
// back. That was this page's own invention; every other surface in the app uses
// a per-row `<details>` panel. This is that panel.
//
// It EXPANDS the card rather than floating over it (the Wave-4 lesson): the card
// already contains a `table.members` for signups, which is `display:block;
// overflow-x:auto` and therefore a scroll container that slices any absolutely-
// positioned descendant. Expanding also keeps the shift's own facts on screen
// while you edit them, which is the whole complaint about the mode switch.
//
// Deleting lives inside the panel, under the save, as the last thing in it — one
// "Edit" affordance per row instead of an Edit link and a Delete button sitting
// side by side where a mis-tap is unrecoverable.

export interface ShiftRow {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  needed_count: number;
  notes: string | null;
}

export interface SignupRow {
  id: string;
  shift_id: string;
  name: string | null;
  email: string | null;
  status: string;
  source: string;
}

// The row's panel opens on `?edit=<shiftId>` — the same param the ledger and the
// budget builder use — and a failed save or a refused delete comes back on it,
// so the message lands inside the panel that produced it.
export function shiftAnchor(shiftId: string): string {
  return `shift-${shiftId}`;
}

export function ShiftCard({
  programId,
  slug,
  tz,
  shift,
  attach,
  signups,
  confirmedCount,
  canWrite,
  open,
  error,
  signupError,
}: {
  programId: string;
  slug: string;
  tz: string;
  shift: ShiftRow;
  attach: string;
  signups: SignupRow[];
  confirmedCount: number;
  canWrite: boolean;
  open: boolean;
  // The Edit panel's own message.
  error: string | null;
  // The add-a-name form's own message. Separate because a failed signup must
  // NOT spring the Edit panel open — it renders on the box that failed.
  signupError: string | null;
}) {
  const openSlots = Math.max(0, shift.needed_count - confirmedCount);

  return (
    <div className="confirm-box" id={shiftAnchor(shift.id)} style={{ width: "100%" }}>
      <strong>{shift.title}</strong>
      <div className="muted">
        {attach}
        {shift.starts_at ? ` · ${formatDateTimeInTz(shift.starts_at, tz)}` : ""}
      </div>
      {shift.notes && <div className="muted">{shift.notes}</div>}
      <div style={{ marginTop: "0.3rem" }}>
        {openSlots > 0 ? (
          <span>
            {openSlots} of {shift.needed_count} spot
            {shift.needed_count === 1 ? "" : "s"} open
          </span>
        ) : (
          <span className="muted">Full ({shift.needed_count} filled)</span>
        )}
      </div>

      {signups.length > 0 && (
        <table className="members" style={{ marginTop: "0.5rem" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Source</th>
              <th>Status</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {signups.map((su) => (
              <tr key={su.id}>
                <td>{su.name ?? "—"}</td>
                <td className="muted">{su.email ?? "—"}</td>
                <td className="muted">
                  {su.source === "staff_entered" ? "staff" : "signup link"}
                </td>
                <td>
                  <span className="badge">{su.status}</span>
                </td>
                {canWrite && (
                  <td>
                    {su.status === "confirmed" && (
                      <form action={cancelSignup}>
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="signupId" value={su.id} />
                        <button type="submit" className="linklike danger">
                          Cancel
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          {signupError && <p className="alert-error">{signupError}</p>}
          <form action={addStaffSignup} className="row-inline">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="shiftId" value={shift.id} />
            <input
              type="text"
              name="name"
              placeholder="Add volunteer name"
              aria-label="Volunteer name"
              required
            />
            <input
              type="email"
              name="email"
              placeholder="Email (optional)"
              aria-label="Volunteer email"
            />
            <button type="submit" className="secondary">
              Add signup
            </button>
          </form>

          <details open={open}>
            <summary
              className="shift-disclosure"
              aria-label={`Edit ${shift.title}`}
            >
              Edit
            </summary>
            <div className="stack shift-edit-panel">
              <h3 className="drawer-title">Edit shift</h3>
              {error && <p className="alert-error">{error}</p>}
              <form action={updateShift} className="stack shift-edit-form">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="shiftId" value={shift.id} />
                <input type="hidden" name="tz" value={tz} />
                <div className="row-inline">
                  <label>
                    Title
                    <input
                      type="text"
                      name="title"
                      defaultValue={shift.title}
                      required
                    />
                  </label>
                  <label>
                    Needed
                    <input
                      type="number"
                      name="needed_count"
                      className="num"
                      min={1}
                      defaultValue={shift.needed_count}
                    />
                  </label>
                </div>
                <div className="row-inline">
                  <label>
                    Starts
                    <input
                      type="datetime-local"
                      name="starts_at"
                      defaultValue={toZonedInputValue(shift.starts_at, tz)}
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      type="datetime-local"
                      name="ends_at"
                      defaultValue={toZonedInputValue(shift.ends_at, tz)}
                    />
                  </label>
                </div>
                <label>
                  Notes
                  <input
                    type="text"
                    name="notes"
                    defaultValue={shift.notes ?? ""}
                  />
                </label>
                <button type="submit" className="secondary">
                  Save shift
                </button>
                <p className="muted">
                  What this shift is for is set when it&apos;s created. To move
                  it to a different competition, trip, or event, delete it and
                  add it there.
                </p>
              </form>
              <form action={deleteShift} className="shift-edit-form">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="shiftId" value={shift.id} />
                <button type="submit" className="linklike danger">
                  Delete this shift
                </button>
              </form>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
