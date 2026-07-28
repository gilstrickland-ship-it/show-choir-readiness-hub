import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "../RosterTabs";
import {
  GUARDIAN_EMAIL_STATUS_LABELS,
  guardianAnchor,
  type GuardianEmailStatus,
} from "@/lib/roster/students";

// Deliverability follow-up list (§8a, T026): guardians whose email isn't 'ok'
// (bounced or unsubscribed via the Resend webhook). Reached from the comms
// bounce chip and the directory's bounce banner. Roster-visible roles only
// (director/admin/board_member).
//
// It used to be a dead end: four columns of facts and a link to the student,
// where the director then had to find the right guardian among several and work
// out which of five verbs fixed it. Each row now carries the fix itself — a link
// straight into that guardian's Edit panel, open, on its own anchor (spec 005
// US10-3). Correcting the address is what ends a bounce; "Mark deliverable
// again" sits in the same panel for the unsubscribe a family asked to reverse.

interface GuardianRow {
  id: string;
  name: string;
  email: string | null;
  email_status: GuardianEmailStatus;
  student_id: string;
}

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
}

export default async function EmailIssuesPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);

  const supabase = await createClient();
  const { data: gData } = await supabase
    .from("guardians")
    .select("id, name, email, email_status, student_id")
    .eq("program_id", program.id)
    .neq("email_status", "ok")
    .order("name", { ascending: true });
  const guardians = (gData as GuardianRow[] | null) ?? [];

  const studentIds = Array.from(new Set(guardians.map((g) => g.student_id)));
  const studentName = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: sData } = await supabase
      .from("students")
      .select("id, first_name, last_name")
      .eq("program_id", program.id)
      .in("id", studentIds);
    for (const s of (sData as StudentRow[] | null) ?? []) {
      studentName.set(s.id, `${s.first_name} ${s.last_name}`);
    }
  }

  return (
    <section className="stack">
      <RosterTabs slug={slug} active="directory" canWrite={canWrite} />
      <p>
        <Link href={`/${slug}/roster`}>← Directory</Link>
      </p>
      <h1>Email deliverability</h1>
      <p className="muted">
        These addresses bounced or unsubscribed, so announcements and the weekly
        digest skip them — those families hear nothing until the address is
        fixed.{" "}
        {canWrite
          ? "Fix opens that guardian on their student's page, ready to edit."
          : "A director or admin can correct the address on the student's page."}
      </p>

      {guardians.length === 0 ? (
        <p className="muted">No email problems — every guardian address is good.</p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>Guardian</th>
              <th>Email</th>
              <th>Status</th>
              <th>Student</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {guardians.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td className="muted">{g.email ?? "—"}</td>
                <td>
                  <span className="family-link bouncing">
                    <span className="status-dot alert" aria-hidden="true" />
                    {GUARDIAN_EMAIL_STATUS_LABELS[g.email_status]}
                  </span>
                </td>
                <td>
                  <Link href={`/${slug}/roster/${g.student_id}`}>
                    {studentName.get(g.student_id) ?? "View student"}
                  </Link>
                </td>
                {canWrite && (
                  <td>
                    <Link
                      href={`/${slug}/roster/${g.student_id}?edit=${g.id}#${guardianAnchor(g.id)}`}
                      aria-label={`Fix ${g.name}'s email address`}
                    >
                      Fix →
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
