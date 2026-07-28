import { NO_HEALTH_LABEL } from "@/lib/costumes";
import { addSet } from "../actions";

// Adding a set is a drawer off the page head (spec 005 US13/US14). Sets used to
// be their own tab whose entire content was a table of four inline inputs and a
// form under it; a set is not a job, it is the grouping the assignment grid
// hangs off, so making one lives here, next to the grid it opens.

export function AddSet({
  programId,
  slug,
  seasonId,
  ensembles,
  open,
  error,
}: {
  programId: string;
  slug: string;
  seasonId: string;
  ensembles: { id: string; name: string }[];
  // A rejected create reopens the drawer with its message inside, so the typing
  // is still on screen next to the reason (the Wave-1 drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add set</summary>
      <div className="drawer-panel" id="add-set">
        <h2 className="drawer-title">Add a set</h2>
        {error && <p className="alert-error">{error}</p>}
        <form action={addSet} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="seasonId" value={seasonId} />
          <label>
            Name
            <input
              type="text"
              name="name"
              required
              placeholder="Opener, Ballad, Closer"
            />
          </label>
          <p className="muted">
            A set is one look — the costume everyone wears for one part of the
            show. Name it after the number it goes with.
          </p>
          <div className="row-inline">
            <label>
              Who wears it
              <select name="ensemble_id" defaultValue="">
                <option value="">No ensemble yet</option>
                {ensembles.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Order in the show
              <input
                type="number"
                name="sort_order"
                defaultValue={0}
                className="num"
              />
            </label>
          </div>
          <p className="muted">
            The ensemble is what lists students to assign to. The order drives
            the quick-change sheet, so keep it in performance order.
          </p>
          <label>
            Notes
            <input type="text" name="notes" placeholder="Gloves stay on" />
          </label>
          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit">Add set</button>
        </form>
      </div>
    </details>
  );
}
