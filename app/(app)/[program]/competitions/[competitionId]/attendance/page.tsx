import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { flashFrom, oneParam } from "@/lib/flash";
import { SubTabs } from "../../../SubTabs";
import { competitionTabs } from "@/lib/subnav";
import { setAttendance } from "./actions";

// Attendance screen (§5, T012) — mobile-first roster list with a three-way
// expected/absent/partial toggle + note. Attendance is the linchpin table every
// generated document reads through (§6). Editors: director/admin/costume_manager.
//
// Spec 005 T157 gave it the page head and the message convention every other
// surface has; what it DOES is unchanged — one tap per student, saved on the tap.

// One section here — the page has a single message area — but the lookup is the
// app's shared one, because the code rides in the URL: `?error=constructor`
// would otherwise walk up Object.prototype and hand React a function to render,
// and `?error=a&error=b` arrives as an ARRAY (spec 005 T143a).
const ERR = {
  save: {
    section: "page",
    message: "Couldn't save that change. Try again.",
  },
} as const;

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

const STATUS_WORD: Record<AttRow["status"], string> = {
  expected: "Expected",
  partial: "Part of the day",
  absent: "Absent",
};

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, competitionId } = await params;
  const sp = await searchParams;
  const error = flashFrom(ERR, oneParam(sp, "error"));
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = ATTENDANCE_WRITE_ROLES.includes(role);

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compData as { id: string; name: string } | null;
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

  const going = rows.filter((r) => r.status !== "absent").length;
  const eyebrow = [
    comp.name,
    rows.length > 0
      ? `${going} of ${rows.length} going`
      : "nobody on the list yet",
  ].join(" · ");

  return (
    <section className="stack">
      <SubTabs strip={competitionTabs(slug, competitionId, "attendance")} />

      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Attendance</h1>
        </div>
      </div>

      {error && <p className="alert-error">{error.message}</p>}

      {rows.length === 0 ? (
        <p className="muted">
          Nobody is on this list yet. Say which ensembles are going on the
          competition page, and everyone in them lands here.
        </p>
      ) : (
        <p className="muted">
          Everyone starts as expected. Tap a student&apos;s answer to change it —
          it saves as you tap. Meal counts and the parent packet read from this
          list.
        </p>
      )}

      <ul className="attendance-list stack">
        {rows.map((r) => (
          <li key={r.student_id}>
            <strong>
              {r.students?.last_name}, {r.students?.first_name}
            </strong>{" "}
            <span className="muted">({STATUS_WORD[r.status]})</span>
            {canWrite ? (
              <form action={setAttendance} className="row-inline attendance-row">
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
                    aria-label={`${s.label} — ${r.students?.last_name}, ${r.students?.first_name}`}
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
