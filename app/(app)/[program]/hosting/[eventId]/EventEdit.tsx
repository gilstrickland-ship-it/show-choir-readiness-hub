import {
  HOSTED_EVENT_STATUSES,
  HOSTED_EVENT_STATUS_LABELS,
  NO_HEALTH_LABEL,
  type HostedEventRow,
} from "@/lib/hosting";
import { updateHostedEvent } from "../actions";

// Overview's edit disclosure (spec 005 US11). It used to be a bare
// "Edit invitational details" triangle floating above the first section, holding
// the only copy of the day-of contact and the venue notes — so the two facts a
// visiting director asks for on the morning of the event lived where nobody
// could see them, and a board member (read-only) could never see them at all.
// Those facts now render in the Overview section above this; the disclosure is
// just the way a writer changes them, and its summary says what it holds and
// what those things currently are.
//
// The form posts the whole record on purpose (it shows the whole record), which
// is why an emptied field still clears — the same contract as the competition
// hub's Edit details.

export function EventEdit({
  programId,
  slug,
  event,
  summary,
  open,
}: {
  programId: string;
  slug: string;
  event: HostedEventRow;
  // The live one-line state, shared with the section head so the collapsed
  // summary says the same thing the heading does.
  summary: string;
  // A refused save comes back on `?error=` and springs the panel open, so the
  // message lands beside the fields that produced it.
  open: boolean;
}) {
  return (
    <details className="stack" open={open}>
      <summary className="comp-disclosure">
        Edit invitational — {summary}
      </summary>
      <form action={updateHostedEvent} className="stack hosting-panel">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="eventId" value={event.id} />
        <label>
          Name
          <input type="text" name="name" defaultValue={event.name} required />
        </label>
        <div className="row-inline">
          <label>
            First day
            <input
              type="date"
              name="event_date"
              defaultValue={event.event_date ?? ""}
            />
          </label>
          <label>
            Last day (leave blank for a single-day event)
            <input
              type="date"
              name="end_date"
              defaultValue={event.end_date ?? ""}
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={event.status}>
              {HOSTED_EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {HOSTED_EVENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Day-of contact for visiting directors
          <input
            type="text"
            name="host_contact"
            placeholder="Jane Smith · 555-0100"
            defaultValue={event.host_contact ?? ""}
          />
        </label>
        <label>
          Venue notes
          <textarea
            name="venue_notes"
            rows={2}
            defaultValue={event.venue_notes ?? ""}
          />
        </label>
        <p className="muted">{NO_HEALTH_LABEL}</p>
        <button type="submit">Save details</button>
      </form>
    </details>
  );
}
