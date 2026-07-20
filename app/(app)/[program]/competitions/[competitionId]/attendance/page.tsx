import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { CompetitionTabs } from "../CompetitionTabs";
import { setAttendance } from "./actions";

// Attendance screen (§5, T012) — mobile-first roster list with a three-way
// expected/absent/partial toggle + note. Attendance is the linchpin table every
// generated document reads through (§6). Editors: director/admin/costume_manager.

interface CompRow {
  id: string;
  name: string;
  ensemble_id: string | null;
}

interface AttRow {
  student_id: string;
  status: "expected" | "absent" | "partial";
  note: string | null;
  students: { first_name: string; last_name: string } | null;
}

const STATUSES: Array<{ key: "expected" | "absent" | "partial"; label: string }> = [
  { key: "expected", label: "Expected" },
  { key: "partial", label: "Partial" },
  { key: "absent", label: "Absent" },
];

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ program: string; competitionId: string }>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = ATTENDANCE_WRITE_ROLES.includes(role);

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name, ensemble_id")
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compData as CompRow | null;
  if (!comp) notFound();

  const { data: attData } = await supabase
    .from("attendance")
    .select("student_id, status, note, students(first_name, last_name)")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId);
  const rows = ((attData as AttRow[] | null) ?? []).slice().sort((a, b) => {
    const an = `${a.students?.last_name ?? ""} ${a.students?.first_name ?? ""}`;
    const bn = `${b.students?.last_name ?? ""} ${b.students?.first_name ?? ""}`;
    return an.localeCompare(bn);
  });

  return (
    <section className="stack">
      <CompetitionTabs slug={slug} competitionId={competitionId} active="attendance" />
      <h1>Attendance</h1>

      {rows.length === 0 && (
        <p className="muted">
          No attendance rows yet.{" "}
          {comp.ensemble_id
            ? "Reseed from the Overview tab."
            : "Set an ensemble on the Overview tab, then reseed."}
        </p>
      )}

      <ul className="attendance-list stack" style={{ width: "100%", listStyle: "none", padding: 0 }}>
        {rows.map((r) => (
          <li
            key={r.student_id}
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: "0.5rem",
              width: "100%",
            }}
          >
            <strong>
              {r.students?.last_name}, {r.students?.first_name}
            </strong>{" "}
            <span className="muted">({r.status})</span>
            {canWrite ? (
              <form action={setAttendance} className="row-inline" style={{ marginTop: "0.35rem" }}>
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="competitionId" value={competitionId} />
                <input type="hidden" name="studentId" value={r.student_id} />
                <input
                  type="text"
                  name="note"
                  defaultValue={r.note ?? ""}
                  placeholder="Note (optional)"
                  aria-label={`Note for ${r.students?.first_name}`}
                />
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    type="submit"
                    name="status"
                    value={s.key}
                    className={r.status === s.key ? "" : "secondary"}
                  >
                    {s.label}
                  </button>
                ))}
              </form>
            ) : (
              r.note && <span className="muted"> — {r.note}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
