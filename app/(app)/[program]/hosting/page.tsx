import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { HOSTING_ROLES } from "@/lib/nav";
import { formatDateInTz } from "@/lib/datetime";
import {
  HOSTED_EVENT_STATUS_LABELS,
  type HostedEventRow,
} from "@/lib/hosting";

// Host-mode home (Wave I / I1). Foundation-only: the flag gate, the role gate,
// and an honest empty state + live list of the program's hosted invitationals.
// The create form, event command-center, schedule builder, and PDFs land in I2
// — this page leaves the seams (HOSTING_ROLES gate, hosted_events query, the
// two-sentence explainer) ready to build against, and renders real data today.
//
// Flag-hidden (requireFlag → 404) so a program without host-mode never learns it
// exists; role-gated via <Restricted> for authenticated members outside the seat.

export default async function HostingPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "hosting");
  if (!HOSTING_ROLES.includes(role)) {
    return <Restricted slug={slug} surface="Hosting" role={role} allowed={HOSTING_ROLES} />;
  }

  const tz = program.timezone;
  const supabase = await createClient();
  const { data } = await supabase
    .from("hosted_events")
    .select(
      "id, program_id, season_id, name, event_date, venue_notes, status, created_at, updated_at",
    )
    .eq("program_id", program.id)
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const events = (data as HostedEventRow[] | null) ?? [];

  return (
    <section className="stack">
      <h1>Hosting</h1>

      {/* Two-sentence explainer (I1.2). Shown always — it also heads the list. */}
      <p className="muted">
        Host-mode is for the invitational your program <em>runs</em> — the one visiting
        schools travel to, not the competitions you attend. Add the visiting schools, assign
        homerooms, build the day&apos;s schedule, and print door signs and director packets
        straight from live data.
      </p>

      {events.length === 0 ? (
        <p className="muted">
          No hosted invitationals yet. This is where the ones you set up will appear, each
          with its visiting schools, day-of schedule, and printable packets.
        </p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>Invitational</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.event_date ? formatDateInTz(`${e.event_date}T12:00:00Z`, tz) : "—"}</td>
                <td>{HOSTED_EVENT_STATUS_LABELS[e.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
