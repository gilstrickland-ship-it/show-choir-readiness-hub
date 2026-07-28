import type { createClient } from "@/lib/supabase/server";
import { rolloverStudents } from "./actions";

// Rollover step — who is coming back (spec 005 Wave 13 / T165).
//
// The one screen of the rollover that changes people's records, so it says what
// it is going to do before it does it: everyone still ticked joins the new
// season in the group you pick; everyone unticked is marked graduated. Seniors
// come pre-unticked because that is the answer nine times in ten, and it is a
// tick box rather than an assumption because the tenth time matters.

export interface RolloverStudent {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
}

export async function StudentsStep({
  slug,
  programId,
  newSeasonId,
  fromSeasonId,
  ensembles,
  supabase,
}: {
  slug: string;
  programId: string;
  newSeasonId: string;
  // The season being rolled FROM, used only to pre-pick each student's group.
  fromSeasonId: string | null;
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
  const students = (studentRows as RolloverStudent[] | null) ?? [];

  // Current-season ensemble per student (default carry-forward target).
  const currentEnsemble = new Map<string, string>();
  if (fromSeasonId) {
    const { data: mems } = await supabase
      .from("ensemble_members")
      .select("student_id, ensemble_id")
      .eq("program_id", programId)
      .eq("season_id", fromSeasonId);
    for (const m of (mems as { student_id: string; ensemble_id: string }[] | null) ?? []) {
      if (!currentEnsemble.has(m.student_id)) currentEnsemble.set(m.student_id, m.ensemble_id);
    }
  }

  // Graduating class = the lowest grad_year among active students (pre-unticked).
  const gradYears = students.map((s) => s.grad_year).filter((y): y is number => y != null);
  const graduatingYear = gradYears.length > 0 ? Math.min(...gradYears) : null;
  const leaving = students.filter(
    (s) => s.grad_year != null && s.grad_year === graduatingYear,
  ).length;

  return (
    <form action={rolloverStudents} className="stack">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="newSeasonId" value={newSeasonId} />
      <p className="muted">
        Untick anyone who is leaving. The class of{" "}
        {graduatingYear ?? "your oldest students"} is already unticked
        {leaving > 0 ? ` (${leaving})` : ""} and will be marked graduated — they
        stay in your records and in every past season, they just aren&apos;t in
        the new one. Everyone still ticked joins the group you pick, which starts
        as the group they are in now.
      </p>
      <table className="members">
        <thead>
          <tr>
            <th>Coming back</th>
            <th>Student</th>
            <th>Graduates</th>
            <th>Group next season</th>
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
                    aria-label={`${s.first_name} ${s.last_name} is coming back`}
                  />
                </td>
                <td>
                  {s.last_name}, {s.first_name}
                  {graduating && <span className="chip">graduating</span>}
                </td>
                <td>{s.grad_year ?? "—"}</td>
                <td>
                  <select
                    name={`ensemble_${s.id}`}
                    defaultValue={defaultEnsemble}
                    aria-label={`Group for ${s.first_name} ${s.last_name}`}
                  >
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
      <button type="submit">Save and keep going</button>
    </form>
  );
}
