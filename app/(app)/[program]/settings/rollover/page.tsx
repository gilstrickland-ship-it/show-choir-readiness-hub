import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { SETTINGS_ROLES } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { formatDateInTz, formatDateTimeInTz } from "@/lib/datetime";
import { archiveSeason, unarchiveSeason } from "../actions";
import { ArchivedBanner } from "../../ArchivedBanner";
import { SettingsTabs } from "../SettingsTabs";
import {
  createRolloverSeason,
  confirmEnsembles,
  rolloverStudents,
  repointCostumeSets,
  activateNewSeason,
} from "./actions";

// Season rollover wizard + archive (§3, §9.4, T028). director/admin. The wizard
// is a linear step flow driven by ?step= and ?newSeason=; the archive controls at
// the bottom freeze a past season read-only (RLS enforces it) and unarchive it.
//
// Rollover-only since spec 005 US3: starting a FIRST season is one submit on the
// Season/Today card, so nothing here special-cases "you have no seasons". What
// the copy does branch on is whether there is a season to roll FROM, which is a
// real difference a director can see.

const STEPS = ["new", "ensembles", "students", "costumes", "activate", "archive"] as const;
type Step = (typeof STEPS)[number];

const ERR: Record<string, string> = {
  label: "Give the season a name, like 2027-28.",
  create: "Could not create the season. Try again.",
  activate: "Could not make the new season active. Try again.",
  archive: "Could not archive that season.",
  unarchive: "Could not unarchive that season.",
};

