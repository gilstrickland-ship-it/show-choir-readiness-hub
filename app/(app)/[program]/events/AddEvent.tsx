import Link from "next/link";
import { createEvent } from "./actions";
import { EVENT_KINDS, EVENT_KIND_LABELS } from "@/lib/events";
import { Flash } from "../Flash";
import type { PageFlash } from "@/lib/flash";
import type { EventsSection } from "./shared";

// The full event form (spec 005 Wave 11 / T159). It is the "More options →"
// target of the Season drawer's Add · Event section, and it says so — the quick
// way to put something on the calendar is one "+ Add" on Season (US1, P6), and
// this is where the fields that did not earn a place in a two-field drawer
// live: where it is, when it ends, a note, and who it is for.
//
// It sits in a labeled disclosure because it is a MUTATION, and on this page
// mutations sit in disclosures while the read surface — the calendar — is what
// you see (the Wave-7 rule). `?add=event` springs it open, which is both the
// link the drawer sends you on and the URL a refused save comes back on, so
// arriving to add and returning from a refusal are the same path.

export function AddEvent({
  programId,
  slug,
  seasonId,
  tz,
  ensembles,
  open,
  flash,
}: {
  programId: string;
  slug: string;
  seasonId: string;
  tz: string;
  ensembles: { id: string; name: string }[];
  open: boolean;
  flash: PageFlash<EventsSection>;
}) {
  return (
    <details className="stack" id="add" open={open}>
      <summary className="comp-disclosure">
        Add an event — all the details
      </summary>
      {/* What happened, at the top of the panel the redirect scrolls to: the
          calendar is directly above, so a reader lands on the message with the
          new events already in view. */}
      <Flash flash={flash} section="add" />
      <p className="muted">
        Quicker: the <Link href={`/${slug}/season?add=event`}>+ Add</Link> on
        Season takes a title and a time. This form takes the rest.
      </p>
      <form action={createEvent} className="stack">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="seasonId" value={seasonId} />
        <input type="hidden" name="tz" value={tz} />
        <div className="row-inline">
          <label>
            Title
            <input type="text" name="title" required />
          </label>
          <label>
            Kind
            <select name="kind" defaultValue="rehearsal">
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
            {/* Required, and required again server-side: an event with no start
                shows up on neither the calendar above nor the season spine, so
                one added without a time is one nobody can find again. */}
            Starts
            <input type="datetime-local" name="starts_at" required />
          </label>
          <label>
            Ends
            <input type="datetime-local" name="ends_at" />
          </label>
          <label>
            Where
            <input type="text" name="location" />
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
                <input type="checkbox" name="ensemble_ids" value={e.id} />
                {e.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Note
          <input type="text" name="note" />
        </label>
        <label>
          Repeat weekly for this many weeks
          <input
            type="number"
            name="repeat_count"
            className="num"
            min="1"
            max="52"
            defaultValue="1"
          />
        </label>
        <p className="muted">
          Each week becomes its own event you can change or delete on its own.
        </p>
        <button type="submit">Add event</button>
      </form>
    </details>
  );
}
