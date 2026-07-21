import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { HOSTING_ROLES, HOSTING_WRITE_ROLES } from "@/lib/nav";
import {
  HOSTED_EVENT_STATUS_LABELS,
  formatHostedDateRange,
  type HostedEventRow,
} from "@/lib/hosting";
import { createHostedEvent } from "./actions";

// Host-mode home (Wave I / I2). The list of the program's hosted invitationals +
// a create form (writers only). Flag-hidden (requireFlag → 404) so a program
// without host-mode never learns it exists; role-gated via <Restricted> for
// authenticated members outside the seat. The two-sentence explainer heads the
// page and doubles as the empty state.

export const dynamic = "force-dynamic";

export default async function HostingPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "hosting");
  if (!HOSTING_ROLES.includes(role)) {
    return <Restricted slug={slug} surface="Hosting" role={role} allowed={HOSTING_ROLES} />;
  }
  const canWrite = HOSTING_WRITE_ROLES.includes(role);
  const { error } = await searchParams;

  const tz = program.timezone;
  const supabase = await createClient();
  const { data } = await supabase
    .from("hosted_events")
    .select(
      "id, program_id, season_id, name, event_date, end_date, venue_notes, status, created_at, updated_at",
    )
    .eq("program_id", program.id)
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const events = (data as HostedEventRow[] | null) ?? [];

  // Schools-count per event (one lean query; grouped in memory).
  const schoolCount = new Map<string, number>();
  if (events.length > 0) {
    const { data: schoolRows } = await supabase
      .from("hosted_schools")
      .select("hosted_event_id")
      .eq("program_id", program.id)
      .in(
        "hosted_event_id",
        events.map((e) => e.id),
      );
    for (const s of (schoolRows as { hosted_event_id: string }[] | null) ?? []) {
      schoolCount.set(s.hosted_event_id, (schoolCount.get(s.hosted_event_id) ?? 0) + 1);
    }
  }

  return (
    <section className="stack">
      <h1>Hosting</h1>

      {error === "name" && (
        <p className="alert-error">Give the invitational a name.</p>
      )}
      {error === "season" && (
        <p className="alert-error">
          Start an active season before setting up an invitational.
        </p>
      )}
      {error === "enddate" && (
        <p className="alert-error">
          The last day can&apos;t be before the first day. Set the first day, then
          a last day on or after it.
        </p>
      )}
      {error === "save" && (
        <p className="alert-error">Couldn&apos;t save. Try again.</p>
      )}

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
              <th>Schools</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/${slug}/hosting/${e.id}`}>{e.name}</Link>
                </td>
                <td>{formatHostedDateRange(e.event_date, e.end_date, tz) || "—"}</td>
                <td>{HOSTED_EVENT_STATUS_LABELS[e.status]}</td>
                <td>{schoolCount.get(e.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <h2>Set up an invitational</h2>
          {!season ? (
            <p className="muted">
              Start an active season first — an invitational lives inside a season.
            </p>
          ) : (
            <form action={createHostedEvent} className="row-inline">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="seasonId" value={season.id} />
              <label>
                Name
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Fall Classic Invitational"
                />
              </label>
              <label>
                Date
                <input type="date" name="event_date" />
              </label>
              <label>
                Last day (optional — for events that span more than one day)
                <input type="date" name="end_date" />
              </label>
              <button type="submit">Create invitational</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
