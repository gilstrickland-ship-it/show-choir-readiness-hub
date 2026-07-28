import {
  PIECE_KINDS,
  PIECE_CONDITIONS,
  PIECE_KIND_LABELS,
  PIECE_CONDITION_LABELS,
  NO_HEALTH_LABEL,
} from "@/lib/costumes";
import { addPiece } from "../actions";

// Adding a piece is a drawer off the page head (spec 005 US14), the same
// affordance Season, Money and Shifts use: the page stays a list of what the
// program owns, and the form that adds to it opens over the list instead of
// parking a permanent eight-input block under it.
//
// Props and set pieces are kinds in this one form, not a second screen (§4:
// "one inventory, no extra screens") — the kind list says so out loud.

export function AddPiece({
  programId,
  slug,
  sets,
  open,
  error,
}: {
  programId: string;
  slug: string;
  sets: { id: string; name: string }[];
  // A rejected create reopens the drawer with its message inside, so the typing
  // is still on screen next to the reason (the Wave-1 drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add piece</summary>
      <div className="drawer-panel" id="add-piece">
        <h2 className="drawer-title">Add a piece</h2>
        {error && <p className="alert-error">{error}</p>}
        <form action={addPiece} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <div className="row-inline">
            <label>
              What it is
              <select name="kind" required defaultValue="dress">
                {PIECE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PIECE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                type="text"
                name="label"
                required
                placeholder="Dress #14, Riser 3"
              />
            </label>
          </div>
          <div className="row-inline">
            <label>
              Size
              <input type="text" name="size_label" placeholder="M, 10, 32W" />
            </label>
            <label>
              Colour
              <input type="text" name="color" placeholder="Emerald" />
            </label>
            <label>
              Condition
              <select name="condition" defaultValue="good">
                {PIECE_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {PIECE_CONDITION_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row-inline">
            <label>
              Where it lives
              <input
                type="text"
                name="storage_location"
                placeholder="Bin 3, Rack A"
              />
            </label>
            <label>
              Set
              <select name="set_id" defaultValue="">
                <option value="">Not in a set yet</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Notes
            <input type="text" name="notes" placeholder="Zip sticks" />
          </label>
          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit">Add piece</button>
        </form>
      </div>
    </details>
  );
}
