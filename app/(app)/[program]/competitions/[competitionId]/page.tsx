import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  COMPETITION_WRITE_ROLES,
  COMPETITION_STATUS_LABELS,
  competitionEnsembleIds,
  competitionRoster,
  type CompetitionStatus,
} from "@/lib/competitions";
import { loadCompReadiness } from "@/lib/readiness";
import { formatDateInTz, formatTimeInTz, zonedWallToUtc } from "@/lib/datetime";
import { updateCompetition } from "../actions";
import { buildGlanceCards, GlanceCards } from "./GlanceCards";
import { CompEdit } from "./CompEdit";
import { ResultsForm, type ResultsRow } from "./ResultsForm";

// Competition hub — comp week on one page (spec 005 US7). A HUB, not a copy of
// its spokes: the header says which competition and when, the readiness rail
// says what still needs doing, and one glance card per area says where that job
// stands and opens the route that owns it (attendance/, itinerary/, meals/,
// packet/, comms/shifts, travel/).
//
// What used to live here — an attendance toggle grid, an itinerary list, a meal
// breakdown, a packet row — was a second, thinner implementation of four child
// routes that never went away. It's gone. What stays is what no child route
// owns: the competition's own details, who is going, and results.
//
// Reads only. Every status line comes from the readiness pass the rail runs
// anyway plus two small rows (linked trip, results), so this page costs LESS
// than it did with the inline sections: the itinerary, attendance-roster,
// shifts, meal-breakdown and packet-document queries are all gone.

export const dynamic = "force-dynamic";

