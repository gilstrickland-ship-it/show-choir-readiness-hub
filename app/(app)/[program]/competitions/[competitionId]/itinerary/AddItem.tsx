import { addItineraryItem } from "./actions";
import { ItemFields } from "./ItineraryRow";

// Adding a line to the day is a drawer off the page head (spec 005 T156), the
// same affordance Season, Money, Shifts and Wardrobe use.
//
// It replaces a permanent seven-input block parked under the table — which meant
// the schedule you were reading always had a blank form after it, and the fields
// it offered were spelled differently from the ones in the rows above ("Order",
// "Kind", "Starts at" against the row's unlabelled boxes). One fieldset now,
// shared with the row panel (ItemFields), so the two can't drift.

export function AddItem({
  programId,
  slug,
  competitionId,
  itineraryId,
  tz,
  nextOrder,
  open,
  error,
}: {
  programId: string;
  slug: string;
  competitionId: string;
  itineraryId: string;
  tz: string;
  nextOrder: number;
  // A rejected add reopens the drawer with its message inside, so the typing is
  // still on screen next to the reason (the Wave-1 drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add an item</summary>
      <div className="drawer-panel" id="add-item">
        <h2 className="drawer-title">Add an item</h2>
        {error && <p className="alert-error">{error}</p>}
        <form action={addItineraryItem} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <input type="hidden" name="itineraryId" value={itineraryId} />
          <input type="hidden" name="tz" value={tz} />
          <ItemFields item={null} tz={tz} nextOrder={nextOrder} />
          <button type="submit">Add item</button>
        </form>
      </div>
    </details>
  );
}
