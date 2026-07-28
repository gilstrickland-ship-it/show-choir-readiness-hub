import Link from "next/link";
import { ensembleAnchor } from "@/lib/roster/ensembles";
import { updateEnsemble, deleteEnsemble } from "./actions";

// One ensemble, and the two things a director does to one: open its membership,
// or correct it. The name and the sort order used to be permanently-open inputs
// in the row with a Save beside them, and Delete sat one tab-stop away as a bare
// button — a mis-tap on a phone deleted a group.
//
// The panel EXPANDS the row rather than floating over it (the Wave-4 lesson):
// `table.members` is `display:block; overflow-x:auto`, and a scroll container
// clips any absolutely-positioned descendant. Delete lives inside the panel,
// last, behind a confirm.

export interface EnsembleListRow {
  id: string;
  name: string;
  sort_order: number;
}

export function EnsembleRow({
  programId,
  slug,
  ensemble,
  memberCount,
  seasonLabel,
  canWrite,
  open,
  confirmDelete,
  error,
}: {
  programId: string;
  slug: string;
  ensemble: EnsembleListRow;
  memberCount: number | null;
  seasonLabel: string | null;
  canWrite: boolean;
  // The panel reopens on `?edit=<ensembleId>`, and a refused save (or a refused
  // delete) comes back on it so the message lands inside the panel.
  open: boolean;
  confirmDelete: boolean;
  error: string | null;
}) {
  const anchor = ensembleAnchor(ensemble.id);
  const list = `/${slug}/roster/ensembles`;
  const members = `${list}/${ensemble.id}`;

  return (
    <tr id={anchor}>
      <td>
        {seasonLabel ? <Link href={members}>{ensemble.name}</Link> : ensemble.name}
      </td>
      <td>
        {seasonLabel ? (
          <>
            {memberCount ?? 0}{" "}
            <span className="muted">in {seasonLabel}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      {canWrite && (
        <td>
          <details open={open}>
            <summary
              className="people-disclosure"
              aria-label={`Edit ${ensemble.name}`}
            >
              Edit
            </summary>
            <div className="stack people-row-panel">
              <h3 className="drawer-title">Edit ensemble</h3>
              {error && <p className="alert-error">{error}</p>}
              <form action={updateEnsemble} className="stack people-row-form">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="ensembleId" value={ensemble.id} />
                <label>
                  Name
                  <input
                    type="text"
                    name="name"
                    defaultValue={ensemble.name}
                    required
                  />
                </label>
                <label>
                  Order in lists
                  <input
                    type="number"
                    name="sort_order"
                    className="num"
                    defaultValue={ensemble.sort_order}
                  />
                </label>
                <button type="submit" className="secondary">
                  Save ensemble
                </button>
                <p className="muted">
                  Lower numbers come first — your top group at 0, the next at 1.
                </p>
              </form>

              <div className="people-row-form stack">
                {confirmDelete ? (
                  <div className="confirm-box stack">
                    <p>
                      Delete {ensemble.name}? This only works while nothing points
                      at it — no members in any season, no costume sets, no
                      competitions.
                    </p>
                    <div className="row-inline">
                      <form action={deleteEnsemble}>
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="ensembleId" value={ensemble.id} />
                        <button type="submit" className="danger">
                          Delete {ensemble.name}
                        </button>
                      </form>
                      <Link href={`${list}?edit=${ensemble.id}#${anchor}`}>
                        Keep it
                      </Link>
                    </div>
                  </div>
                ) : (
                  <Link
                    href={`${list}?edit=${ensemble.id}&confirm=delete#${anchor}`}
                    className="linklike danger"
                  >
                    Delete this ensemble…
                  </Link>
                )}
              </div>
            </div>
          </details>
        </td>
      )}
    </tr>
  );
}
