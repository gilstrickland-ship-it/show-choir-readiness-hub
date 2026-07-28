import { createShift } from "./actions";

// Adding a shift is a drawer off the page head (spec 005 US9-3), the same
// affordance Season and Money use: the page stays a list of shifts, and the
// form that makes a new one opens over it instead of parking a permanent
// nine-input block at the bottom of the scroll.
//
// The attach-to pair (what this shift is for, then which one) is the only thing
// here that needs explaining, so it says so once, next to the controls, and the
// action resolves whatever is posted inside the program before it writes.

export interface NamedOption {
  id: string;
  name: string;
}

export function AddShift({
  programId,
  slug,
  seasonId,
  tz,
  competitions,
  trips,
  events,
  open,
  error,
}: {
  programId: string;
  slug: string;
  seasonId: string;
  tz: string;
  competitions: NamedOption[];
  trips: NamedOption[];
  events: NamedOption[];
  // A rejected create reopens the drawer with its message inside, so the typing
  // is still on screen next to the reason (the Wave-1 drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add shift</summary>
      <div className="drawer-panel" id="add-shift">
        <h2 className="drawer-title">Add a shift</h2>
        {error && <p className="alert-error">{error}</p>}
        <form action={createShift} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="seasonId" value={seasonId} />
          <input type="hidden" name="tz" value={tz} />
          <div className="row-inline">
            <label>
              Title
              <input
                type="text"
                name="title"
                required
                placeholder="Concessions crew"
              />
            </label>
            <label>
              Needed
              <input
                type="number"
                name="needed_count"
                className="num"
                min={1}
                defaultValue={1}
              />
            </label>
          </div>
          <p className="muted">
            Volunteer no-shows typically run 10–20% — for critical crews, add one
            or two extra slots.
          </p>
          <div className="row-inline">
            <label>
              Starts
              <input type="datetime-local" name="starts_at" />
            </label>
            <label>
              Ends
              <input type="datetime-local" name="ends_at" />
            </label>
          </div>
          <div className="row-inline">
            <label>
              What it&apos;s for
              <select name="attach_kind" defaultValue="none">
                <option value="none">Nothing (standalone)</option>
                <option value="competition">Competition</option>
                <option value="trip">Trip</option>
                <option value="event">Event</option>
              </select>
            </label>
            <label>
              Which one
              <select name="attach_id" defaultValue="">
                <option value="">—</option>
                <optgroup label="Competitions">
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Trips">
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Events">
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          </div>
          <p className="muted">
            Pick what the shift is for, then the matching one below it. Anything
            picked that doesn&apos;t match is ignored.
          </p>
          <label>
            Notes
            <input type="text" name="notes" placeholder="Bring a cash box" />
          </label>
          <button type="submit">Add shift</button>
        </form>
      </div>
    </details>
  );
}
