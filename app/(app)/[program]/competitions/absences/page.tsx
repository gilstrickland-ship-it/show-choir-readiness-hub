import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { confirmAbsence, dismissAbsence } from "./actions";

// Absence review queue (§5, §8a). Pending parent-submitted requests with
// student / competition / guardian / note. Confirm flips attendance to absent;
// Dismiss resolves without change. Writers: director / admin / costume_manager.

interface RequestRow {
  id: string;
  note: string | null;
  created_at: string;
  student: { first_name: string; last_name: string } | null;
  competition: { name: string; date: string | null } | null;
  guardian: { name: string; email: string | null } | null;
}

export default async function AbsenceQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  if (!ATTENDANCE_WRITE_ROLES.includes(role)) notFound();
  const { done, error } = await searchParams;
  const tz = program.timezone;

  const supabase = await createClient();
  const { data } = await supabase
    .from("absence_requests")
    .select(
      "id, note, created_at, student:students(first_name, last_name), competition:competitions(name, date), guardian:guardians(name, email)",
    )
    .eq("program_id", program.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const requests = (data as unknown as RequestRow[] | null) ?? [];

  return (
    <section className="stack">
      <div className="settings-tabs">
        <Link href={`/${slug}/competitions`}>Competitions</Link>
        <strong>Absence requests</strong>
      </div>

      <h1>Absence requests</h1>

      {done === "confirmed" && (
        <p className="alert-ok">Absence confirmed — attendance marked absent.</p>
      )}
      {done === "dismissed" && <p className="alert-ok">Request dismissed.</p>}
      {error === "failed" && (
        <p className="alert-error">
          Something went wrong resolving that request — it was not updated. Try
          again.
        </p>
      )}
      {error === "gone" && (
        <p className="alert-error">That request was already resolved.</p>
      )}

      {requests.length === 0 ? (
        <p className="muted">No pending absence requests.</p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>Student</th>
              <th>Competition</th>
              <th>Reported by</th>
              <th>Note</th>
              <th>When</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.student ? `${r.student.first_name} ${r.student.last_name}` : "—"}
                </td>
                <td>
                  {r.competition?.name ?? "—"}
                  {r.competition?.date && (
                    <div className="muted">{formatDateInTz(r.competition.date, tz)}</div>
                  )}
                </td>
                <td>
                  {r.guardian?.name ?? "—"}
                  {r.guardian?.email && (
                    <div className="muted">{r.guardian.email}</div>
                  )}
                </td>
                <td>{r.note ?? "—"}</td>
                <td className="muted">{formatDateInTz(r.created_at, tz)}</td>
                <td>
                  <div className="row-inline">
                    <form action={confirmAbsence}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <button type="submit">Confirm</button>
                    </form>
                    <form action={dismissAbsence}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <button type="submit" className="secondary">
                        Dismiss
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
