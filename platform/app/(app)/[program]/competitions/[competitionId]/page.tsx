import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  COMPETITION_WRITE_ROLES,
  COMMON_CAPTIONS,
  activeCaptions,
} from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { CompetitionTabs } from "./CompetitionTabs";
import {
  updateCompetition,
  reseedAttendance,
  saveResults,
} from "../actions";

interface CompDetail {
  id: string;
  season_id: string;
  ensemble_id: string | null;
  name: string;
  host_school: string | null;
  venue_address: string | null;
  date: string | null;
  showchoir_com_url: string | null;
  status: "planned" | "confirmed" | "done";
}

interface EnsembleRow {
  id: string;
  name: string;
}

interface ResultsRow {
  placement: string | null;
  division: string | null;
  score: number | null;
  captions: Record<string, unknown> | null;
  notes: string | null;
}

export default async function CompetitionOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<{
    saved?: string;
    created?: string;
    error?: string;
    reseeded?: string;
    results?: string;
    confirm?: string;
    pending_ensemble?: string;
  }>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const sp = await searchParams;

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select(
      "id, season_id, ensemble_id, name, host_school, venue_address, date, showchoir_com_url, status",
    )
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compData as CompDetail | null;
  if (!comp) notFound();

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];

  const { data: resultsData } = await supabase
    .from("competition_results")
    .select("placement, division, score, captions, notes")
    .eq("competition_id", competitionId)
    .maybeSingle();
  const results = resultsData as ResultsRow | null;

  // Attendance summary (linchpin table — surfaced here, edited on the tab).
  const { data: attData } = await supabase
    .from("attendance")
    .select("status")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId);
  const att = (attData as { status: string }[] | null) ?? [];
  const counts = { expected: 0, absent: 0, partial: 0 } as Record<string, number>;
  for (const a of att) counts[a.status] = (counts[a.status] ?? 0) + 1;

  const confirmEnsemble = sp.confirm === "ensemble" && canWrite;
  const pendingEnsemble = sp.pending_ensemble ?? "";
  const pendingName = ensembles.find((e) => e.id === pendingEnsemble)?.name ?? "none";
  const chosenCaptions = new Set(activeCaptions(results?.captions));

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/competitions`}>← Competitions</Link>
      </p>
      <CompetitionTabs slug={slug} competitionId={competitionId} active="overview" />
      <h1>{comp.name}</h1>

      {sp.created && <p className="alert-ok">Competition created. Attendance seeded.</p>}
      {sp.saved && <p className="alert-ok">Saved.</p>}
      {sp.reseeded && <p className="alert-ok">Attendance reseeded (expected for everyone new).</p>}
      {sp.results && <p className="alert-ok">Results saved.</p>}
      {sp.error === "name" && <p className="alert-error">A competition needs a name.</p>}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {sp.error === "results" && <p className="alert-error">Couldn&apos;t save results.</p>}

      <p className="muted">
        {comp.date ? formatDateInTz(`${comp.date}T12:00:00Z`, program.timezone) : "No date set"} ·{" "}
        Attendance: {counts.expected ?? 0} expected, {counts.absent ?? 0} absent,{" "}
        {counts.partial ?? 0} partial ·{" "}
        <Link href={`/${slug}/competitions/${competitionId}/attendance`}>Edit attendance</Link>
      </p>

      {/* ---- Ensemble-change confirmation (invariant §9.2) ---- */}
      {confirmEnsemble && (
        <div className="stack confirm-box">
          <p>
            Change the ensemble to <strong>{pendingName}</strong>? This reseeds
            attendance for the new ensemble&apos;s members (expected). Existing
            attendance rows for students still eligible are kept.
          </p>
          <form action={updateCompetition} className="row-inline">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={comp.id} />
            <input type="hidden" name="seasonId" value={comp.season_id} />
            <input type="hidden" name="current_ensemble_id" value={comp.ensemble_id ?? ""} />
            <input type="hidden" name="ensemble_id" value={pendingEnsemble} />
            <input type="hidden" name="confirm_ensemble" value="1" />
            <input type="hidden" name="name" value={comp.name} />
            <input type="hidden" name="host_school" value={comp.host_school ?? ""} />
            <input type="hidden" name="venue_address" value={comp.venue_address ?? ""} />
            <input type="hidden" name="date" value={comp.date ?? ""} />
            <input type="hidden" name="showchoir_com_url" value={comp.showchoir_com_url ?? ""} />
            <input type="hidden" name="status" value={comp.status} />
            <button type="submit" className="danger">
              Confirm change &amp; reseed
            </button>
            <Link href={`/${slug}/competitions/${competitionId}`}>Cancel</Link>
          </form>
        </div>
      )}

      {/* ---- Edit form ---- */}
      <h2>Details</h2>
      {canWrite ? (
        <form action={updateCompetition} className="stack">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={comp.id} />
          <input type="hidden" name="seasonId" value={comp.season_id} />
          <input type="hidden" name="current_ensemble_id" value={comp.ensemble_id ?? ""} />
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
              Ensemble
              <select name="ensemble_id" defaultValue={comp.ensemble_id ?? ""}>
                <option value="">— (none / whole program)</option>
                {ensembles.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={comp.status}>
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
                <option value="done">Done</option>
              </select>
            </label>
          </div>
          <div className="row-inline">
            <label>
              Host school
              <input type="text" name="host_school" defaultValue={comp.host_school ?? ""} />
            </label>
            <label>
              Venue address
              <input type="text" name="venue_address" defaultValue={comp.venue_address ?? ""} />
            </label>
            <label>
              showchoir.com URL
              <input type="url" name="showchoir_com_url" defaultValue={comp.showchoir_com_url ?? ""} />
            </label>
          </div>
          <p className="muted">
            Changing the ensemble asks for confirmation and reseeds attendance.
          </p>
          <button type="submit">Save changes</button>
        </form>
      ) : (
        <dl className="detail-list">
          <dt>Date</dt>
          <dd>{comp.date ?? "—"}</dd>
          <dt>Host</dt>
          <dd>{comp.host_school ?? "—"}</dd>
          <dt>Venue</dt>
          <dd>{comp.venue_address ?? "—"}</dd>
          <dt>Status</dt>
          <dd>{comp.status}</dd>
        </dl>
      )}

      {/* ---- Reseed ---- */}
      {canWrite && comp.ensemble_id && (
        <form action={reseedAttendance}>
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={comp.id} />
          <input type="hidden" name="seasonId" value={comp.season_id} />
          <input type="hidden" name="ensemble_id" value={comp.ensemble_id} />
          <button type="submit" className="secondary">
            Reseed attendance
          </button>
        </form>
      )}

      {/* ---- Results (30-second form; one row per competition) ---- */}
      <h2>Results</h2>
      {comp.status !== "done" && !results && (
        <p className="muted">
          Flip status to <strong>Done</strong> after the competition to record placement and captions.
        </p>
      )}
      {(comp.status === "done" || results) &&
        (canWrite ? (
          <form action={saveResults} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={comp.id} />
            <div className="row-inline">
              <label>
                Placement
                <input
                  type="text"
                  name="placement"
                  defaultValue={results?.placement ?? ""}
                  placeholder="Grand Champion, 2nd Runner-Up…"
                />
              </label>
              <label>
                Division
                <input type="text" name="division" defaultValue={results?.division ?? ""} />
              </label>
              <label>
                Score
                <input
                  type="number"
                  step="0.01"
                  name="score"
                  className="num"
                  defaultValue={results?.score ?? ""}
                />
              </label>
            </div>
            <fieldset className="stack">
              <legend>Caption awards</legend>
              <div className="row-inline">
                {COMMON_CAPTIONS.map((name) => (
                  <label key={name} className="row-inline">
                    <input
                      type="checkbox"
                      name={`caption_${name}`}
                      defaultChecked={chosenCaptions.has(name)}
                    />
                    {name}
                  </label>
                ))}
              </div>
              <label>
                Add more (comma-separated)
                <input
                  type="text"
                  name="captions_extra"
                  placeholder="Best Ballad, Judges' Choice"
                />
              </label>
            </fieldset>
            <label>
              Notes
              <textarea name="notes" rows={2} defaultValue={results?.notes ?? ""} />
            </label>
            <button type="submit">Save results</button>
          </form>
        ) : results ? (
          <dl className="detail-list">
            <dt>Placement</dt>
            <dd>{results.placement ?? "—"}</dd>
            <dt>Score</dt>
            <dd>{results.score ?? "—"}</dd>
            <dt>Captions</dt>
            <dd>{activeCaptions(results.captions).join(", ") || "—"}</dd>
          </dl>
        ) : (
          <p className="muted">No results recorded.</p>
        ))}
    </section>
  );
}