// Whole days from `now` to `target` (future). Past clamps to 0.
function countdownDays(target: Date, now: Date): number {
  const ms = target.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

const STATUS_PILL: Record<CompetitionStatus, string> = {
  planned: "planned",
  confirmed: "confirmed",
  done: "done",
};

// ---- Section-local errors (the Wave-2 trip-page contract) -------------------
// A failed action comes back on `?error=`, and the message renders inside the
// section that owns what failed, which is also the section that reopens. The
// code rides in the URL, so the lookup is a lookup and not a walk up
// Object.prototype (?error=constructor would otherwise hand React a function).
type CompSlot = "details" | "results";

const COMP_ERROR: Record<string, { slot: CompSlot; message: string }> = {
  name: { slot: "details", message: "A competition needs a name." },
  ensemble: {
    slot: "details",
    message: "Pick at least one ensemble for the competition.",
  },
  save: { slot: "details", message: "Couldn't save. Try again." },
  results: { slot: "results", message: "Couldn't save those results." },
};

function compError(
  code: string | null,
): { slot: CompSlot; message: string } | null {
  if (!code || !Object.hasOwn(COMP_ERROR, code)) return null;
  return COMP_ERROR[code];
}

interface CompDetail {
  id: string;
  season_id: string;
  name: string;
  host_school: string | null;
  venue_address: string | null;
  date: string | null;
  showchoir_com_url: string | null;
  status: CompetitionStatus;
}

export default async function CompetitionHub({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  // Next hands back an ARRAY for a duplicated param (?error=a&error=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role, flags } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const now = new Date();
  const base = `/${slug}`;
  const compBase = `${base}/competitions/${competitionId}`;

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select(
      "id, season_id, name, host_school, venue_address, date, showchoir_com_url, status",
    )
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compData as CompDetail | null;
  if (!comp) notFound();

  // Participating ensembles (junction, Feature 004). ≥1 for a well-formed comp;
  // an empty set only appears mid-edit and is treated as "not seeded yet".
  const participatingEnsembleIds = await competitionEnsembleIds(
    supabase,
    competitionId,
  );
  const hasEnsembles = participatingEnsembleIds.length > 0;

  // ---- Readiness: the rail AND every glance card's status line --------------
  const readiness = await loadCompReadiness(supabase, {
    programId: program.id,
    comp: {
      id: comp.id,
      name: comp.name,
      date: comp.date,
      host_school: comp.host_school,
    },
    flags,
    role,
    base,
  });

  // Countdown target: earliest itinerary time, else the comp date at midnight tz.
  let daysOut: number | null = null;
  const target = readiness.firstStart
    ? new Date(readiness.firstStart)
    : comp.date
      ? zonedWallToUtc(`${comp.date}T00:00`, tz)
      : null;
  if (target && !Number.isNaN(target.getTime())) {
    daysOut = countdownDays(target, now);
  }

  // Linked trip — one row, and only when the travel flag is on (the card links
  // to /travel, which 404s without it).
  const showTravel = flags.travel;
  let trip: { id: string; name: string; is_overnight: boolean } | null = null;
  if (showTravel) {
    const { data: tripRow } = await supabase
      .from("trips")
      .select("id, name, is_overnight")
      .eq("program_id", program.id)
      .eq("competition_id", competitionId)
      .order("starts_on", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    trip = (tripRow as { id: string; name: string; is_overnight: boolean } | null) ?? null;
  }

  // Ensembles (names for the header chips + the Details checkboxes) and results.
  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as { id: string; name: string }[] | null) ?? [];
  const ensembleName = new Map(ensembles.map((e) => [e.id, e.name]));

  const { data: resultsData } = await supabase
    .from("competition_results")
    .select("placement, division, score, captions, notes")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .maybeSingle();
  const results = resultsData as ResultsRow | null;

  // ---- Ensemble-change confirmation (generalized invariant §9.2) ------------
  // The Details form posts the intended NEW ensemble set as `pending_ensembles`
  // (comma-joined) when a removal needs acknowledgement. Name the students who
  // would lose eligibility: members of a removed ensemble in NO remaining one.
  const confirmEnsemble = one("confirm") === "ensemble" && canWrite;
  const pendingEnsembleIds = (one("pending_ensembles") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pendingNames = pendingEnsembleIds
    .map((id) => ensembleName.get(id) ?? "?")
    .join(", ");
  let affectedNames: string[] = [];
  if (confirmEnsemble && pendingEnsembleIds.length > 0) {
    const removedIds = participatingEnsembleIds.filter(
      (id) => !pendingEnsembleIds.includes(id),
    );
    if (removedIds.length > 0) {
      const removedStudents = await competitionRoster(supabase, {
        programId: program.id,
        seasonId: comp.season_id,
        ensembleIds: removedIds,
      });
      const remaining = new Set(
        await competitionRoster(supabase, {
          programId: program.id,
          seasonId: comp.season_id,
          ensembleIds: pendingEnsembleIds,
        }),
      );
      const toRemove = removedStudents.filter((id) => !remaining.has(id));
      if (toRemove.length > 0) {
        const { data: nameRows } = await supabase
          .from("students")
          .select("id, first_name, last_name")
          .eq("program_id", program.id)
          .in("id", toRemove);
        affectedNames = (
          (nameRows as { first_name: string; last_name: string }[] | null) ?? []
        )
          .map((s) => `${s.last_name}, ${s.first_name}`)
          .sort((a, b) => a.localeCompare(b));
      }
    }
  }

  // ---- Header + section summaries ------------------------------------------
  const dateText = comp.date
    ? formatDateInTz(`${comp.date}T12:00:00Z`, tz)
    : "No date set";
  const metaLine = [
    dateText,
    comp.host_school,
    comp.venue_address,
    readiness.firstStart ? `call ${formatTimeInTz(readiness.firstStart, tz)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const detailsSummary = [dateText, comp.host_school, COMPETITION_STATUS_LABELS[comp.status]]
    .filter(Boolean)
    .join(" · ");
  const scored = results && (results.placement || results.score !== null);
  const resultsSummary = scored
    ? [results?.placement, results?.score != null ? `${results.score}` : null]
        .filter(Boolean)
        .join(" · ")
    : comp.status === "done"
      ? "not recorded yet"
      : "after the competition";

  // A section's own disclosure opens on `?edit=`, and a failed save reopens the
  // section that owns the message — the Season spine's popover contract.
  const err = compError(one("error"));
  const editKey = one("edit");
  const detailsOpen = editKey === "details" || err?.slot === "details";
  const resultsOpen = editKey === "results" || err?.slot === "results";

  const cards = buildGlanceCards({
    readiness,
    base,
    compBase,
    tz,
    showTravel,
    trip,
    results,
    compDone: comp.status === "done",
    resultsHref: `${compBase}?edit=results#results`,
  });

  return (
    <section className="comp" id="top">
      <p className="comp-back">
        <Link href={`${base}/season`}>← Season</Link>
      </p>

      {one("created") && (
        <p className="alert-ok">Competition created. Attendance seeded.</p>
      )}
      {one("saved") && <p className="alert-ok">Saved.</p>}
      {one("reseeded") && (
        <p className="alert-ok">
          Everyone on the roster now has an attendance row.
        </p>
      )}
      {one("results") && <p className="alert-ok">Results saved.</p>}

      {/* ---- Header ---- */}
      <div className="comp-head">
        <div className="comp-head-titles">
          <div className="comp-status-row">
            <span className={`comp-status-pill ${STATUS_PILL[comp.status]}`}>
              {COMPETITION_STATUS_LABELS[comp.status]}
            </span>
            {comp.status !== "done" && daysOut != null && (
              <span className="comp-countdown">
                {daysOut === 0 ? "Today" : `In ${daysOut} day${daysOut === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
          <h1 className="comp-h1">{comp.name}</h1>
          <p className="comp-meta">{metaLine}</p>
          {hasEnsembles && (
            <p className="comp-head-chips">
              {participatingEnsembleIds.map((eid) => (
                <span className="chip" key={eid}>
                  {ensembleName.get(eid) ?? "?"}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="comp-head-actions">
          {canWrite && (
            <Link href={`${compBase}?edit=details#details`} className="button-link secondary">
              Edit details
            </Link>
          )}
          <a href={`/api/pdf/packet?competition=${competitionId}`} className="button-link">
            Download parent packet (PDF)
          </a>
        </div>
      </div>

      {/* ---- Ensemble-change confirmation (generalized invariant §9.2) ----
          The form carries the competition, the ensembles being asked for, and
          the confirm flag. Everything else — the name, the date, the season, the
          set being replaced — is re-read server-side, so a confirmation typed
          five minutes ago can't paste a stale record back over the record. */}
      {confirmEnsemble && (
        <div className="stack confirm-box">
          <p>
            Set participating ensembles to <strong>{pendingNames || "none"}</strong>?
          </p>
          {affectedNames.length > 0 ? (
            <p>
              This removes {affectedNames.length} student
              {affectedNames.length === 1 ? "" : "s"} from this competition&apos;s
              attendance, meals, travel, and checkout — their attendance rows and
              comp-scoped costume checkouts are released. Students in a remaining
              ensemble are untouched. Affected:{" "}
              <strong>{affectedNames.join("; ")}</strong>.
            </p>
          ) : (
            <p className="muted">
              No students lose eligibility (everyone removed is still in a remaining
              ensemble). Newly added ensembles are seeded expected.
            </p>
          )}
          <form action={updateCompetition} className="row-inline">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={comp.id} />
            <input type="hidden" name="sparse" value="1" />
            <input type="hidden" name="confirm_ensemble" value="1" />
            {pendingEnsembleIds.map((id) => (
              <input type="hidden" name="ensemble_ids" value={id} key={id} />
            ))}
            <button type="submit" className="danger">
              Confirm &amp; update ensembles
            </button>
            <Link href={compBase}>Cancel</Link>
          </form>
        </div>
      )}

      {/* ---- Body ---- */}
      <div className="comp-body">
        <div className="comp-main">
          <GlanceCards cards={cards} />

          <ResultsForm
            programId={program.id}
            slug={slug}
            competitionId={comp.id}
            results={results}
            compDone={comp.status === "done"}
            canWrite={canWrite}
            summary={resultsSummary}
            open={resultsOpen}
            error={err?.slot === "results" ? err.message : null}
          />

          <CompEdit
            programId={program.id}
            slug={slug}
            comp={comp}
            ensembles={ensembles}
            participatingIds={participatingEnsembleIds}
            ensemblesHref={`${base}/roster/ensembles`}
            canWrite={canWrite}
            hasEnsembles={hasEnsembles}
            tz={tz}
            summary={detailsSummary}
            open={detailsOpen}
            error={err?.slot === "details" ? err.message : null}
          />
        </div>

        {/* ---- Right rail ---- */}
        <aside className="comp-rail">
          <div className="comp-card comp-readiness">
            <div className="comp-readiness-head">
              <h3>Readiness</h3>
              <span className="comp-readiness-score">
                {readiness.done} / {readiness.total}
              </span>
            </div>
            {readiness.checks.map((c, i) => (
              <Link className={`comp-readiness-row ${c.ok ? "" : c.tone}`} href={c.href} key={i}>
                <span className={`status-dot ${c.tone}`} aria-hidden="true" />
                <span>{c.label}</span>
              </Link>
            ))}
          </div>

          <div className="comp-card">
            <h3>Papers &amp; links</h3>
            <a href={`/api/pdf/meal?competition=${competitionId}`}>Meal count PDF ↓</a>
            <Link href={`${compBase}/itinerary`}>Itinerary share link →</Link>
            <p className="muted comp-caption">
              Parents see the published itinerary from their family link — no account
              needed.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
