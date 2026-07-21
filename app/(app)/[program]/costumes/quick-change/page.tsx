import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import { formatDateInTz } from "@/lib/datetime";
import { CostumeTabs } from "../CostumeTabs";

// Quick-change grid (T033, arch §3/§4/§9). Read-only staffing/reference sheet:
// pick a competition, and the grid lays out costume-set TRANSITIONS (Set N → Set
// N+1, in sort_order) as columns × the competition ensemble's students as rows.
// Each cell shows what a student takes OFF (outgoing set pieces) and puts ON
// (incoming set pieces) for that change, from costume_assignments. Absent
// students (attendance) are greyed. Mobile-usable: the grid scrolls horizontally
// inside its own container so the page body never does.

interface CompRow {
  id: string;
  name: string;
  date: string | null;
  ensemble_id: string | null;
  season_id: string;
}

interface SetRow {
  id: string;
  name: string;
  sort_order: number;
}

export default async function QuickChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ competition?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Wardrobe" role={role} allowed={COSTUMES_ROLES} />
    );
  }
  const tz = program.timezone;
  const { competition: selectedCompId } = await searchParams;

  const supabase = await createClient();

  // Competition picker — every competition in the program (most recent first).
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name, date, ensemble_id, season_id")
    .eq("program_id", program.id)
    .order("date", { ascending: false, nullsFirst: false });
  const competitions = (compData as CompRow[] | null) ?? [];
  const comp = competitions.find((c) => c.id === selectedCompId) ?? null;

  return (
    <section className="stack">
      <CostumeTabs slug={slug} active="quick-change" />
      <h1>Quick change</h1>
      <p className="muted">
        A read-only reference sheet: for a competition, what each student takes off
        and puts on at every costume-set change, in order. Absent students are
        greyed.
      </p>

      <form method="get" className="row-inline">
        <label>
          Competition
          <select name="competition" defaultValue={selectedCompId ?? ""}>
            <option value="">Choose a competition…</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.date ? ` — ${formatDateInTz(`${c.date}T12:00:00Z`, tz)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">
          Open
        </button>
      </form>

      {comp && <QuickChangeGrid slug={slug} programId={program.id} comp={comp} />}
    </section>
  );
}

async function QuickChangeGrid({
  programId,
  comp,
}: {
  slug: string;
  programId: string;
  comp: CompRow;
}) {
  const supabase = await createClient();

  if (!comp.ensemble_id) {
    return (
      <p className="muted">
        This competition has no ensemble set, so there is no student list to build a
        quick-change sheet from. Set its ensemble on the competition page.
      </p>
    );
  }

  // Costume sets for the competition's ensemble + season, in change order.
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name, sort_order")
    .eq("program_id", programId)
    .eq("season_id", comp.season_id)
    .eq("ensemble_id", comp.ensemble_id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const sets = (setData as SetRow[] | null) ?? [];

  if (sets.length < 2) {
    return (
      <p className="muted">
        A quick-change sheet needs at least two costume sets for this ensemble.
        {sets.length === 1 ? " There is only one set." : " There are no sets yet."}{" "}
        Build sets on the Sets tab.
      </p>
    );
  }

  const setIds = sets.map((s) => s.id);

  // Pieces in those sets → set membership + label.
  const { data: pieceData } = await supabase
    .from("costume_pieces")
    .select("id, set_id, label")
    .eq("program_id", programId)
    .in("set_id", setIds);
  const pieces =
    (pieceData as { id: string; set_id: string; label: string }[] | null) ?? [];
  const pieceSet = new Map(pieces.map((p) => [p.id, p.set_id]));
  const pieceLabel = new Map(pieces.map((p) => [p.id, p.label]));

  // Ensemble roster for the season.
  const { data: memberData } = await supabase
    .from("ensemble_members")
    .select("students(id, first_name, last_name)")
    .eq("program_id", programId)
    .eq("season_id", comp.season_id)
    .eq("ensemble_id", comp.ensemble_id);
  const students = ((memberData as { students: { id: string; first_name: string; last_name: string } | null }[] | null) ?? [])
    .map((m) => m.students)
    .filter((s): s is { id: string; first_name: string; last_name: string } => s != null)
    .sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
    );

  // Assignments this season for those pieces → (student, set) → [labels].
  const pieceIds = pieces.map((p) => p.id);
  const byStudentSet = new Map<string, string[]>(); // key: `${studentId}|${setId}`
  if (pieceIds.length > 0) {
    const { data: aData } = await supabase
      .from("costume_assignments")
      .select("piece_id, student_id")
      .eq("program_id", programId)
      .eq("season_id", comp.season_id)
      .in("piece_id", pieceIds);
    for (const a of (aData as { piece_id: string; student_id: string }[] | null) ?? []) {
      const setId = pieceSet.get(a.piece_id);
      const label = pieceLabel.get(a.piece_id);
      if (!setId || !label) continue;
      const key = `${a.student_id}|${setId}`;
      const list = byStudentSet.get(key) ?? [];
      list.push(label);
      byStudentSet.set(key, list);
    }
  }
  for (const list of byStudentSet.values()) list.sort((a, b) => a.localeCompare(b));

  // Absent set (from attendance) — greyed rows.
  const { data: attData } = await supabase
    .from("attendance")
    .select("student_id, status")
    .eq("program_id", programId)
    .eq("competition_id", comp.id)
    .eq("status", "absent");
  const absent = new Set(
    ((attData as { student_id: string }[] | null) ?? []).map((a) => a.student_id),
  );

  // Transitions between consecutive sets.
  const transitions = sets.slice(0, -1).map((from, i) => ({ from, to: sets[i + 1] }));

  const cellPieces = (studentId: string, setId: string): string[] =>
    byStudentSet.get(`${studentId}|${setId}`) ?? [];

  return (
    <div className="stack" style={{ width: "100%" }}>
      <p className="muted">
        {comp.name} · {students.length} student{students.length === 1 ? "" : "s"} ·{" "}
        {transitions.length} change{transitions.length === 1 ? "" : "s"}
      </p>
      {/* Horizontal scroll so wide grids never overflow the page on mobile. */}
      <div style={{ overflowX: "auto", width: "100%" }}>
        <table className="members" style={{ minWidth: "40rem" }}>
          <thead>
            <tr>
              <th>Student</th>
              {transitions.map((t, i) => (
                <th key={i}>
                  {t.from.name} → {t.to.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const isAbsent = absent.has(s.id);
              return (
                <tr key={s.id} className={isAbsent ? "muted" : undefined}>
                  <td>
                    {s.last_name}, {s.first_name}
                    {isAbsent && <span className="chip"> absent</span>}
                  </td>
                  {transitions.map((t, i) => {
                    const off = cellPieces(s.id, t.from.id);
                    const on = cellPieces(s.id, t.to.id);
                    return (
                      <td key={i}>
                        <div>
                          <span className="muted">off:</span>{" "}
                          {off.length > 0 ? off.join(", ") : "—"}
                        </div>
                        <div>
                          <span className="muted">on:</span>{" "}
                          {on.length > 0 ? on.join(", ") : "—"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {students.length === 0 && (
              <tr>
                <td colSpan={transitions.length + 1} className="muted">
                  No students in this ensemble for the season.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
