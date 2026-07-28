import {
  ALTERATION_STATUS_LABELS,
  PIECE_KIND_LABELS,
  NO_HEALTH_LABEL,
  type PieceKind,
  type AlterationStatus,
} from "@/lib/costumes";
import { setAlterationStatus, updateAlterationNotes } from "./alteration-actions";

// The alterations queue — the costume parent's working screen (§4), urgency
// sorted by the wearing ensemble's next competition.
//
// Two verbs stay on the row because they are one tap and irreversible-ish only
// in the trivial sense: Start and Done. The note is not a verb, it is a
// sentence, and it used to sit in a permanently-expanded text input on every
// single row — the whole queue read as a wall of half-filled forms. It is now a
// row-local `<details>` whose summary IS the note, so the queue reads as a
// queue and the note is one tap from the row it belongs to (spec 005 US14).
//
// The panel EXPANDS the row rather than floating over it (the Wave-4 lesson):
// `.alt-row` is a wrapping flex row, and a floating panel over a row that can
// be the last on the page opens off the bottom of the document.

export interface QueueItem {
  id: string;
  status: AlterationStatus;
  notes: string | null;
  studentName: string;
  pieceLabel: string;
  pieceKind: PieceKind;
  location: string | null;
  size: string | null;
  ensembleId: string | null;
  /** YYYY-MM-DD urgency key ("9999-…" when no upcoming comp). */
  sortDate: string;
}

// A row's panel opens on `?edit=<assignmentId>` — the same param the ledger,
// the budget builder and the shift card use — and a failed save comes back on
// it, so the message lands inside the panel that produced it.
export function alterationAnchor(assignmentId: string): string {
  return `alt-${assignmentId}`;
}

export function AltQueue({
  programId,
  slug,
  items,
  canWrite,
  openId,
  error,
}: {
  programId: string;
  slug: string;
  items: QueueItem[];
  canWrite: boolean;
  openId: string | null;
  error: string | null;
}) {
  return (
    <div className="alt-queue">
      {items.map((it) => {
        const meta = [it.location, it.size].filter(Boolean).join(" · ");
        const who = `${it.pieceLabel} — ${it.studentName}`;
        const isOpen = openId === it.id;
        return (
          <div key={it.id} className="alt-row" id={alterationAnchor(it.id)}>
            <span className={`alt-pill ${it.status}`}>
              {ALTERATION_STATUS_LABELS[it.status]}
            </span>
            <div className="alt-body">
              <strong>{it.pieceLabel}</strong>{" "}
              <span className="alt-kind">{PIECE_KIND_LABELS[it.pieceKind]}</span>
              {" — "}
              {it.studentName}
            </div>
            {meta && <span className="alt-meta">{meta}</span>}
            {canWrite && (
              <div className="alt-actions">
                {it.status === "needed" && (
                  <form action={setAlterationStatus}>
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="assignmentId" value={it.id} />
                    <input type="hidden" name="status" value="in_progress" />
                    <button
                      type="submit"
                      className="secondary"
                      aria-label={`Start alteration: ${who}`}
                    >
                      Start
                    </button>
                  </form>
                )}
                <form action={setAlterationStatus}>
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="assignmentId" value={it.id} />
                  <input type="hidden" name="status" value="done" />
                  <button type="submit" aria-label={`Mark done: ${who}`}>
                    Done
                  </button>
                </form>
              </div>
            )}

            {canWrite ? (
              <details className="alt-note" open={isOpen}>
                <summary
                  className="wardrobe-disclosure"
                  aria-label={`Note for ${who}`}
                >
                  {it.notes ? `Note — ${it.notes}` : "Add a note"}
                </summary>
                <div className="alt-note-panel stack">
                  {isOpen && error && <p className="alert-error">{error}</p>}
                  <form action={updateAlterationNotes} className="stack">
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="assignmentId" value={it.id} />
                    <label>
                      What needs doing
                      <input
                        type="text"
                        name="alteration_notes"
                        defaultValue={it.notes ?? ""}
                        placeholder="Hem an inch, take in the waist"
                      />
                    </label>
                    <p className="muted">{NO_HEALTH_LABEL}</p>
                    <button type="submit" className="secondary">
                      Save note
                    </button>
                  </form>
                </div>
              </details>
            ) : (
              it.notes && <span className="alt-meta">{it.notes}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
