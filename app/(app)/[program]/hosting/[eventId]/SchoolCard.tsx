import Link from "next/link";
import { type HostedSchoolRow } from "@/lib/hosting";
import { updateHostedSchool, removeHostedSchool } from "../actions";

// One visiting school, as a CARD rather than a table row (the Wave-6 lesson,
// measured): a ten-field school in `table.members` — `display:block;
// overflow-x:auto` — puts its edit panel hundreds of pixels into a horizontal
// scroller, where a 375px phone showed zero pixels of it. A card is the width of
// the page, so the panel opens where it can be read.
//
// Its facts are ALWAYS on the card. Before, a writer saw a name, an ensemble and
// a room chip and had to open an unlabeled `Edit` triangle for the director's
// phone number, the performer count, the division, the costume colours and the
// arrival notes — while a read-only board member saw a <dl> with all of it. Two
// renderings of one card, and the one for the person actually running the event
// showed less. There is one now, and Edit is only how a writer changes it.

export function SchoolCard({
  programId,
  slug,
  eventId,
  eventBase,
  school,
  sharedRoom,
  canWrite,
  open,
  confirmRemove,
}: {
  programId: string;
  slug: string;
  eventId: string;
  eventBase: string;
  school: HostedSchoolRow;
  sharedRoom: boolean;
  canWrite: boolean;
  open: boolean;
  confirmRemove: boolean;
}) {
  const contact = [
    school.director_name,
    school.director_email,
    school.director_phone,
  ]
    .filter(Boolean)
    .join(" · ");
  const facts = [
    school.performer_count != null
      ? `${school.performer_count} performer${school.performer_count === 1 ? "" : "s"}`
      : null,
    school.division,
    school.costume_colors,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="hosting-school-card">
      <div className="hosting-school-head">
        <strong>{school.school_name}</strong>
        {school.ensemble_name && (
          <span className="muted">{school.ensemble_name}</span>
        )}
        {school.homeroom && (
          <span className={sharedRoom ? "chip warn" : "chip"}>
            {school.homeroom}
            {sharedRoom ? " · shared" : ""}
          </span>
        )}
      </div>
      <p className="muted">{contact || "No director contact yet"}</p>
      {facts && <p className="muted">{facts}</p>}
      {school.arrival_notes && (
        <p className="muted">Arrival: {school.arrival_notes}</p>
      )}

      {canWrite && (
        <details open={open}>
          <summary
            className="comp-disclosure"
            aria-label={`Edit ${school.school_name}`}
          >
            Edit
          </summary>
          <div className="stack hosting-panel">
            <form action={updateHostedSchool} className="stack">
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="schoolId" value={school.id} />
              <input
                type="hidden"
                name="sort_order"
                value={school.sort_order}
              />
              <SchoolFields school={school} />
              <button type="submit" className="secondary">
                Save school
              </button>
            </form>
            {confirmRemove ? (
              <div className="confirm-box stack">
                <p>
                  Remove <strong>{school.school_name}</strong>? Its schedule
                  slots stay on the schedule, with no school on them.
                </p>
                <div className="row-inline">
                  <form action={removeHostedSchool}>
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="schoolId" value={school.id} />
                    <button type="submit" className="danger">
                      Remove {school.school_name}
                    </button>
                  </form>
                  <Link href={`${eventBase}?open=${school.id}#schools`}>
                    Keep it
                  </Link>
                </div>
              </div>
            ) : (
              <p>
                <Link
                  className="linklike danger"
                  href={`${eventBase}?confirm=removeschool&open=${school.id}#schools`}
                >
                  Remove this school…
                </Link>
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// The editable school fieldset, shared by add and edit. Both forms post every
// field they show, so clearing one clears it — there is no half-posted subset
// here to strand a value. The free-text fields carry the standing no-health
// label once at the section level rather than per field.
export function SchoolFields({
  school,
}: {
  school: HostedSchoolRow | null;
}) {
  return (
    <>
      <div className="row-inline">
        <label>
          School name
          <input
            type="text"
            name="school_name"
            defaultValue={school?.school_name ?? ""}
            required
          />
        </label>
        <label>
          Ensemble
          <input
            type="text"
            name="ensemble_name"
            defaultValue={school?.ensemble_name ?? ""}
          />
        </label>
        <label>
          Division
          <input
            type="text"
            name="division"
            placeholder="Large Mixed"
            defaultValue={school?.division ?? ""}
          />
        </label>
      </div>
      <div className="row-inline">
        <label>
          Director name
          <input
            type="text"
            name="director_name"
            defaultValue={school?.director_name ?? ""}
          />
        </label>
        <label>
          Director email
          <input
            type="email"
            name="director_email"
            defaultValue={school?.director_email ?? ""}
          />
        </label>
        <label>
          Director phone
          <input
            type="tel"
            name="director_phone"
            defaultValue={school?.director_phone ?? ""}
          />
        </label>
      </div>
      <div className="row-inline">
        <label>
          Performers
          <input
            type="number"
            name="performer_count"
            className="num"
            defaultValue={school?.performer_count ?? ""}
          />
        </label>
        <label>
          Homeroom
          <input
            type="text"
            name="homeroom"
            placeholder="Rm 214"
            defaultValue={school?.homeroom ?? ""}
          />
        </label>
        <label>
          Costume colors
          <input
            type="text"
            name="costume_colors"
            placeholder="Navy & gold"
            defaultValue={school?.costume_colors ?? ""}
          />
        </label>
      </div>
      <label>
        Arrival notes
        <textarea
          name="arrival_notes"
          rows={2}
          defaultValue={school?.arrival_notes ?? ""}
        />
      </label>
    </>
  );
}
