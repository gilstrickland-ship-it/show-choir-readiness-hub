import Link from "next/link";
import { EVENT_KINDS, EVENT_KIND_LABELS } from "@/lib/events";
import { formatDateInTz } from "@/lib/datetime";
import { createCompetition } from "../competitions/actions";
import { createEvent } from "../events/actions";
import { createTrip } from "../travel/actions";

// Quick add (spec 005 US1) — one "+ Add" drawer holding a minimal form per kind.
// Native <details> only: the outer drawer is the roster-page popover, the inner
// sections share a `name` so opening one closes the others. No client JS, no
// state — `?add=<kind>` opens a section, and a failed create comes back on that
// same URL with its error code. Anything beyond the true minimum lives behind
// each section's "More options →" (the module page's full form).

// The drawer's sections. `?add=<kind>` opens the drawer on one — which is also
// how a failed create comes back (the action redirects here with its existing
// ?error= code plus the section key, the roster-drawer pattern).
export const ADD_KINDS = ["comp", "event", "trip"] as const;
export type AddKind = (typeof ADD_KINDS)[number];

// The create actions' error codes, reworded not at all: these are the same
// messages the module pages show, rendered inside the section that produced them.
const ADD_ERROR: Record<AddKind, Record<string, string>> = {
  comp: {
    name: "A competition needs a name.",
    ensemble: "Pick at least one ensemble for the competition.",
    season: "Activate a season before adding competitions.",
    save: "Couldn't save. Try again.",
  },
  event: {
    title: "An event needs a title.",
    starts: "An event needs a start date and time.",
    dates: "The end time is before the start.",
    season: "Activate a season before adding events.",
    save: "Couldn't save. Try again.",
  },
  trip: {
    name: "A trip needs a name.",
    season: "Activate a season before adding trips.",
    save: "Couldn't save. Try again.",
  },
};

const ADD_KIND_LABEL: Record<AddKind, string> = {
  comp: "Competition",
  event: "Event",
  trip: "Trip",
};

// The code rides in the URL, so the lookup has to be a lookup and not a walk up
// Object.prototype — ?error=constructor would otherwise hand React a function to
// render. Anything unrecognized falls back to the generic save message.
function addMessage(kind: AddKind, code: string): string {
  const map = ADD_ERROR[kind];
  return Object.hasOwn(map, code) ? map[code] : map.save;
}

