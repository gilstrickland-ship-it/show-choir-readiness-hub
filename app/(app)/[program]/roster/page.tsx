import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "./RosterTabs";
import { addStudent, emailAllGuardianLinks } from "./actions";

// Roster directory — the one management surface that reads `students` directly
// (it manages the hub itself). Lists all non-graduated students for the program;
// ensemble chips are resolved through ensemble_members for the ACTIVE season so
// season filtering stays consistent with every downstream consumer (§3).

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
  searchParams: Promise<{ q?: string; status?: string; error?: string; bulk?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) notFound();
  const canWrite = ROSTER_WRITE_ROLES.includes(role);
  const { q, status, error, bulk } = await searchParams;

  // Bulk email result, encoded "sent.skipped.failed".
  const bulkCounts = bulk?.match(/^(\d+)\.(\d+)\.(\d+)$/);

  const search = sanitizeSearch(q ?? "");
  const statusFilter = status === "inactive" || status === "active" ? status : "all";

  const supabase = await createClient();

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
  const students = (studentData as StudentRow[] | null) ?? [];

  // Ensemble chips for the active season, and guardian counts.
  const ensemblesByStudent = new Map<string, string[]>();
  if (season) {
    const { data: memberData } = await supabase
      .from("ensemble_members")
      .select("student_id, ensembles(name)")
      .eq("program_id", program.id)
      .eq("season_id", season.id);
    for (const m of (memberData as
      | { student_id: string; ensembles: { name: string } | null }[]
      | null) ?? []) {
      const name = m.ensembles?.name;
      if (!name) continue;
      const list = ensemblesByStudent.get(m.student_id) ?? [];
      list.push(name);
      ensemblesByStudent.set(m.student_id, list);
    }
  }

  const guardianCount = new Map<string, number>();
  const { data: guardianData } = await supabase
    .from("guardians")
    .select("student_id")
    .eq("program_id", program.id);
  for (const g of (guardianData as { student_id: string }[] | null) ?? []) {
    guardianCount.set(g.student_id, (guardianCount.get(g.student_id) ?? 0) + 1);
  }

  return (
    <section className="stack">
      <RosterTabs slug={slug} active="directory" canWrite={canWrite} />
      <h1>Roster</h1>
      {!season && (
        <p className="muted">
          No active season — ensemble membership is hidden until a season is active.
        </p>
      )}

      {error === "missing_name" && (
        <p className="alert-error">A student needs a first and last name.</p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {bulkCounts && (
        <p className={Number(bulkCounts[1]) > 0 ? "alert-ok" : "alert-error"}>
          Family links: {bulkCounts[1]} emailed, {bulkCounts[2]} skipped
          {Number(bulkCounts[2]) > 0 && " (email isn't configured — copy links per family instead)"}
          {Number(bulkCounts[3]) > 0 && `, ${bulkCounts[3]} failed`}.
        </p>
      )}

      <form method="get" className="row-inline">
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
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>

      {canWrite && (
        <form action={emailAllGuardianLinks}>
          <input type="hidden" name="programId" value={program.id} />
          <button type="submit" className="secondary">
            Email links to all families
          </button>
          <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.85rem" }}>
            Sends each family their personal links. Existing links keep working.
          </span>
        </form>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Grad</th>
            <th>Status</th>
            <th>Ensembles</th>
            <th>Guardians</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/${slug}/roster/${s.id}`}>
                  {s.last_name}, {s.first_name}
                </Link>
              </td>
              <td>{s.grad_year ?? "—"}</td>
              <td>{s.status === "inactive" ? <span className="muted">inactive</span> : "active"}</td>
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
              <td>{guardianCount.get(s.id) ?? 0}</td>
            </tr>
          ))}
          {students.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No students match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h2>Add a student</h2>
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
                <input type="number" name="grad_year" min="1990" max="2100" inputMode="numeric" />
              </label>
            </div>
            <button type="submit">Add student</button>
          </form>
        </>
      )}
    </section>
  );
}
