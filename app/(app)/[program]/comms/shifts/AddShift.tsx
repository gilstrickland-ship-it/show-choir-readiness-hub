import { createShift } from "./actions";

// Adding a shift is a drawer off the page head (spec 005 US9-3), the same
// affordance Season and Money use: the page stays a list of shifts, and the
// form that makes a new one opens over it instead of parking a permanent
// nine-input block at the bottom of the scroll.
//
// What a shift is FOR used to be two selects — a kind, and a "which one" list
// that held every competition, trip and event at once — with help text promising
// that a pick which didn't match the kind was "ignored". It was not: the create
// was refused and the drawer, with everything typed into it, was thrown away.
// It is one select now, and each option names both halves ("Competition ·
// Regionals"), so the mismatch it explained away cannot be expressed. No client
// JavaScript, no dependent dropdown — the value posts as "<kind>:<id>" and the
// action resolves the id inside the program before it writes.

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
          <label>
            What it&apos;s for
            <select name="attach" defaultValue="">
              <option value="">Nothing (standalone)</option>
              {competitions.length > 0 && (
                <optgroup label="Competitions">
                  {competitions.map((c) => (
                    <option key={c.id} value={`competition:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {trips.length > 0 && (
                <optgroup label="Trips">
                  {trips.map((t) => (
                    <option key={t.id} value={`trip:${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {events.length > 0 && (
                <optgroup label="Events">
                  {events.map((e) => (
                    <option key={e.id} value={`event:${e.id}`}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <p className="muted">
            A shift can hang off a competition, a trip or an event — or off
            nothing at all. What it&apos;s for is set here and stays put; to move
            it later, delete it and add it where it belongs.
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
