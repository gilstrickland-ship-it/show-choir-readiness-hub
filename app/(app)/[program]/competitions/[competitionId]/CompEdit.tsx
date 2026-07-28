import Link from "next/link";
import {
  COMPETITION_STATUSES,
  COMPETITION_STATUS_LABELS,
  type CompetitionStatus,
} from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { updateCompetition, reseedAttendance } from "../actions";

// The comp hub's Details section (spec 005 US7-1). Everything here has no child
// route to own it — the competition's own facts and who is going — so it stays
// on the hub, in the same disclosure idiom the Season spine and the trip page
// use: the summary NAMES what is inside and shows the current state, so nothing
// mutating hides behind a bare triangle.
//
// The form posts the whole record on purpose (it shows the whole record), which
// is why an emptied field still clears. Ensembles ride along: adding one seeds
// its members, removing one bounces to the confirmation the page renders above.

export interface CompFacts {
  id: string;
  name: string;
  host_school: string | null;
  venue_address: string | null;
  date: string | null;
  showchoir_com_url: string | null;
  status: CompetitionStatus;
}

export function CompEdit({
  programId,
  slug,
  comp,
  ensembles,
  participatingIds,
  ensemblesHref,
  canWrite,
  hasEnsembles,
  tz,
  summary,
  open,
  error,
}: {
  programId: string;
  slug: string;
  comp: CompFacts;
  ensembles: { id: string; name: string }[];
  participatingIds: string[];
  ensemblesHref: string;
  canWrite: boolean;
  hasEnsembles: boolean;
  tz: string;
  summary: string;
  open: boolean;
  error: string | null;
}) {
  return (
    <section className="comp-section comp-details" id="details">
      <div className="comp-section-head">
        <h2>Details</h2>
        <span className="comp-section-summary">{summary}</span>
      </div>
      {error && <p className="alert-error">{error}</p>}

      {canWrite && ensembles.length === 0 ? (
        <p className="muted">
          A competition attaches to an ensemble so it can seed attendance, meals,
          and checkout.{" "}
          <Link href={ensemblesHref}>Create an ensemble first</Link>, then set it
          here.
        </p>
      ) : canWrite ? (
        <details className="stack" open={open}>
          <summary className="comp-disclosure">Edit details — {summary}</summary>
          <form
            action={updateCompetition}
            className="stack"
            style={{ gap: "0.5rem", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={comp.id} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" defaultValue={comp.name} required />
              </label>
              <label>
                Date
                <input type="date" name="date" defaultValue={comp.date ?? ""} />
              </label>
              <label>
                Status
                <select name="status" defaultValue={comp.status}>
                  {COMPETITION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {COMPETITION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="stack">
              <legend>Who is going</legend>
              <div className="row-inline" style={{ flexWrap: "wrap" }}>
                {ensembles.map((e) => (
                  <label key={e.id} className="row-inline">
                    <input
                      type="checkbox"
                      name="ensemble_ids"
                      value={e.id}
                      defaultChecked={participatingIds.includes(e.id)}
                    />
                    {e.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row-inline">
              <label>
                Host school
                <input
                  type="text"
                  name="host_school"
                  defaultValue={comp.host_school ?? ""}
                />
              </label>
              <label>
                Venue address
                <input
                  type="text"
                  name="venue_address"
                  defaultValue={comp.venue_address ?? ""}
                />
              </label>
              <label>
                showchoir.com link
                <input
                  type="url"
                  name="showchoir_com_url"
                  defaultValue={comp.showchoir_com_url ?? ""}
                />
              </label>
            </div>
            <p className="muted">
              Adding an ensemble puts its members on the attendance list. Taking
              one off asks first, then drops attendance and comp-scoped costume
              checkouts only for students who are in no remaining ensemble.
            </p>
            <button type="submit">Save details</button>
          </form>
        </details>
      ) : (
        <dl className="detail-list">
          <dt>Date</dt>
          <dd>
            {comp.date ? formatDateInTz(`${comp.date}T12:00:00Z`, tz) : "—"}
          </dd>
          <dt>Host</dt>
          <dd>{comp.host_school ?? "—"}</dd>
          <dt>Venue</dt>
          <dd>{comp.venue_address ?? "—"}</dd>
          <dt>Status</dt>
          <dd>{COMPETITION_STATUS_LABELS[comp.status]}</dd>
        </dl>
      )}

      {/* Roster drift is the reason this button exists: a student who joined the
          ensemble after the competition was created has no attendance row yet.
          Adding them is idempotent — nobody's status is overwritten — so the
          label says what it does instead of naming the mechanism. */}
      {canWrite && hasEnsembles && (
        <form action={reseedAttendance} className="row-inline">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={comp.id} />
          <button type="submit" className="secondary">
            Add missing students to attendance
          </button>
          <span className="muted">
            New ensemble members get a row; statuses already set stay put.
          </span>
        </form>
      )}
    </section>
  );
}
