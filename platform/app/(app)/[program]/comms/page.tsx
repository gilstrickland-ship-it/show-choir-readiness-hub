import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES } from "@/lib/nav";
import { ANNOUNCEMENT_WRITE_ROLES, computeRecipients } from "@/lib/comms";
import { emailConfigured } from "@/lib/email";
import { formatDateTimeInTz } from "@/lib/datetime";
import { CommsTabs } from "./CommsTabs";
import { sendAnnouncement } from "./actions";

// Comms — Announcements tab (§8, T023). Compose (director/admin) + immediate send
// with recipient preview and per-send history. Digest is a placeholder tab
// (T025). Comms is hidden from board_member (read-only seat). Flagged-off or
// role-forbidden → 404.

const NO_HEALTH_LABEL = "Do not enter health or medical information.";

interface EnsembleRow {
  id: string;
  name: string;
}
interface AnnouncementRow {
  id: string;
  subject: string | null;
  ensemble_id: string | null;
  sent_at: string | null;
  created_at: string;
}
interface SendRow {
  announcement_id: string;
  status: string | null;
}

export default async function CommsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    error?: string;
    done?: string;
    sent?: string;
    skipped?: string;
    failed?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);
  requireFlag(program, "comms");
  if (!COMMS_ROLES.includes(role)) notFound();
  const canSend = ANNOUNCEMENT_WRITE_ROLES.includes(role);
  const sp = await searchParams;
  const tz = program.timezone;

  const supabase = await createClient();

  // Deliverability bounce chip (§8a, T026): guardians whose email isn't 'ok'
  // (bounced or unsubscribed). Links to the filtered guardian list in roster so
  // the director fixes bad addresses before comp week.
  const { count: emailIssueCount } = await supabase
    .from("guardians")
    .select("id", { count: "exact", head: true })
    .eq("program_id", program.id)
    .neq("email_status", "ok");

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];
  const ensembleName = new Map(ensembles.map((e) => [e.id, e.name]));

  // Recipient preview: deduped 'ok' guardians for everyone + each ensemble.
  const everyoneCount = (
    await computeRecipients(supabase, {
      programId: program.id,
      seasonId: season?.id ?? null,
      ensembleId: null,
    })
  ).length;
  const ensembleCounts: Array<{ id: string; name: string; count: number }> = [];
  for (const e of ensembles) {
    const n = (
      await computeRecipients(supabase, {
        programId: program.id,
        seasonId: season?.id ?? null,
        ensembleId: e.id,
      })
    ).length;
    ensembleCounts.push({ id: e.id, name: e.name, count: n });
  }

  // History + per-send status rollup.
  const { data: annData } = await supabase
    .from("announcements")
    .select("id, subject, ensemble_id, sent_at, created_at")
    .eq("program_id", program.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const announcements = (annData as AnnouncementRow[] | null) ?? [];

  const rollup = new Map<string, Record<string, number>>();
  if (announcements.length > 0) {
    const { data: sendData } = await supabase
      .from("announcement_sends")
      .select("announcement_id, status")
      .eq("program_id", program.id)
      .in(
        "announcement_id",
        announcements.map((a) => a.id),
      );
    for (const s of (sendData as SendRow[] | null) ?? []) {
      const m = rollup.get(s.announcement_id) ?? {};
      const key = s.status ?? "unknown";
      m[key] = (m[key] ?? 0) + 1;
      rollup.set(s.announcement_id, m);
    }
  }

  return (
    <section className="stack">
      <CommsTabs slug={slug} active="announcements" shiftsEnabled={flags.shifts} />
      <h1>Announcements</h1>

      {(emailIssueCount ?? 0) > 0 && (
        <p>
          <Link href={`/${slug}/roster/email-issues`}>
            <span className="badge" style={{ marginRight: "0.4rem" }}>
              {emailIssueCount} email issue{emailIssueCount === 1 ? "" : "s"}
            </span>
            bounced or unsubscribed — review addresses
          </Link>
        </p>
      )}

      {!emailConfigured() && (
        <p className="alert-error">
          Email sending is not configured (no RESEND_API_KEY). Announcements can
          be composed and recorded, but messages are marked
          &ldquo;skipped&rdquo; until email is set up.
        </p>
      )}

      {sp.done && (
        <p className="alert-ok">
          Announcement recorded. Sent {sp.sent ?? 0}
          {Number(sp.skipped ?? 0) > 0 && `, skipped ${sp.skipped}`}
          {Number(sp.failed ?? 0) > 0 && `, failed ${sp.failed}`}.
        </p>
      )}
      {sp.error === "empty" && (
        <p className="alert-error">An announcement needs a subject and a body.</p>
      )}
      {sp.error === "save" && (
        <p className="alert-error">Couldn&apos;t save the announcement. Try again.</p>
      )}

      {canSend && (
        <>
          <h2>Compose</h2>
          <form action={sendAnnouncement} className="stack" style={{ width: "100%" }}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season?.id ?? ""} />
            <label style={{ width: "100%" }}>
              Subject
              <input type="text" name="subject" required />
            </label>
            <label style={{ width: "100%" }}>
              Message
              <textarea name="body_md" rows={6} required />
            </label>
            <p className="muted">{NO_HEALTH_LABEL}</p>
            <label>
              Send to
              <select name="ensemble_id" defaultValue="">
                <option value="">Everyone ({everyoneCount})</option>
                {ensembleCounts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.count})
                  </option>
                ))}
              </select>
            </label>
            <div className="muted">
              Recipients are guardians with a good email address, deduped by email.
              Everyone: {everyoneCount}.
            </div>
            <button type="submit">Send announcement now</button>
          </form>
        </>
      )}

      <h2>History</h2>
      {announcements.length === 0 ? (
        <p className="muted">No announcements yet.</p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Audience</th>
              <th>Sent</th>
              <th>Delivery</th>
            </tr>
          </thead>
          <tbody>
            {announcements.map((a) => {
              const m = rollup.get(a.id) ?? {};
              const parts = Object.entries(m).map(([k, v]) => `${v} ${k}`);
              return (
                <tr key={a.id}>
                  <td>{a.subject ?? "—"}</td>
                  <td>
                    {a.ensemble_id ? (
                      <span className="chip">{ensembleName.get(a.ensemble_id) ?? "?"}</span>
                    ) : (
                      "Everyone"
                    )}
                  </td>
                  <td className="muted">
                    {a.sent_at ? formatDateTimeInTz(a.sent_at, tz) : "—"}
                  </td>
                  <td className="muted">{parts.length > 0 ? parts.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
