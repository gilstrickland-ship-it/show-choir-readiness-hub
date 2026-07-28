import Link from "next/link";
import { NO_HEALTH_LABEL } from "@/lib/costumes";
import { updateSet, deleteSet } from "../actions";

// Everything the retired Sets tab could do to a set, on the set you are looking
// at (spec 005 US13-1): rename it, move it in the show, point it at the
// ensemble that wears it, note it, delete it — plus the way through to its
// pieces, which stay on the set's own detail route.
//
// The summary carries the set's live state, so the disclosure says what is
// inside it before you open it (the travel/comp/money disclosure contract).
// The panel EXPANDS the page rather than floating: it sits above a
// `table.members`, which is a scroll container, and a floating panel that
// overlaps one gets clipped by it (the Wave-4 lesson).

export function SetSettings({
  programId,
  slug,
  set,
  ensembles,
  pieceCount,
  open,
  error,
}: {
  programId: string;
  slug: string;
  set: {
    id: string;
    name: string;
    ensemble_id: string | null;
    sort_order: number;
    notes: string | null;
  };
  ensembles: { id: string; name: string }[];
  pieceCount: number;
  // Reopens on `?edit=set`, which is where a refused save or a refused delete
  // comes back to, so the message lands inside the panel that produced it.
  open: boolean;
  error: string | null;
}) {
  const ensembleName = set.ensemble_id
    ? ensembles.find((e) => e.id === set.ensemble_id)?.name ?? "—"
    : "no ensemble yet";
  const summary = `Set settings — ${set.name} · ${ensembleName} · ${pieceCount} piece${
    pieceCount === 1 ? "" : "s"
  }`;

  // Deliberately NOT a `.stack`: a flex <details> sizes its content box to its
  // content, and the panel's `width: 100%` then resolves against that shrunk box
  // instead of the page. Left a plain block, the panel spans the grid it
  // belongs to.
  return (
    <details className="wardrobe-settings" open={open}>
      <summary className="wardrobe-disclosure">{summary}</summary>
      <div className="stack wardrobe-section-panel">
        {error && <p className="alert-error">{error}</p>}
        <form action={updateSet} className="stack wardrobe-row-form">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="setId" value={set.id} />
          <div className="row-inline">
            <label>
              Name
              <input type="text" name="name" defaultValue={set.name} required />
            </label>
            <label>
              Who wears it
              <select name="ensemble_id" defaultValue={set.ensemble_id ?? ""}>
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
                defaultValue={set.sort_order}
                className="num"
              />
            </label>
          </div>
          <label>
            Notes
            <input type="text" name="notes" defaultValue={set.notes ?? ""} />
          </label>
          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit" className="secondary">
            Save set
          </button>
        </form>

        <p className="muted wardrobe-row-form">
          <Link href={`/${slug}/costumes/sets/${set.id}`}>
            Pieces in this set →
          </Link>{" "}
          — put pieces in, take them out.
        </p>

        <form action={deleteSet} className="wardrobe-row-form">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="setId" value={set.id} />
          <button
            type="submit"
            className="linklike danger"
            aria-label={`Delete set ${set.name}`}
          >
            Delete this set
          </button>
          <p className="muted">
            Only an empty set can go — take its pieces out first. The pieces
            themselves stay in inventory.
          </p>
        </form>
      </div>
    </details>
  );
}
