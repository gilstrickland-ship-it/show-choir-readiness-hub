import { updateTrip } from "../actions";

// Overview's edit popover (spec 005 US6) — the trip's own facts, in the same
// disclosure idiom the Season spine uses for a row: the summary NAMES what is
// inside and shows the current state, so nothing mutating hides behind a bare
// triangle.
//
// What updateTrip writes is decided by what this form posts, field by field:
// every input below is written on save. The competition link is the one field
// the two trip popovers differ on — the Season spine's doesn't show it and
// doesn't post it, so the action leaves the link alone there — and this popover
// does show it, so its value IS written, including the empty "— none" that
// deliberately unlinks. The overnight checkbox is room-safe: the action refuses
// to turn it off while rooms exist and comes back with `overnight_rooms`,
// rendered by the Overview section above this popover.

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
