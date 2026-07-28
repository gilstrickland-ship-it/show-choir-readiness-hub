import Link from "next/link";
import {
  PIECE_KINDS,
  PIECE_CONDITIONS,
  PIECE_KIND_LABELS,
  PIECE_CONDITION_LABELS,
  type PieceKind,
  type PieceCondition,
} from "@/lib/costumes";
import { updatePiece, retirePiece } from "../actions";

// One inventory row and the correction this domain makes constantly: a size
// that was wrong, a piece that moved into a different set, a dress that came
// back from the cleaners in worse shape than it went (spec 005 US14-2).
//
// The panel EXPANDS the row instead of floating over it — the Wave-4 lesson:
// `table.members` is `display:block; overflow-x:auto` so it can scroll on a
// phone, and a scroll container clips any absolutely-positioned descendant, so
// a floating panel came out sliced off at the cell edge.
//
// The form posts ONLY the five fields it shows, plus `sparse=1`. updatePiece
// reads that as "leave everything else alone", which is what lets a size fix be
// a size fix: it can't clear a storage location or a note nobody touched.
// Colour, storage and notes stay on the piece's own page, one link away.

export interface PieceListRow {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
  color: string | null;
  condition: PieceCondition;
  storage_location: string | null;
  set_id: string | null;
}

export function PieceRow({
  programId,
  slug,
  piece,
  setName,
  sets,
  canWrite,
  open,
  error,
}: {
  programId: string;
  slug: string;
  piece: PieceListRow;
  setName: string | null;
  sets: { id: string; name: string }[];
  canWrite: boolean;
  // The row's panel opens on `?edit=<pieceId>`, and a refused save comes back
  // on it so the message lands inside the panel that produced it.
  open: boolean;
  error: string | null;
}) {
  const detail = `/${slug}/costumes/pieces/${piece.id}`;
  const retired = piece.condition === "retire";

  return (
    <tr>
      <td>
        <Link href={detail}>{piece.label}</Link>
      </td>
      <td>{PIECE_KIND_LABELS[piece.kind]}</td>
      <td>{piece.size_label ?? "—"}</td>
      <td>{piece.color ?? "—"}</td>
      <td>
        {retired ? (
          <span className="muted">Retired</span>
        ) : (
          PIECE_CONDITION_LABELS[piece.condition]
        )}
      </td>
      <td>{piece.storage_location ?? "—"}</td>
      <td>{setName ?? <span className="muted">—</span>}</td>
      {canWrite && (
        <td>
          <details open={open}>
            <summary
              className="wardrobe-disclosure"
              aria-label={`Edit ${piece.label}`}
            >
              Edit
            </summary>
            <div className="stack wardrobe-row-panel">
              <h3 className="drawer-title">Edit piece</h3>
              {error && <p className="alert-error">{error}</p>}
              <form action={updatePiece} className="stack wardrobe-row-form">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pieceId" value={piece.id} />
                <input type="hidden" name="from" value="inventory" />
                <input type="hidden" name="sparse" value="1" />
                <label>
                  Name
                  <input
                    type="text"
                    name="label"
                    defaultValue={piece.label}
                    required
                  />
                </label>
                <div className="row-inline">
                  <label>
                    What it is
                    <select name="kind" defaultValue={piece.kind}>
                      {PIECE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {PIECE_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Size
                    <input
                      type="text"
                      name="size_label"
                      defaultValue={piece.size_label ?? ""}
                    />
                  </label>
                </div>
                <div className="row-inline">
                  <label>
                    Condition
                    <select name="condition" defaultValue={piece.condition}>
                      {PIECE_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {PIECE_CONDITION_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Set
                    <select name="set_id" defaultValue={piece.set_id ?? ""}>
                      <option value="">Not in a set</option>
                      {sets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit" className="secondary">
                  Save
                </button>
                <p className="muted">
                  Colour, where it lives and its notes:{" "}
                  <Link href={detail}>All details →</Link>
                </p>
              </form>
              {!retired && (
                <form action={retirePiece} className="wardrobe-row-form">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="pieceId" value={piece.id} />
                  <button
                    type="submit"
                    className="linklike danger"
                    aria-label={`Retire ${piece.label}`}
                  >
                    Retire this piece
                  </button>
                  <p className="muted">
                    Retiring keeps the record and its history — inventory is
                    never deleted.
                  </p>
                </form>
              )}
            </div>
          </details>
        </td>
      )}
    </tr>
  );
}