export function QuickAdd({
  slug,
  base,
  programId,
  seasonId,
  tz,
  ensembles,
  compsWithoutTrip,
  canAddComp,
  canAddEvent,
  canAddTrip,
  openKind,
  error,
}: {
  slug: string;
  base: string;
  programId: string;
  seasonId: string | null;
  tz: string;
  ensembles: { id: string; name: string }[];
  // Dated competitions with no trip yet — see the trip section below for why
  // undated ones are not offered here.
  compsWithoutTrip: { id: string; name: string; date: string }[];
  canAddComp: boolean;
  canAddEvent: boolean;
  canAddTrip: boolean;
  openKind: AddKind | null;
  error: string | null;
}) {
  // The section that produced the error is the one that reopens with it.
  const errorFor = (kind: AddKind): string | null =>
    openKind === kind && error ? addMessage(kind, error) : null;

  return (
    <details className="drawer" open={openKind !== null}>
      <summary className="button-link accent">+ Add</summary>
      <div className="drawer-panel">
        <h2 className="drawer-title">Add to the season</h2>
        {!seasonId ? (
          <p className="muted">
            Start your season first — competitions, events, and trips all belong
            to a season.
          </p>
        ) : (
          <div className="quick-add-kinds">
            {canAddComp && (
              <details
                name="season-add-kind"
                className="quick-add-kind"
                open={openKind === "comp"}
              >
                <summary>{ADD_KIND_LABEL.comp}</summary>
                {errorFor("comp") && (
                  <p className="alert-error">{errorFor("comp")}</p>
                )}
                {ensembles.length === 0 ? (
                  <p className="muted">
                    Competitions need at least one ensemble (a performing group).{" "}
                    <Link href={`${base}/roster/ensembles`}>
                      Create one first →
                    </Link>
                  </p>
                ) : (
                  <form action={createCompetition} className="stack">
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="seasonId" value={seasonId} />
                    <input type="hidden" name="from" value="season" />
                    {/* Everything new starts Planned; change it on the row or
                        the comp page once the host confirms. */}
                    <input type="hidden" name="status" value="planned" />
                    <div className="row-inline">
                      <label>
                        Name
                        <input
                          type="text"
                          name="name"
                          required
                          placeholder="Midwest Invitational"
                        />
                      </label>
                      <label>
                        Date
                        <input type="date" name="date" />
                      </label>
                    </div>
                    {/* One ensemble is not a choice — it rides along hidden.
                        More than one and they all come pre-ticked (§004). */}
                    {ensembles.length === 1 ? (
                      <input
                        type="hidden"
                        name="ensemble_ids"
                        value={ensembles[0].id}
                      />
                    ) : (
                      <fieldset className="stack">
                        <legend>Who is going</legend>
                        <div className="row-inline" style={{ flexWrap: "wrap" }}>
                          {ensembles.map((e) => (
                            <label key={e.id} className="checkbox-inline">
                              <input
                                type="checkbox"
                                name="ensemble_ids"
                                value={e.id}
                                defaultChecked
                              />
                              {e.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <button type="submit">Add competition</button>
                    <p className="muted">
                      Host school, venue, and the rest:{" "}
                      <Link href={`${base}/competitions#add`}>More options →</Link>
                    </p>
                  </form>
                )}
              </details>
            )}

            {canAddEvent && (
              <details
                name="season-add-kind"
                className="quick-add-kind"
                open={openKind === "event"}
              >
                <summary>{ADD_KIND_LABEL.event}</summary>
                {errorFor("event") && (
                  <p className="alert-error">{errorFor("event")}</p>
                )}
                <form action={createEvent} className="stack">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="seasonId" value={seasonId} />
                  <input type="hidden" name="tz" value={tz} />
                  <input type="hidden" name="from" value="season" />
                  <div className="row-inline">
                    <label>
                      Title
                      <input type="text" name="title" required />
                    </label>
                    <label>
                      {/* Required, and required again server-side: the spine is
                          chronological, so an event with no start would be
                          created and then be nowhere the director just looked. */}
                      Starts
                      <input type="datetime-local" name="starts_at" required />
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
                  {/* Both of these are the exception, not the rule, so they stay
                      folded away until someone needs them. */}
                  {ensembles.length > 1 && (
                    <details className="stack">
                      <summary className="muted">Only some groups?</summary>
                      <div className="row-inline" style={{ flexWrap: "wrap" }}>
                        {ensembles.map((e) => (
                          <label key={e.id} className="checkbox-inline">
                            <input
                              type="checkbox"
                              name="ensemble_ids"
                              value={e.id}
                            />
                            {e.name}
                          </label>
                        ))}
                      </div>
                      <p className="muted">
                        Leave every box unticked and the whole program is invited.
                      </p>
                    </details>
                  )}
                  <details className="stack">
                    <summary className="muted">Repeats weekly?</summary>
                    <label>
                      How many weeks
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
                      Each week becomes its own event you can change or delete on
                      its own.
                    </p>
                  </details>
                  <button type="submit">Add event</button>
                  <p className="muted">
                    Where it is, an end time, a note:{" "}
                    <Link href={`${base}/events#add`}>More options →</Link>
                  </p>
                </form>
              </details>
            )}

            {canAddTrip && (
              <details
                name="season-add-kind"
                className="quick-add-kind"
                open={openKind === "trip"}
              >
                <summary>{ADD_KIND_LABEL.trip}</summary>
                {errorFor("trip") && (
                  <p className="alert-error">{errorFor("trip")}</p>
                )}
                {compsWithoutTrip.length > 0 ? (
                  <>
                    {/* The common case by far: a bus (and rooms) for a
                        competition already on the calendar. Name and dates come
                        from that competition, server-side — which is also why
                        only DATED competitions are offered: a trip that inherits
                        no dates lands nowhere on the spine, behind a success
                        message saying it was added. */}
                    <form action={createTrip} className="stack">
                      <input type="hidden" name="programId" value={programId} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="seasonId" value={seasonId} />
                      <input type="hidden" name="from" value="season" />
                      <label>
                        For a competition
                        <select name="competition_id">
                          {compsWithoutTrip.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ·{" "}
                              {formatDateInTz(`${c.date}T12:00:00Z`, tz)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-inline">
                        <input type="checkbox" name="is_overnight" /> Overnight
                        (rooms + buses)
                      </label>
                      <button type="submit">Add trip</button>
                      <p className="muted">
                        The trip takes its name and date from the competition.
                      </p>
                    </form>
                    <details className="stack">
                      <summary className="muted">Not for a competition?</summary>
                      <StandaloneTripForm
                        slug={slug}
                        programId={programId}
                        seasonId={seasonId}
                      />
                    </details>
                  </>
                ) : (
                  <StandaloneTripForm
                    slug={slug}
                    programId={programId}
                    seasonId={seasonId}
                  />
                )}
                <p className="muted">
                  Rooms, buses, and chaperones:{" "}
                  <Link href={`${base}/travel#add`}>More options →</Link>
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// A trip that isn't tied to a competition (banquet, tour) — the alternative path
// inside the trip section, and the only one when every dated competition already
// has a trip.
function StandaloneTripForm({
  slug,
  programId,
  seasonId,
}: {
  slug: string;
  programId: string;
  seasonId: string;
}) {
  return (
    <form action={createTrip} className="stack">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="from" value="season" />
      <div className="row-inline">
        <label>
          Name
          <input type="text" name="name" required placeholder="Spring Trip" />
        </label>
        <label>
          Starts
          <input type="date" name="starts_on" />
        </label>
        <label>
          Ends
          <input type="date" name="ends_on" />
        </label>
      </div>
      <label className="checkbox-inline">
        <input type="checkbox" name="is_overnight" /> Overnight (rooms + buses)
      </label>
      <button type="submit">Add trip</button>
    </form>
  );
}
