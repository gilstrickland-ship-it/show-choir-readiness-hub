import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES } from "@/lib/nav";
import { RosterTabs } from "../RosterTabs";

// Deliverability follow-up list (§8a, T026): guardians whose email isn't 'ok'
// (bounced or unsubscribed via the Resend webhook). Reached from the comms bounce
// chip. Read-only here — the director edits the address on the student's page.
// Roster-visible roles only (director/admin/board_member).

interface GuardianRow {
  id: string;
  name: string;
  email: string | null;
  email_status: "ok" | "bounced" | "unsubscribed";
  student_id: string;
}

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
}

const STATUS_LABEL: Record<string, string> = {
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
};

export default async function EmailIssuesPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) notFound();
  const canWrite = role === "director" || role === "admin";

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
        Guardian addresses that bounced or unsubscribed. These are skipped by
        announcement and digest sends until fixed. Open the student to update the
        address.
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
            </tr>
          </thead>
          <tbody>
            {guardians.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td className="muted">{g.email ?? "—"}</td>
                <td>
                  <span className="badge">{STATUS_LABEL[g.email_status] ?? g.email_status}</span>
                </td>
                <td>
                  <Link href={`/${slug}/roster/${g.student_id}`}>
                    {studentName.get(g.student_id) ?? "View student"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
