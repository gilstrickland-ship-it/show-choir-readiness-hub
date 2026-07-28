import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { Restricted } from "../../Restricted";
import { Flash } from "../../Flash";
import { readFlash } from "@/lib/flash";
import { ABSENCE_FLASH_MAPS, type AbsenceSection } from "./shared";
import { confirmAbsence, dismissAbsence } from "./actions";

// Absence review queue (§5, §8a). Pending parent-submitted requests with
// student / competition / guardian / note. Confirm flips attendance to absent
// AND emails the reporting guardian the outcome; Dismiss resolves without
// changing attendance and emails too (Constitution IV — the parent hears back
// either way, and only after a human decided). Writers: director / admin /
// costume_manager.
//
// Spec 005 T157: a role that doesn't own this queue used to get a bare 404.
// Every other surface in the app renders <Restricted> instead — a data-free
// notice naming the seats that DO own it — and that distinction is deliberate
// (lib/nav.ts): role-hidden acknowledges the surface to an authenticated member
// of this program, FLAG-hidden keeps hard-404ing so a program never learns a
// feature it doesn't have exists. The requireFlag above is the 404; this is the
// notice.

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
  // Next hands back an ARRAY for a duplicated param (?ok=a&ok=b), so the read
  // goes through lib/flash — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  if (!ATTENDANCE_WRITE_ROLES.includes(role)) {
    return (
      <Restricted
        slug={slug}
        surface="Absence requests"
        role={role}
        allowed={ATTENDANCE_WRITE_ROLES}
      />
    );
  }
  const flash = readFlash<AbsenceSection>(await searchParams, ABSENCE_FLASH_MAPS);
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
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            <Link href={`/${slug}/competitions`}>← Competitions</Link> ·{" "}
            {requests.length} waiting
          </p>
          <h1 className="page-h1">Absence requests</h1>
        </div>
      </div>

      <Flash flash={flash} section="queue" />

      {requests.length === 0 ? (
        <p className="muted">
          Nothing waiting. Families report an absence from their own link, and it
          lands here for you to confirm or dismiss.
        </p>
      ) : (
        <>
          <p className="muted">
            A family reported each of these. Confirming marks the student absent
            for that competition; dismissing changes nothing. Either way the
            person who reported it is emailed the outcome.
          </p>
          <table className="members">
            <thead>
              <tr>
                <th>Student</th>
                <th>Competition</th>
                <th>Reported by</th>
                <th>Note</th>
                <th>When</th>
                <th className="table-action"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const who = r.student
                  ? `${r.student.first_name} ${r.student.last_name}`
                  : "this student";
                return (
                  <tr key={r.id}>
                    <td>{r.student ? who : "—"}</td>
                    <td>
                      {r.competition?.name ?? "—"}
                      {r.competition?.date && (
                        <div className="muted">
                          {formatDateInTz(
                            `${r.competition.date}T12:00:00Z`,
                            tz,
                          )}
                        </div>
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
                    {/* Pinned to the right edge: on a phone this table scrolls,
                        and an action column that starts 500px in is one nobody
                        finds (the T143b lesson). */}
                    <td className="table-action">
                      <div className="row-inline">
                        <form action={confirmAbsence}>
                          <input
                            type="hidden"
                            name="programId"
                            value={program.id}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="requestId" value={r.id} />
                          <button
                            type="submit"
                            aria-label={`Confirm the absence for ${who}`}
                          >
                            Confirm
                          </button>
                        </form>
                        <form action={dismissAbsence}>
                          <input
                            type="hidden"
                            name="programId"
                            value={program.id}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="requestId" value={r.id} />
                          <button
                            type="submit"
                            className="secondary"
                            aria-label={`Dismiss the request for ${who}`}
                          >
                            Dismiss
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
