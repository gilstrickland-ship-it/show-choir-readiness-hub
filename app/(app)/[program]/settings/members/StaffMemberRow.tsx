import { Fragment } from "react";
import Link from "next/link";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { reRoleMember, removeMember } from "../actions";
import { staffMemberAnchor } from "../shared";

// One person with a seat in this program, and the two things a director does to
// one: change what they can do, or take the seat away (spec 005 Wave 13 / T164).
//
// The role select used to sit permanently open in the row with its own Save
// beside it, and Remove was a separate cell — so a table of five people was ten
// controls, and on a phone the Remove link started several hundred pixels into a
// horizontal scroll. The row states the facts now; both controls live behind one
// Edit disclosure that opens a row of its OWN spanning every column, stuck to the
// left edge of the scroll port (T143b) with the trigger pinned right.
//
// Removing cuts access immediately, so it stays behind the confirm it has always
// had — now inside the panel, last, where the rest of the destructive controls in
// this app live.

export interface StaffMember {
  id: string;
  role: Role;
  status: "invited" | "active" | "removed";
  invited_email: string | null;
  user_id: string | null;
}

// Friendly labels for the member status column (stored value unchanged).
const STATUS_LABEL: Record<string, string> = {
  invited: "Invited — hasn't signed in yet",
  active: "Active",
  removed: "Removed",
};

const ROLE_OPTIONS: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
  "costume_manager",
  "board_member",
];

export function StaffMemberRow({
  programId,
  slug,
  member,
  name,
  canGrantDirector,
  open,
  confirmRemove,
  error,
  columns,
  rowHref,
}: {
  programId: string;
  slug: string;
  member: StaffMember;
  // What to call them: their profile name if they have signed in, else the
  // address the invite went to.
  name: string;
  // Only a director hands out the director seat (settings/actions mayGrant).
  // The action refuses either way — this just stops offering a choice that
  // would be refused.
  canGrantDirector: boolean;
  // The panel opens on `?edit=<memberId>`, and every refusal from this row comes
  // back on it so the message lands inside the control that produced it.
  open: boolean;
  confirmRemove: boolean;
  error: string | null;
  columns: number;
  // This page's URL with one row's panel open, closed, or asking to confirm.
  rowHref: (memberId: string, mode: "open" | "close" | "confirm") => string;
}) {
  const anchor = staffMemberAnchor(member.id);
  const panelId = `${anchor}-panel`;
  const roleLabel = ROLE_LABELS[member.role] ?? member.role;
  // A member who already IS a director keeps the option, or an admin's edit of
  // that row would silently demote them just by pressing Save.
  const roleOptions = ROLE_OPTIONS.filter(
    (r) => r !== "director" || canGrantDirector || member.role === "director",
  );

  return (
    <Fragment>
      <tr id={anchor}>
        <td>{name}</td>
        <td className="muted">{STATUS_LABEL[member.status] ?? member.status}</td>
        <td>{roleLabel}</td>
        <td className="table-action">
          <Link
            href={rowHref(member.id, open ? "close" : "open")}
            className="people-disclosure"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={`Edit ${name}`}
          >
            {open ? "Close" : "Edit"}
          </Link>
        </td>
      </tr>

      {open && (
        <tr className="table-panel-row" id={panelId}>
          <td colSpan={columns}>
            <div className="table-panel">
              <div className="stack people-row-panel">
                <h3 className="drawer-title">{name}</h3>
                {error && <p className="alert-error">{error}</p>}

                <form action={reRoleMember} className="stack people-row-form">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="memberId" value={member.id} />
                  <label>
                    What they can do
                    <select name="role" defaultValue={member.role}>
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="secondary">
                    Save role
                  </button>
                </form>

                <div className="people-row-form stack">
                  {confirmRemove ? (
                    <div className="confirm-box stack">
                      <p>
                        Take {name} out of this program? They lose access the
                        moment you confirm. Anything they entered stays exactly
                        where it is.
                      </p>
                      <div className="row-inline">
                        <form action={removeMember}>
                          <input type="hidden" name="programId" value={programId} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="memberId" value={member.id} />
                          <button type="submit" className="danger">
                            Remove them
                          </button>
                        </form>
                        <Link href={rowHref(member.id, "open")}>Keep them</Link>
                      </div>
                    </div>
                  ) : (
                    <Link
                      href={rowHref(member.id, "confirm")}
                      className="linklike danger"
                    >
                      Remove from this program…
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
