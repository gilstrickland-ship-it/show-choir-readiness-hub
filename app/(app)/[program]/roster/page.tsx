import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "./RosterTabs";
import { addStudent, emailAllGuardianLinks } from "./actions";

// People (season-workflow redesign, "People" design ref) — the roster directory
// as a task-oriented landing: page-head with live counts, display sub-tabs, a
// deliverability bounce banner, an ensemble filter, and a per-student family-link
// delivery column. Same management surface (reads `students` directly); the big
// always-visible add form is demoted to a "+ Add student" drawer disclosure.

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  status: "active" | "inactive" | "graduated";
}

// PostgREST or-filter is comma/paren-delimited — strip characters that would
// break its grammar before interpolating the free-text search.
function sanitizeSearch(s: string): string {
  return s.replace(/[,()%*]/g, " ").trim();
}

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    ensemble?: string;
    error?: string;
    bulk?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);
  const { q, status, ensemble, error, bulk } = await searchParams;

  // Bulk email result, encoded "sent.skipped.failed".
  const bulkCounts = bulk?.match(/^(\d+)\.(\d+)\.(\d+)$/);

  const search = sanitizeSearch(q ?? "");
  const statusFilter = status === "inactive" || status === "active" ? status : "all";

  const supabase = await createClient();

  // Ensembles (id + name) for the filter dropdown and membership resolution.
  const { data: ensembleData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("name", { ascending: true });
  const ensembles = (ensembleData as { id: string; name: string }[] | null) ?? [];
  const ensembleFilter =
    ensemble && ensembles.some((e) => e.id === ensemble) ? ensemble : "all";

  let query = supabase
    .from("students")
    .select("id, first_name, last_name, grad_year, status")
    .eq("program_id", program.id)
    .neq("status", "graduated")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (statusFilter !== "all") query = query.eq("status", statusFilter);
  if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);

  const { data: studentData } = await query;
  let students = (studentData as StudentRow[] | null) ?? [];

  // Ensemble chips for the active season, plus a per-ensemble membership set so
  // the new `?ensemble=` filter can narrow the directory server-side.
  const ensemblesByStudent = new Map<string, string[]>();
  const studentsInEnsemble = new Set<string>();
  const ensembleNameById = new Map(ensembles.map((e) => [e.id, e.name]));
  if (season) {
    const { data: memberData } = await supabase
      .from("ensemble_members")
      .select("student_id, ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id);
    for (const m of (memberData as
      | { student_id: string; ensemble_id: string }[]
      | null) ?? []) {
      const name = ensembleNameById.get(m.ensemble_id);
      if (name) {
        const list = ensemblesByStudent.get(m.student_id) ?? [];
        list.push(name);
        ensemblesByStudent.set(m.student_id, list);
      }
      if (ensembleFilter !== "all" && m.ensemble_id === ensembleFilter) {
        studentsInEnsemble.add(m.student_id);
      }
    }
  }
  if (ensembleFilter !== "all") {
    students = students.filter((s) => studentsInEnsemble.has(s.id));
  }

  // Guardians drive counts, per-student totals, and family-link deliverability.
  const guardianCount = new Map<string, number>();
  const guardianBouncing = new Set<string>();
  let guardiansTotal = 0;
  let bounceCount = 0;
  const { data: guardianData } = await supabase
    .from("guardians")
    .select("student_id, email_status")
    .eq("program_id", program.id);
  for (const g of (guardianData as
    | { student_id: string; email_status: "ok" | "bounced" | "unsubscribed" }[]
    | null) ?? []) {
    guardiansTotal += 1;
    guardianCount.set(g.student_id, (guardianCount.get(g.student_id) ?? 0) + 1);
    if (g.email_status !== "ok") {
      guardianBouncing.add(g.student_id);
      bounceCount += 1;
    }
  }

  // Total-student count for the eyebrow (unfiltered, non-graduated).
  const { count: studentsTotal } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("program_id", program.id)
    .neq("status", "graduated");

  const eyebrowParts = [
    `${studentsTotal ?? 0} student${studentsTotal === 1 ? "" : "s"}`,
    `${ensembles.length} ensemble${ensembles.length === 1 ? "" : "s"}`,
    `${guardiansTotal} guardian${guardiansTotal === 1 ? "" : "s"}`,
  ];

  return (
    <section className="stack people">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrowParts.join(" · ")}</p>
          <h1 className="page-h1">People</h1>
        </div>
        <div className="page-head-actions">
          {canWrite && (
            <details className="drawer" open={error === "missing_name" || error === "save"}>
              <summary className="button-link accent">+ Add student</summary>
              <div className="drawer-panel">
                <h2 className="drawer-title">Add a student</h2>
                <form action={addStudent} className="stack">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <div className="row-inline">
                    <label>
                      First name
                      <input type="text" name="first_name" required />
                    </label>
                    <label>
                      Last name
                      <input type="text" name="last_name" required />
                    </label>
                    <label>
                      Grad year
                      <input
                        type="number"
                        name="grad_year"
                        min="1990"
                        max="2100"
                        inputMode="numeric"
                      />
                    </label>
                  </div>
                  <button type="submit">Add student</button>
                </form>
              </div>
            </details>
          )}
          {canWrite && (
            <form action={emailAllGuardianLinks}>
              <input type="hidden" name="programId" value={program.id} />
              <button type="submit" className="button-link secondary">
                Email links to all families
              </button>
            </form>
          )}
        </div>
      </div>

      <RosterTabs slug={slug} active="directory" canWrite={canWrite} />

      {!season && (
        <p className="muted">
          No active season — ensemble membership is hidden until a season is active.
        </p>
      )}

      {error === "missing_name" && (
        <p className="alert-error">A student needs a first and last name.</p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {error === "student" && (
        <p className="alert-error">
          We couldn&apos;t find that student in this program. Pick them from the
          roster below and try again.
        </p>
      )}
      {bulkCounts && (
        <p className={Number(bulkCounts[1]) > 0 ? "alert-ok" : "alert-error"}>
          Family links: {bulkCounts[1]} emailed, {bulkCounts[2]} skipped
          {Number(bulkCounts[2]) > 0 && " (email isn't configured — copy links per family instead)"}
          {Number(bulkCounts[3]) > 0 && `, ${bulkCounts[3]} failed`}.
        </p>
      )}

      {bounceCount > 0 && (
        <div className="people-banner">
          <span className="status-dot warn" aria-hidden="true" />
          <span className="people-banner-text">
            <strong>
              {bounceCount} guardian email{bounceCount === 1 ? " is" : "s are"} bouncing
            </strong>{" "}
            — those families miss every announcement until the address is fixed.
          </span>
          <Link href={`/${slug}/roster/email-issues`} className="people-banner-link">
            Review addresses
          </Link>
        </div>
      )}

      <form method="get" className="row-inline people-filters">
        <input
          type="search"
          name="q"
          placeholder="Search name"
          defaultValue={q ?? ""}
          aria-label="Search students by name"
        />
        <select name="status" defaultValue={statusFilter} aria-label="Filter by status">
          <option value="all">All active + inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <select name="ensemble" defaultValue={ensembleFilter} aria-label="Filter by ensemble">
          <option value="all">All ensembles</option>
          {ensembles.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Grad</th>
            <th>Status</th>
            <th>Ensembles</th>
            <th>Guardians</th>
            <th>Family link</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const gCount = guardianCount.get(s.id) ?? 0;
            const bouncing = guardianBouncing.has(s.id);
            return (
              <tr key={s.id}>
                <td>
                  <Link href={`/${slug}/roster/${s.id}`}>
                    {s.last_name}, {s.first_name}
                  </Link>
                </td>
                <td>{s.grad_year ?? "—"}</td>
                <td>
                  {s.status === "inactive" ? <span className="muted">inactive</span> : "active"}
                </td>
                <td>
                  {(ensemblesByStudent.get(s.id) ?? []).map((name) => (
                    <span key={name} className="chip">
                      {name}
                    </span>
                  ))}
                  {(ensemblesByStudent.get(s.id) ?? []).length === 0 && (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{gCount}</td>
                <td>
                  {gCount === 0 ? (
                    <span className="muted">—</span>
                  ) : bouncing ? (
                    <span className="family-link bouncing">
                      <span className="status-dot alert" aria-hidden="true" />
                      bouncing
                    </span>
                  ) : (
                    <span className="family-link delivering">
                      <span className="status-dot ok" aria-hidden="true" />
                      delivering
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {students.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No students match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="page-foot">
        Family links replace parent accounts — each family gets one link that opens
        their students, itinerary, signups, and absence reporting. Existing links keep
        working when you re-send.
      </p>
    </section>
  );
}
