import { addEnsemble } from "./actions";

// "+ Add ensemble" as a drawer off the page head — the affordance People, Money,
// Wardrobe and Comms already use. The page stays the list of groups you have;
// the form that makes another one opens over it instead of sitting permanently
// at the bottom of the page.

export function AddEnsemble({
  programId,
  slug,
  open,
  error,
}: {
  programId: string;
  slug: string;
  // A rejected create reopens the drawer with its message inside, so the typing
  // is still on screen next to the reason (the Wave-1 drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add ensemble</summary>
      <div className="drawer-panel" id="add-ensemble">
        <h2 className="drawer-title">Add an ensemble</h2>
        {error && <p className="alert-error">{error}</p>}
        <form action={addEnsemble} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <label>
            Name
            <input type="text" name="name" required placeholder="Varsity Mixed" />
          </label>
          <label>
            Order in lists
            <input type="number" name="sort_order" className="num" defaultValue={0} />
          </label>
          <p className="muted">
            Lower numbers come first — your top group at 0, the next at 1. An
            ensemble belongs to the program, so it carries across seasons; who is
            in it is set per season.
          </p>
          <button type="submit">Add ensemble</button>
        </form>
      </div>
    </details>
  );
}
