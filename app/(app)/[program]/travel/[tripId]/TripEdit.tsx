import { updateTrip } from "../actions";

// Overview's edit popover (spec 005 US6) — the trip's own facts, in the same
// disclosure idiom the Season spine uses for a row: the summary NAMES what is
// inside and shows the current state, so nothing mutating hides behind a bare
// triangle.
//
// Sparse save (`sparse=1`, the Wave-1 idiom): the form posts only the fields it
// shows, and updateTrip leaves everything else alone. It shows the competition
// link — trip-page work — so that one IS posted here, and clearing it to "none"
// still unlinks. The overnight checkbox is room-safe: the action refuses to turn
// it off while rooms exist and comes back with `overnight_rooms`, rendered by
// the Overview section above this popover.

export function TripEdit({
  programId,
  slug,
  tripId,
  name,
  startsOn,
  endsOn,
  isOvernight,
  competitionId,
  seasonComps,
  summary,
}: {
  programId: string;
  slug: string;
  tripId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isOvernight: boolean;
  competitionId: string;
  seasonComps: { id: string; name: string }[];
  summary: string;
}) {
  return (
    <details className="stack">
      <summary className="travel-disclosure">Edit trip — {summary}</summary>
      <form
        action={updateTrip}
        className="stack"
        style={{ gap: "0.5rem", marginTop: "0.5rem" }}
      >
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="sparse" value="1" />
        <label>
          Name
          <input type="text" name="name" defaultValue={name} required />
        </label>
        <div className="row-inline">
          <label>
            Starts
            <input type="date" name="starts_on" defaultValue={startsOn} />
          </label>
          <label>
            Ends
            <input type="date" name="ends_on" defaultValue={endsOn} />
          </label>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              name="is_overnight"
              defaultChecked={isOvernight}
            />{" "}
            Overnight (rooms + buses)
          </label>
        </div>
        <label>
          Competition (optional)
          <select name="competition_id" defaultValue={competitionId}>
            <option value="">— none (banquet, tour, standalone)</option>
            {seasonComps.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">
          Save trip
        </button>
      </form>
    </details>
  );
}
