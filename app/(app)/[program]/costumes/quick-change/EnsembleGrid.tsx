import { createClient } from "@/lib/supabase/server";
import { costumeChanges, type CostumeSetOrder } from "@/lib/costumes";

// One ensemble's quick-change sheet: its costume sets in show order become the
// columns (each column is the GAP between two of them), its students the rows,
// and each cell says what that student takes off and puts on at that moment.
//
// Each ensemble gets its own titled, independently scrolling grid — a shared
// competition can field three ensembles, and one merged table would be a wall
// of blanks (spec 005 US15-2). Absent students (attendance) are greyed.

export async function EnsembleGrid({
  programId,
  seasonId,
  competitionId,
  competitionName,
  ensembleId,
  ensembleName,
}: {
  programId: string;
  seasonId: string;
  competitionId: string;
  competitionName: string;
  ensembleId: string;
  ensembleName: string;
}) {
  const supabase = await createClient();

  // Costume sets for this ensemble + season, in change order.
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name, sort_order")
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .eq("ensemble_id", ensembleId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const sets = (setData as CostumeSetOrder[] | null) ?? [];
  const changes = costumeChanges(sets);

  if (changes.length === 0) {
    return (
      <div className="stack qc-ensemble">
        <h2>{ensembleName}</h2>
        <p className="muted">
          A quick-change sheet needs at least two costume sets for this ensemble
          — there is nothing to change between.
          {sets.length === 1 ? " There is one set so far." : " There are none yet."}{" "}
          Sets are made on the Assignments tab.
        </p>
      </div>
    );
  }

  const setIds = sets.map((s) => s.id);

  // Pieces in those sets → set membership + name.
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
    .eq("season_id", seasonId)
    .eq("ensemble_id", ensembleId);
  type Student = { id: string; first_name: string; last_name: string };
  const students = ((memberData as { students: Student | null }[] | null) ?? [])
    .map((m) => m.students)
    .filter((s): s is Student => s != null)
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
      .eq("season_id", seasonId)
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
    .eq("competition_id", competitionId)
    .eq("status", "absent");
  const absent = new Set(
    ((attData as { student_id: string }[] | null) ?? []).map((a) => a.student_id),
  );

  const cellPieces = (studentId: string, setId: string): string[] =>
    byStudentSet.get(`${studentId}|${setId}`) ?? [];

  return (
    <div className="stack qc-ensemble">
      <h2>{ensembleName}</h2>
      <p className="muted">
        {competitionName} · {students.length} student
        {students.length === 1 ? "" : "s"} · {changes.length} change
        {changes.length === 1 ? "" : "s"}
      </p>
      {/* Its own horizontal scroll, so a wide ensemble never makes the page
          body scroll sideways — and so each ensemble scrolls on its own. */}
      <div className="qc-scroll">
        <table className="members qc-grid">
          <thead>
            <tr>
              <th>Student</th>
              {changes.map((c) => (
                <th key={c.number}>
                  <span className="qc-change-num">Change {c.number}</span>
                  <span className="qc-change-label">{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const isAbsent = absent.has(s.id);
              return (
                <tr key={s.id} className={isAbsent ? "qc-row is-absent" : "qc-row"}>
                  <td>
                    {s.last_name}, {s.first_name}
                    {isAbsent && <span className="chip">absent</span>}
                  </td>
                  {changes.map((c) => {
                    const off = cellPieces(s.id, c.from.id);
                    const on = cellPieces(s.id, c.to.id);
                    return (
                      <td key={c.number}>
                        <div>
                          <span className="qc-cue">Takes off</span>{" "}
                          {off.length > 0 ? off.join(", ") : "nothing"}
                        </div>
                        <div>
                          <span className="qc-cue">Puts on</span>{" "}
                          {on.length > 0 ? on.join(", ") : "nothing"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {students.length === 0 && (
              <tr>
                <td colSpan={changes.length + 1} className="muted">
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
