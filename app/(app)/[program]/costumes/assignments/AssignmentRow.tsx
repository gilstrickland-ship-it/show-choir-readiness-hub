import { Fragment } from "react";
import Link from "next/link";
import {
  ALTERATION_STATUSES,
  ALTERATION_STATUS_LABELS,
  PIECE_KIND_LABELS,
  relevantSizeValue,
  sizeMismatch,
  type PieceKind,
  type AlterationStatus,
} from "@/lib/costumes";
import { assignPiece, unassignPiece } from "./actions";
import { setAlterationStatus } from "../alteration-actions";

// One assignable piece and who is in it (spec 005 US14-2). The row states the
// facts — piece, size, who is wearing it, whether it fits, where its alteration
// stands — and the three things you can do about it live behind one Edit
// disclosure that EXPANDS the row: assign or reassign, move the alteration
// along, take the piece back.
//
// The panel opens in a row of its OWN, spanning every column, rather than inside
// the last cell (spec 005 T143b). `table.members` is `display:block;
// overflow-x:auto` so the grid can scroll on a phone, and a scroll container
// clips any absolutely-positioned descendant, so a FLOATING panel came out
// sliced off at the cell edge (Wave 4) — but expanding the row only fixed the
// clipping. Measured at 375px, the panel still opened 308px into a 343px scroll
// port: 11% of it on screen. A full-width row beneath, stuck to the left edge of
// the port, is what puts it where it can be read.
//
// The size-mismatch chip is advisory and never blocks (§4) — programs size their
// students in their own vocabulary, so the match is a best-effort heuristic.

export interface AssignablePiece {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
}

export interface EligibleStudent {
  id: string;
  first_name: string;
  last_name: string;
  sizes: Record<string, unknown> | null;
  status: string;
}

export interface PieceAssignment {
  id: string;
  student_id: string;
  alteration_status: AlterationStatus;
}

export function AssignmentRow({
  programId,
  slug,
  seasonId,
  setId,
  piece,
  assignment,
  student,
  students,
  canWrite,
  open,
  error,
  rowHref,
  columns,
}: {
  programId: string;
  slug: string;
  seasonId: string;
  setId: string;
  piece: AssignablePiece;
  assignment: PieceAssignment | null;
  student: EligibleStudent | null;
  students: EligibleStudent[];
  canWrite: boolean;
  // The row's panel opens on `?edit=<pieceId>`, and every refusal from this row
  // comes back on it so the message lands inside the control that produced it.
  open: boolean;
  error: string | null;
  // This page's URL with one row's panel open (or none), keeping the set picker.
  rowHref: (pieceId: string | null) => string;
  // How many columns the panel row has to span.
  columns: number;
}) {
  const studentSize = student ? relevantSizeValue(piece.kind, student.sizes) : null;
  const mismatch = student
    ? sizeMismatch(piece.size_label, piece.kind, student.sizes)
    : false;
  const studentLabel = (s: EligibleStudent): string => {
    const size = relevantSizeValue(piece.kind, s.sizes);
    return `${s.last_name}, ${s.first_name}${size ? ` — ${size}` : ""}`;
  };
  const who = student
    ? `${piece.label} — ${student.last_name}, ${student.first_name}`
    : piece.label;

  return (
    <Fragment>
    <tr>
      <td>
        <Link href={`/${slug}/costumes/pieces/${piece.id}`}>{piece.label}</Link>{" "}
        <span className="muted">{PIECE_KIND_LABELS[piece.kind]}</span>
      </td>
      <td>{piece.size_label ?? "—"}</td>
      <td>
        {student ? (
          <>
            {student.last_name}, {student.first_name}
            {studentSize && <span className="muted"> ({studentSize})</span>}
            {mismatch && (
              <span
                className="chip danger"
                title="Piece size differs from student size"
              >
                size mismatch
              </span>
            )}
            {student.status === "inactive" && (
              <span className="muted"> (inactive)</span>
            )}
          </>
        ) : (
          <span className="muted">Nobody yet</span>
        )}
      </td>
      <td>
        {assignment ? (
          <span className={`alt-pill ${assignment.alteration_status}`}>
            {ALTERATION_STATUS_LABELS[assignment.alteration_status]}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      {canWrite && (
        <td className="table-action">
          <Link
            href={rowHref(open ? null : piece.id)}
            className="wardrobe-disclosure"
            aria-expanded={open}
            aria-controls={open ? `piece-${piece.id}` : undefined}
            aria-label={assignment ? `Edit ${who}` : `Assign ${piece.label}`}
          >
            {open ? "Close" : assignment ? "Edit" : "Assign"}
          </Link>
        </td>
      )}
    </tr>
    {canWrite && open && (
      <tr className="table-panel-row" id={`piece-${piece.id}`}>
        <td colSpan={columns}>
          <div className="table-panel">
            <div className="stack wardrobe-row-panel">
              <h3 className="drawer-title">
                {assignment ? "Edit assignment" : "Assign this piece"}
              </h3>
              {error && <p className="alert-error">{error}</p>}

              {students.length === 0 ? (
                <p className="muted">
                  No students to assign — this set&apos;s ensemble has no members
                  this season.
                </p>
              ) : (
                <form action={assignPiece} className="stack wardrobe-row-form">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="setId" value={setId} />
                  <input type="hidden" name="seasonId" value={seasonId} />
                  <input type="hidden" name="pieceId" value={piece.id} />
                  <label>
                    Who wears it
                    <select
                      name="studentId"
                      defaultValue={assignment?.student_id ?? ""}
                      required
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {studentLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="secondary">
                    {assignment ? "Reassign" : "Assign"}
                  </button>
                  {assignment && (
                    <p className="muted">
                      Moving a piece to a different student clears its fitting —
                      the garment needs checking against a different body.
                    </p>
                  )}
                </form>
              )}

              {assignment && (
                <form
                  action={setAlterationStatus}
                  className="stack wardrobe-row-form"
                >
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="assignmentId" value={assignment.id} />
                  <input type="hidden" name="from" value="assignments" />
                  <input type="hidden" name="setId" value={setId} />
                  <input type="hidden" name="pieceId" value={piece.id} />
                  <label>
                    Alteration
                    <select
                      name="status"
                      defaultValue={assignment.alteration_status}
                    >
                      {ALTERATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {ALTERATION_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="secondary">
                    Set alteration
                  </button>
                </form>
              )}

              {assignment && (
                <form action={unassignPiece} className="wardrobe-row-form">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="setId" value={setId} />
                  <input type="hidden" name="pieceId" value={piece.id} />
                  <input type="hidden" name="assignmentId" value={assignment.id} />
                  <button
                    type="submit"
                    className="linklike danger"
                    aria-label={`Take back ${who}`}
                  >
                    Take this piece back
                  </button>
                </form>
              )}
            </div>
          </div>
        </td>
      </tr>
    )}
    </Fragment>
  );
}
