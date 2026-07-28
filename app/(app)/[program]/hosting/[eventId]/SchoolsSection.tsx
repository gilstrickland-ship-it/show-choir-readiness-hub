import type { PageFlash } from "@/lib/flash";
import { Flash } from "../../Flash";
import type { HostSection } from "./shared";
import { NO_HEALTH_LABEL, type HostedSchoolRow } from "@/lib/hosting";
import { addHostedSchool } from "../actions";
import { SchoolCard, SchoolFields } from "./SchoolCard";

// Visiting schools (spec 005 US11). The list is the point of the section: the
// host walks the building with this on a phone, and "which room is Central in,
// and who do I call" has to be answerable without opening anything. Each card
// carries its own facts (SchoolCard.tsx); only ADDING a school is a disclosure,
// and its summary says what it holds and how many are invited so far.
//
// The rooms-in-use line beside the heading is this section's live state, and it
// is also where a doubled homeroom shows up — the same count feeds the "shared"
// chip on the two cards involved. A shared room is legal, sometimes deliberate,
// so it warns and never blocks.

export function SchoolsSection({
  programId,
  slug,
  eventId,
  eventBase,
  schools,
  canWrite,
  open,
  confirmRemoveId,
  flash,
}: {
  programId: string;
  slug: string;
  eventId: string;
  eventBase: string;
  schools: HostedSchoolRow[];
  canWrite: boolean;
  // `?open=` addresses one card by id, or the add form by the word "school".
  open: string | null;
  confirmRemoveId: string | null;
  flash: PageFlash<HostSection>;
}) {
  // Rooms-in-use + duplicate-homeroom detection (warn, never block): two schools
  // sharing a room is legal — sometimes deliberate — so it is a chip, not a block.
  const homeroomCount = new Map<string, number>();
  for (const s of schools) {
    const hr = (s.homeroom ?? "").trim();
    if (hr) homeroomCount.set(hr, (homeroomCount.get(hr) ?? 0) + 1);
  }
  const roomsInUse = [...homeroomCount.keys()].sort((a, b) => a.localeCompare(b));
  const dupHomerooms = new Set(
    [...homeroomCount.entries()].filter(([, n]) => n > 1).map(([hr]) => hr),
  );

  const countText = `${schools.length} school${schools.length === 1 ? "" : "s"}`;
  const summary = `${countText} · ${
    roomsInUse.length > 0
      ? `rooms ${roomsInUse.join(", ")}`
      : "no homerooms assigned yet"
  }`;

  return (
    <section className="comp-section" id="schools">
      <div className="comp-section-head">
        <h2>Visiting schools</h2>
        <span className="comp-section-summary">{summary}</span>
      </div>
      <Flash flash={flash} section="schools" />
      <p className="muted">
        Adult director contact and a performer count only — never
        visiting-school student data. {NO_HEALTH_LABEL}
      </p>

      {schools.length === 0 ? (
        <p className="muted">
          No visiting schools yet.{" "}
          {canWrite
            ? "Add the first one below — the schedule generates from this list."
            : "The schedule generates from this list once schools are added."}
        </p>
      ) : (
        <div className="stack">
          {schools.map((s) => (
            <SchoolCard
              key={s.id}
              programId={programId}
              slug={slug}
              eventId={eventId}
              eventBase={eventBase}
              school={s}
              sharedRoom={
                !!s.homeroom && dupHomerooms.has(s.homeroom.trim())
              }
              canWrite={canWrite}
              open={open === s.id || confirmRemoveId === s.id}
              confirmRemove={confirmRemoveId === s.id}
            />
          ))}
        </div>
      )}

      {canWrite && (
        <details className="stack" open={open === "school" || schools.length === 0}>
          <summary className="comp-disclosure">
            Add a visiting school —{" "}
            {schools.length === 0 ? "none invited yet" : `${countText} so far`}
          </summary>
          <form action={addHostedSchool} className="stack hosting-panel">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={eventId} />
            <SchoolFields school={null} />
            <button type="submit">Add school</button>
          </form>
        </details>
      )}
    </section>
  );
}