export default async function RolloverPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    step?: string;
    newSeason?: string;
    error?: string;
    archived?: string;
    unarchived?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const sp = await searchParams;
  const isDirector = role === "director";

  const step: Step = (STEPS as readonly string[]).includes(sp.step ?? "")
    ? (sp.step as Step)
    : "new";
  const newSeasonId = sp.newSeason ?? "";

  const supabase = await createClient();

  // All seasons (for the archive section + wizard summaries).
  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, label, starts_on, ends_on, is_active, archived_at")
    .eq("program_id", program.id)
    .order("starts_on", { ascending: false, nullsFirst: false })
    .order("label", { ascending: false });
  const seasons =
    (seasonRows as {
      id: string;
      label: string;
      starts_on: string | null;
      ends_on: string | null;
      is_active: boolean;
      archived_at: string | null;
    }[] | null) ?? [];
  const newSeason = seasons.find((s) => s.id === newSeasonId) ?? null;

  // Data needed only for the interactive steps.
  const ensembles =
    step === "ensembles" || step === "students"
      ? ((
          await supabase
            .from("ensembles")
            .select("id, name, sort_order")
            .eq("program_id", program.id)
            .order("sort_order", { ascending: true })
        ).data as { id: string; name: string; sort_order: number }[] | null) ?? []
      : [];

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Settings</p>
          <h1 className="page-h1">Seasons</h1>
        </div>
      </div>

      <SettingsTabs slug={slug} active="seasons" />
      <p className="muted">
        Roll over into next year — new season, who is coming back, costume set
        names — and archive past seasons to freeze them read-only.
      </p>

      {sp.error && <p className="alert-error">{ERR[sp.error] ?? "Something went wrong."}</p>}
      {sp.archived && <p className="alert-ok">Season archived — it is now read-only.</p>}
      {sp.unarchived && <p className="alert-ok">Season unarchived.</p>}

      {/* --- Wizard --- */}
      <div className="confirm-box stack" style={{ width: "100%" }}>
        {season ? (
          <p className="muted">
            Rolling over from <strong>{season.label}</strong>. Your ensembles come
            along on their own; you choose who is returning, copy your costume set
            names, then make the new season the active one.
          </p>
        ) : (
          <p className="muted">
            Making a new season. Your ensembles come along on their own — you
            choose who is in it, then make it the active one.
          </p>
        )}

        {step === "new" && (
          <form action={createRolloverSeason} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <h2>Step 1 · Create the new season</h2>
            <label>
              Season name
              <input type="text" name="label" placeholder="2027-28" required />
            </label>
            <div className="row-inline">
              <label>
                Starts on
                <input type="date" name="starts_on" />
              </label>
              <label>
                Ends on
                <input type="date" name="ends_on" />
              </label>
            </div>
            <button type="submit">Create season &amp; continue</button>
          </form>
        )}

        {step === "ensembles" && (
          <form action={confirmEnsembles} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="newSeasonId" value={newSeasonId} />
            <h2>Step 2 · Your groups</h2>
            <p className="muted">
              Ensembles belong to the program, not to one year, so they come along
              on their own. The new season will use these:
            </p>
            <ul>
              {ensembles.map((e) => (
                <li key={e.id}>{e.name}</li>
              ))}
              {ensembles.length === 0 && <li className="muted">No ensembles yet.</li>}
            </ul>
            <button type="submit">Continue</button>
          </form>
        )}

        {step === "students" && (
          <StudentsStep
            slug={slug}
            programId={program.id}
            newSeasonId={newSeasonId}
            seasonId={season?.id ?? null}
            ensembles={ensembles}
            supabase={supabase}
          />
        )}

        {step === "costumes" && (
          <CostumesStep
            slug={slug}
            programId={program.id}
            newSeasonId={newSeasonId}
            fromSeasonId={season?.id ?? null}
            supabase={supabase}
          />
        )}

        {step === "activate" && (
          <form action={activateNewSeason} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="newSeasonId" value={newSeasonId} />
            <h2>Step 5 · Switch to {newSeason?.label ?? "the new season"}</h2>
            <p className="muted">
              This makes <strong>{newSeason?.label}</strong> the season the whole
              app works in
              {season ? (
                <>
                  {" "}
                  and closes out <strong>{season.label}</strong>. You can archive
                  the old one next.
                </>
              ) : (
                "."
              )}
            </p>
            <button type="submit">Make this the active season</button>
          </form>
        )}

        {step === "archive" && (
          <div className="stack">
            <h2>Step 6 · You&apos;re rolled over 🎉</h2>
            <p className="alert-ok">
              {newSeason?.label} is now your active season.
            </p>
            <p className="muted">
              Archive the previous season to freeze it read-only — its roster,
              results, and PDFs stay browsable in History and Export, but nothing
              can be changed. You can do this now or later from the list below.
            </p>
            <Link href={`/${slug}/dashboard`}>Go to dashboard</Link>
          </div>
        )}

        {step !== "new" && step !== "archive" && (
          <p className="muted">
            <Link href={`/${slug}/settings/rollover`}>Cancel rollover</Link>
          </p>
        )}
      </div>

      {/* --- Archive controls --- */}
      <h2>All seasons</h2>
      {seasons.some((s) => s.archived_at) && <ArchivedBanner />}
      <table className="members">
        <thead>
          <tr>
            <th>Season</th>
            <th>Dates</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td className="muted">
                {s.starts_on ? formatDateInTz(`${s.starts_on}T12:00:00Z`, program.timezone) : "—"} →{" "}
                {s.ends_on ? formatDateInTz(`${s.ends_on}T12:00:00Z`, program.timezone) : "—"}
              </td>
              <td>
                {s.is_active && <span className="badge">Active</span>}
                {s.archived_at ? (
                  <span
                    className="chip"
                    title={formatDateTimeInTz(s.archived_at, program.timezone)}
                  >
                    Archived (read-only)
                  </span>
                ) : (
                  !s.is_active && <span className="muted">Inactive</span>
                )}
              </td>
              <td>
                {s.archived_at ? (
                  isDirector ? (
                    <form action={unarchiveSeason}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="seasonId" value={s.id} />
                      <button type="submit" className="linklike">
                        Unarchive
                      </button>
                    </form>
                  ) : (
                    <span className="muted">Director only</span>
                  )
                ) : s.is_active ? (
                  <span className="muted">Switch to another season first</span>
                ) : (
                  <form action={archiveSeason}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="seasonId" value={s.id} />
                    <button type="submit" className="linklike danger">
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

// ---------------------------------------------------------------------------
// Step 3 — returning students checklist.
// ---------------------------------------------------------------------------
async function StudentsStep({
  slug,
  programId,
  newSeasonId,
  seasonId,
  ensembles,
  supabase,
}: {
  slug: string;
  programId: string;
  newSeasonId: string;
  seasonId: string | null;
  ensembles: { id: string; name: string; sort_order: number }[];
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data: studentRows } = await supabase
    .from("students")
    .select("id, first_name, last_name, grad_year")
    .eq("program_id", programId)
    .eq("status", "active")
    .order("grad_year", { ascending: true, nullsFirst: false })
    .order("last_name", { ascending: true });
  const students =
    (studentRows as {
      id: string;
      first_name: string;
      last_name: string;
      grad_year: number | null;
    }[] | null) ?? [];

  // Current-season ensemble per student (default carry-forward target).
  const currentEnsemble = new Map<string, string>();
  if (seasonId) {
    const { data: mems } = await supabase
      .from("ensemble_members")
      .select("student_id, ensemble_id")
      .eq("program_id", programId)
      .eq("season_id", seasonId);
    for (const m of (mems as { student_id: string; ensemble_id: string }[] | null) ?? []) {
      if (!currentEnsemble.has(m.student_id)) currentEnsemble.set(m.student_id, m.ensemble_id);
    }
  }

  // Graduating class = the lowest grad_year among active students (pre-unchecked).
  const gradYears = students.map((s) => s.grad_year).filter((y): y is number => y != null);
  const graduatingYear = gradYears.length > 0 ? Math.min(...gradYears) : null;

  return (
    <form action={rolloverStudents} className="stack">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="newSeasonId" value={newSeasonId} />
      <h2>Step 3 · Who is coming back</h2>
      <p className="muted">
        Untick anyone who is leaving — the graduating class (
        {graduatingYear ?? "seniors"}) is already unticked and will be marked
        graduated. Everyone still ticked joins the group you pick, which starts
        as the one they are in now.
      </p>
      <table className="members">
        <thead>
          <tr>
            <th>Returning</th>
            <th>Student</th>
            <th>Grad year</th>
            <th>Ensemble (new season)</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const graduating = s.grad_year != null && s.grad_year === graduatingYear;
            const defaultEnsemble =
              currentEnsemble.get(s.id) ?? ensembles[0]?.id ?? "";
            return (
              <tr key={s.id}>
                <td>
                  <input type="hidden" name="student" value={s.id} />
                  <input
                    type="checkbox"
                    name={`return_${s.id}`}
                    defaultChecked={!graduating}
                    aria-label={`Return ${s.first_name} ${s.last_name}`}
                  />
                </td>
                <td>
                  {s.last_name}, {s.first_name}
                  {graduating && <span className="chip">graduating</span>}
                </td>
                <td>{s.grad_year ?? "—"}</td>
                <td>
                  <select name={`ensemble_${s.id}`} defaultValue={defaultEnsemble}>
                    {ensembles.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
          {students.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No active students to carry forward.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <button type="submit">Save &amp; continue</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — re-point costume sets.
// ---------------------------------------------------------------------------
async function CostumesStep({
  slug,
  programId,
  newSeasonId,
  fromSeasonId,
  supabase,
}: {
  slug: string;
  programId: string;
  newSeasonId: string;
  fromSeasonId: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  let oldSetCount = 0;
  if (fromSeasonId) {
    const { count } = await supabase
      .from("costume_sets")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId)
      .eq("season_id", fromSeasonId);
    oldSetCount = count ?? 0;
  }

  return (
    <div className="stack">
      <h2>Step 4 · Copy costume set names into the new season</h2>
      <p className="muted">
        Your costume <em>pieces</em> belong to the program and never move. This
        copies the {oldSetCount} set name
        {oldSetCount === 1 ? "" : "s"} from this season into the new one as empty
        sets, ready to fill — or skip it and build your sets from scratch.
      </p>
      <div className="row-inline">
        <form action={repointCostumeSets}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="newSeasonId" value={newSeasonId} />
          <input type="hidden" name="fromSeasonId" value={fromSeasonId ?? ""} />
          <button type="submit" disabled={oldSetCount === 0}>
            Copy {oldSetCount} set name{oldSetCount === 1 ? "" : "s"} &amp; continue
          </button>
        </form>
        <form action={repointCostumeSets}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="newSeasonId" value={newSeasonId} />
          <input type="hidden" name="skip" value="1" />
          <button type="submit" className="secondary">
            Skip
          </button>
        </form>
      </div>
    </div>
  );
}
