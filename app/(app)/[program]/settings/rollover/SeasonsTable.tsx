import type { PageFlash } from "@/lib/flash";
import { formatDateInTz, formatDateTimeInTz } from "@/lib/datetime";
import { ArchivedBanner } from "../../ArchivedBanner";
import { Flash } from "../../Flash";
import { archiveSeason, unarchiveSeason } from "../actions";
import { ROLLOVER_ANCHOR, type RolloverSection } from "./shared";

// Every season this program has had, and the one lifecycle switch on each
// (§9.4, invariant 4; spec 005 Wave 13 / T165).
//
// Archiving freezes a season read-only — RLS is what enforces it, not this page
// — and it is the only thing here that is not just a label. So the copy says
// what freezing costs and what it does not: a season keeps everything it had,
// and a director can thaw it. The action sits in `.table-action` so it is pinned
// to the right edge of the scroll port on a phone (T143b) instead of starting
// several hundred pixels into a table nobody has scrolled.

export interface SeasonRow {
  id: string;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  archived_at: string | null;
}

export function SeasonsTable({
  programId,
  slug,
  tz,
  flash,
  seasons,
  isDirector,
}: {
  programId: string;
  slug: string;
  tz: string;
  flash: PageFlash<RolloverSection>;
  seasons: SeasonRow[];
  isDirector: boolean;
}) {
  const archived = seasons.filter((s) => s.archived_at).length;
  const summary =
    seasons.length === 0
      ? "None yet"
      : `${seasons.length} season${seasons.length === 1 ? "" : "s"}${
          archived > 0 ? ` · ${archived} archived` : ""
        }`;

  // A plain date column ("2026-08-01") carries no instant, so it is read at
  // midday UTC before being rendered on the program's calendar — the same
  // convention the rest of the app uses for date-only columns.
  const day = (d: string | null): string =>
    d ? formatDateInTz(`${d}T12:00:00Z`, tz) : "—";

  return (
    <section id={ROLLOVER_ANCHOR.seasons} className="panel stack">
      <div className="travel-section-head">
        <h2>All seasons</h2>
        <span className="travel-section-summary">{summary}</span>
      </div>
      <Flash flash={flash} section="seasons" />
      <p className="muted">
        Archiving a season freezes it: its roster, results and PDFs stay
        browsable in History and in your export, but nothing in it can be changed
        again. Only the director can thaw one.
      </p>
      {archived > 0 && <ArchivedBanner />}
      <table className="members">
        <thead>
          <tr>
            <th>Season</th>
            <th>Dates</th>
            <th>Status</th>
            <th className="table-action">
              <span className="muted">Freeze</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td className="muted">
                {day(s.starts_on)} → {day(s.ends_on)}
              </td>
              <td>
                {s.is_active && <span className="badge">Active</span>}
                {s.archived_at ? (
                  <span
                    className="chip"
                    title={formatDateTimeInTz(s.archived_at, tz)}
                  >
                    Archived (read-only)
                  </span>
                ) : (
                  !s.is_active && <span className="muted">Inactive</span>
                )}
              </td>
              <td className="table-action">
                {s.archived_at ? (
                  isDirector ? (
                    <form action={unarchiveSeason}>
                      <input type="hidden" name="programId" value={programId} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="seasonId" value={s.id} />
                      <button
                        type="submit"
                        className="linklike"
                        aria-label={`Unarchive ${s.label}`}
                      >
                        Unarchive
                      </button>
                    </form>
                  ) : (
                    <span className="muted">Director only</span>
                  )
                ) : s.is_active ? (
                  <span className="muted">Switch seasons first</span>
                ) : (
                  <form action={archiveSeason}>
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="seasonId" value={s.id} />
                    <button
                      type="submit"
                      className="linklike danger"
                      aria-label={`Archive ${s.label}`}
                    >
                      Archive
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {seasons.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No seasons yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
