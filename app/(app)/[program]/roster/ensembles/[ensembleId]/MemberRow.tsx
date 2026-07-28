import { Fragment } from "react";
import Link from "next/link";
import {
  MEMBER_ROLES,
  MEMBER_ROLE_LABELS,
  memberAnchor,
  type MemberRole,
} from "@/lib/roster/ensembles";
import { updateMember, removeMember } from "../actions";

// One placement in one ensemble for one season, and the two things a director
// does to it: open the student, or correct the placement. Role and voice part
// used to be permanently-open controls in the row with Save beside them and
// Remove a tab-stop away — the same shape the guardian row had.
//
// The panel EXPANDS the row rather than floating over it (the Wave-4 lesson):
// `table.members` is `display:block; overflow-x:auto`, and a scroll container
// clips any absolutely-positioned descendant. Remove lives inside the panel,
// last, behind a confirm.

export interface MemberListRow {
  id: string;
  student_id: string;
  role: string;
  voice_part: string | null;
  students: { first_name: string; last_name: string; status: string } | null;
}

export function MemberRow({
  programId,
  slug,
  ensembleId,
  member,
  canWrite,
  open,
  confirmRemove,
  error,
}: {
  programId: string;
  slug: string;
  ensembleId: string;
  member: MemberListRow;
  canWrite: boolean;
  // The panel reopens on `?edit=<memberId>`, and a refused save comes back on it
  // so the message lands inside the panel that produced it.
  open: boolean;
  confirmRemove: boolean;
  error: string | null;
}) {
  const anchor = memberAnchor(member.id);
  const page = `/${slug}/roster/ensembles/${ensembleId}`;
  const name = `${member.students?.last_name ?? ""}, ${member.students?.first_name ?? ""}`;
  const roleLabel =
    MEMBER_ROLE_LABELS[member.role as MemberRole] ?? member.role;

  const panelId = `${anchor}-panel`;

  return (
    <Fragment>
    <tr id={anchor}>
      <td>
        <Link href={`/${slug}/roster/${member.student_id}`}>{name}</Link>
        {member.students?.status === "inactive" && (
          <span className="muted"> (inactive)</span>
        )}
      </td>
      <td>{roleLabel}</td>
      <td>{member.voice_part ?? <span className="muted">—</span>}</td>
      {canWrite && (
        <td className="table-action">
          <Link
            href={open ? `${page}#${anchor}` : `${page}?edit=${member.id}#${anchor}`}
            className="people-disclosure"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={`Edit ${name}`}
          >
            {open ? "Close" : "Edit"}
          </Link>
        </td>
      )}
    </tr>
    {canWrite && open && (
      <tr className="table-panel-row" id={panelId}>
        <td colSpan={4}>
          <div className="table-panel">
            <div className="stack people-row-panel">
              <h3 className="drawer-title">Edit placement</h3>
              {error && <p className="alert-error">{error}</p>}
              <form action={updateMember} className="stack people-row-form">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="ensembleId" value={ensembleId} />
                <input type="hidden" name="memberId" value={member.id} />
                <label>
                  What they do here
                  <select name="role" defaultValue={member.role}>
                    {MEMBER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {MEMBER_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Voice part
                  <input
                    type="text"
                    name="voice_part"
                    defaultValue={member.voice_part ?? ""}
                    placeholder="Soprano 1, Tenor, …"
                  />
                </label>
                <button type="submit" className="secondary">
                  Save placement
                </button>
              </form>

              <div className="people-row-form stack">
                {confirmRemove ? (
                  <div className="confirm-box stack">
                    <p>
                      Take {member.students?.first_name ?? "this student"} out of
                      this ensemble for this season? Their roster record and every
                      other season stay exactly as they are.
                    </p>
                    <div className="row-inline">
                      <form action={removeMember}>
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="ensembleId" value={ensembleId} />
                        <input type="hidden" name="memberId" value={member.id} />
                        <button type="submit" className="danger">
                          Remove from this ensemble
                        </button>
                      </form>
                      <Link href={`${page}?edit=${member.id}#${anchor}`}>
                        Keep them
                      </Link>
                    </div>
                  </div>
                ) : (
                  <Link
                    href={`${page}?edit=${member.id}&confirm=remove#${anchor}`}
                    className="linklike danger"
                  >
                    Remove from this ensemble…
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
