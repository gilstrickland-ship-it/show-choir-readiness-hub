import Link from "next/link";
import {
  COMPETITION_STATUSES,
  COMPETITION_STATUS_LABELS,
} from "@/lib/competitions";
import { updateCompetition } from "../competitions/actions";
import { updateEvent } from "../events/actions";
import { updateTrip } from "../travel/actions";

// Row edit (spec 005 US2) — a small popover on the spine row itself for the
// correction this domain makes constantly: a name or a date that moved. Same
// native <details> as the quick-add drawer, no client JS, and no per-row query:
// everything the form needs was already loaded for the spine. Deeper work (who's
// going, the itinerary, rooms and buses) stays on the record's own page, one
// link away. A read-only role never gets here — the payloads below are only
// built for writers.
//
// Each form posts ONLY the fields it edits, plus `sparse=1`. The update actions
// read that as "leave everything else alone", which is what lets a date fix be a
// date fix: it can't clear a note nobody touched, can't unlink a trip from its
// competition, and can't read a silence about ensembles as a removal.

// Row-edit payloads. Every field here comes out of the query the spine already
// runs, and the set is exactly what the popover shows — nothing rides along.
export interface CompEdit {
  id: string;
  name: string;
  date: string;
  status: "planned" | "confirmed" | "done";
}
export interface EventEdit {
  id: string;
  title: string;
  startsWall: string; // program-tz wall clock, the datetime-local shape
  location: string;
}
export interface TripEdit {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isOvernight: boolean;
}

// What RowEdit needs off a spine row (the page's SeasonItem extends this).
export interface RowEditTarget {
  key: string;
  title: string;
  compEdit?: CompEdit;
  eventEdit?: EventEdit;
  tripEdit?: TripEdit;
}

type EditKind = "comp" | "event" | "trip";

// Row-edit errors, in the same words the record's own page uses. `?edit=<key>`
// reopens that row's popover with the message inside it.
const EDIT_ERROR: Record<EditKind, Record<string, string>> = {
  comp: {
    name: "A competition needs a name.",
    ensemble: "Pick at least one ensemble for the competition.",
    save: "Couldn't save. Try again.",
  },
  event: {
    title: "An event needs a title.",
    dates: "The end time is before the start.",
    save: "Couldn't save. Try again.",
  },
  trip: {
    name: "A trip needs a name.",
    dates: "A trip can't end before it starts.",
    overnight_rooms: "Remove this trip's rooms before making it a day trip.",
    save: "Couldn't save the trip. Try again.",
  },
};

// The code rides in the URL, so the lookup has to be a lookup and not a walk up
// Object.prototype — ?error=constructor would otherwise hand React a function to
// render. Anything unrecognized falls back to the generic save message.
function editMessage(kind: EditKind, code: string): string {
  const map = EDIT_ERROR[kind];
  return Object.hasOwn(map, code) ? map[code] : map.save;
}

export function RowEdit({
  item,
  variant,
  slug,
  base,
  programId,
  tz,
  openKey,
  error,
}: {
  item: RowEditTarget;
  variant: "row" | "feature";
  slug: string;
  base: string;
  programId: string;
  tz: string;
  openKey: string | null;
  error: string | null;
}) {
  const kind: EditKind | null = item.compEdit
    ? "comp"
    : item.eventEdit
      ? "event"
      : item.tripEdit
        ? "trip"
        : null;
  if (!kind) return null;

  const isOpen = openKey === item.key;
  const message = isOpen && error ? editMessage(kind, error) : null;
  // The row popover hangs off the spine's right edge; the feature row's action
  // bar sits at the left, so its panel opens the other way (both stay put on a
  // phone, where the page-head drawer flips).
  const panelClass =
    variant === "feature" ? "season-feature-edit-panel" : "season-edit-panel";

  return (
    <details className="drawer" open={isOpen}>
      {/* Every row on the spine has an "Edit" — the accessible name says which
          one, the way the travel page's tap/remove controls do. */}
      <summary className="season-link" aria-label={`Edit ${item.title}`}>
        Edit
      </summary>
      <div className={`drawer-panel ${panelClass}`}>
        <h3 className="drawer-title">Quick edit</h3>
        {message && <p className="alert-error">{message}</p>}

        {item.compEdit && (
          <form action={updateCompetition} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={item.compEdit.id} />
            <input type="hidden" name="from" value="season" />
            <input type="hidden" name="sparse" value="1" />
            <label>
              Name
              <input
                type="text"
                name="name"
                defaultValue={item.compEdit.name}
                required
              />
            </label>
            <div className="row-inline">
              <label>
                Date
                <input
                  type="date"
                  name="date"
                  defaultValue={item.compEdit.date}
                />
              </label>
              <label>
                Status
                <select name="status" defaultValue={item.compEdit.status}>
                  {COMPETITION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {COMPETITION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit">Save</button>
            <p className="muted">
              <Link href={`${base}/competitions/${item.compEdit.id}`}>
                All details →
              </Link>
            </p>
          </form>
        )}

        {item.eventEdit && (
          <form action={updateEvent} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={item.eventEdit.id} />
            <input type="hidden" name="tz" value={tz} />
            <input type="hidden" name="from" value="season" />
            <input type="hidden" name="sparse" value="1" />
            <label>
              Title
              <input
                type="text"
                name="title"
                defaultValue={item.eventEdit.title}
                required
              />
            </label>
            <div className="row-inline">
              <label>
                Starts
                <input
                  type="datetime-local"
                  name="starts_at"
                  defaultValue={item.eventEdit.startsWall}
                />
              </label>
              <label>
                Location
                <input
                  type="text"
                  name="location"
                  defaultValue={item.eventEdit.location}
                />
              </label>
            </div>
            <button type="submit">Save</button>
            <p className="muted">
              Move the start and the end moves with it. Who it&apos;s for, a
              different end time, a note:{" "}
              <Link href={`${base}/events/${item.eventEdit.id}`}>
                All details →
              </Link>
            </p>
          </form>
        )}

        {item.tripEdit && (
          <form action={updateTrip} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="tripId" value={item.tripEdit.id} />
            <input type="hidden" name="from" value="season" />
            <input type="hidden" name="sparse" value="1" />
            <label>
              Name
              <input
                type="text"
                name="name"
                defaultValue={item.tripEdit.name}
                required
              />
            </label>
            <div className="row-inline">
              <label>
                Starts
                <input
                  type="date"
                  name="starts_on"
                  defaultValue={item.tripEdit.startsOn}
                />
              </label>
              <label>
                Ends
                <input
                  type="date"
                  name="ends_on"
                  defaultValue={item.tripEdit.endsOn}
                />
              </label>
            </div>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                name="is_overnight"
                defaultChecked={item.tripEdit.isOvernight}
              />{" "}
              Overnight (rooms + buses)
            </label>
            <button type="submit">Save</button>
            <p className="muted">
              <Link href={`${base}/travel/${item.tripEdit.id}`}>
                All details →
              </Link>
            </p>
          </form>
        )}
      </div>
    </details>
  );
}
