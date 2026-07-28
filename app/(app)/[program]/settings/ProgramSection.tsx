import { formatTimeZoneLabel, TIMEZONES } from "@/lib/datetime";
import type { PageFlash } from "@/lib/flash";
import { Flash } from "../Flash";
import { updateProgram } from "./actions";
import { SETTINGS_ANCHOR, type SettingsSection } from "./shared";

// Settings § Program (spec 005 Wave 13 / T164) — who this program is.
//
// It used to be the page's opening act: five permanently-open inputs and a Save,
// with three unrelated admin concerns stacked underneath and no heading between
// any of them. The facts are stated now, and the inputs live behind one
// disclosure whose label says what it holds and what it currently says — so the
// answer to "what time zone are we in?" is readable without opening anything.
//
// The zone list is lib/datetime's — the same one /launch offers (Constitution
// VII: every itinerary and event time renders in this zone, so it is a
// first-class field). A program already set to a zone outside the list keeps it:
// the current value is prepended rather than silently re-homing the calendar.

export function ProgramSection({
  slug,
  flash,
  program,
}: {
  slug: string;
  flash: PageFlash<SettingsSection>;
  program: {
    id: string;
    name: string;
    school_name: string | null;
    city: string | null;
    state: string | null;
    timezone: string;
  };
}) {
  const place = [program.city, program.state].filter(Boolean).join(", ");
  const facts = [
    program.school_name,
    place || null,
    formatTimeZoneLabel(program.timezone),
  ].filter(Boolean) as string[];
  const zones = TIMEZONES.includes(program.timezone)
    ? TIMEZONES
    : [program.timezone, ...TIMEZONES];

  return (
    <section id={SETTINGS_ANCHOR.program} className="panel stack">
      <div className="travel-section-head">
        <h2>Program</h2>
        <span className="travel-section-summary">{facts.join(" · ")}</span>
      </div>
      <Flash flash={flash} section="program" />
      <p className="muted">
        The name on every page and PDF, and the time zone every rehearsal, call
        time and bus departure is written in.
      </p>

      <details className="stack">
        <summary className="people-disclosure">
          Change these details — {program.name}
        </summary>
        <form action={updateProgram} className="stack settings-form">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />

          <label>
            Program name
            <input type="text" name="name" defaultValue={program.name} required />
          </label>

          <label>
            Time zone
            <select name="timezone" defaultValue={program.timezone} required>
              {zones.map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimeZoneLabel(tz)}
                </option>
              ))}
            </select>
          </label>

          <label>
            School name
            <input
              type="text"
              name="school_name"
              defaultValue={program.school_name ?? ""}
            />
          </label>

          <div className="row-inline">
            <label>
              City
              <input type="text" name="city" defaultValue={program.city ?? ""} />
            </label>
            <label>
              State
              <input type="text" name="state" defaultValue={program.state ?? ""} />
            </label>
          </div>

          <button type="submit">Save program details</button>
        </form>
      </details>
    </section>
  );
}
