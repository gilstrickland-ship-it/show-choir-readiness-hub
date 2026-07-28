import { toZonedInputValue } from "@/lib/datetime";
import { EVENT_KINDS, EVENT_KIND_LABELS } from "@/lib/events";
import { updateEvent } from "../actions";

export interface EditableEvent {
  id: string;
  title: string;
  kind: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  note: string | null;
}

// One event's edit disclosure (spec 005 Wave 11 / T159), the same shape the
// host center's Overview uses: the facts render above, in the open, for
// everyone who can read the page; this is only how a writer CHANGES them, and
// its summary says what it holds.
//
// What it replaces: the page rendered a bare form to a writer and a read list
// to everyone else, so a director could not see her own event without reading
// it out of the input boxes — and the two halves had drifted, the read list
// never showing the end time the form could set.
//
// The form posts the whole record on purpose (it shows the whole record), which
// is why an emptied field still clears — the same contract as the competition
// hub and the host center. The Season spine's popover is the sparse one.

export function EventEdit({
  programId,
  slug,
  event,
  tz,
  ensembles,
  targetedEnsembleIds,
  summary,
  open,
}: {
  programId: string;
  slug: string;
  event: EditableEvent;
  tz: string;
  ensembles: { id: string; name: string }[];
  targetedEnsembleIds: string[];
  // The live one-line state, shared with the section head so the collapsed
  // summary says the same thing the heading does.
  summary: string;
  // A refused save comes back on `?error=` and springs the panel open, so the
  // message lands beside the fields that produced it.
  open: boolean;
}) {
  return (
    <details className="stack" open={open}>
      <summary className="comp-disclosure">Edit event — {summary}</summary>
      <form action={updateEvent} className="stack">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="tz" value={tz} />
        <div className="row-inline">
          <label>
            Title
            <input
              type="text"
              name="title"
              defaultValue={event.title}
              required
            />
          </label>
          <label>
            Kind
            <select name="kind" defaultValue={event.kind}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row-inline">
          <label>
            Starts
            <input
              type="datetime-local"
              name="starts_at"
              defaultValue={toZonedInputValue(event.starts_at, tz)}
            />
          </label>
          <label>
            Ends
            <input
              type="datetime-local"
              name="ends_at"
              defaultValue={toZonedInputValue(event.ends_at, tz)}
            />
          </label>
          <label>
            Where
            <input
              type="text"
              name="location"
              defaultValue={event.location ?? ""}
            />
          </label>
        </div>
        <fieldset className="stack">
          <legend>Who it&apos;s for</legend>
          <p className="muted">
            Leave every box unticked and the whole program is invited; tick one
            or more to invite just those groups.
          </p>
          <div className="row-inline" style={{ flexWrap: "wrap" }}>
            {ensembles.map((e) => (
              <label key={e.id} className="checkbox-inline">
                <input
                  type="checkbox"
                  name="ensemble_ids"
                  value={e.id}
                  defaultChecked={targetedEnsembleIds.includes(e.id)}
                />
                {e.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Note
          <input type="text" name="note" defaultValue={event.note ?? ""} />
        </label>
        <button type="submit">Save changes</button>
      </form>
    </details>
  );
}
