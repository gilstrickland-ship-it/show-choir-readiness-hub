import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES, SETTINGS_ROLES } from "@/lib/nav";
import {
  ANNOUNCEMENT_WRITE_ROLES,
  DIGEST_WRITE_ROLES,
  computeRecipients,
} from "@/lib/comms";
import { emailConfigured } from "@/lib/email";
import { formatDateInTz } from "@/lib/datetime";
import { activeShareLinks } from "@/lib/tokens";
import { CommsTabs } from "./CommsTabs";
import { DigestStatus, type DigestState } from "./DigestStatus";

// Comms landing (§7 redesign, reshaped by spec 005 US9-1). This page answers
// "what needs my attention?" and hands every job to the route that owns it:
//
//   • the weekly digest → a STATUS card (DigestStatus) linking to the workspace
//     at /comms/digest, which owns draft/edit/approve/discard/send/history
//     exclusively. No digest action lives here; the approve→send gate is a
//     deliberate two-step act taken with the whole draft on screen
//     (Constitution IV).
//   • announcements → /comms/announcements composes and keeps the full history;
//     this page shows only what has recently gone out.
//   • shifts → /comms/shifts fills them and owns the signup link; the asides
//     here report staffing, deliverability, and whether a signup link is live.
//
// Comms is hidden from board_member; flagged-off or role-forbidden → 404.

interface AnnouncementRow {
  id: string;
  subject: string | null;
  ensemble_id: string | null;
  sent_at: string | null;
}
interface ShiftRow {
  id: string;
  title: string;
  starts_at: string | null;
  needed_count: number;
}

export default async function CommsPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);
  requireFlag(program, "comms");
  if (!COMMS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Comms" role={role} allowed={COMMS_ROLES} />
    );
  }
  const canManageDigest = DIGEST_WRITE_ROLES.includes(role);
  // Composing an announcement needs both the seat and the feature (US9-4).
  const canCompose = ANNOUNCEMENT_WRITE_ROLES.includes(role) && flags.announcements;
  const canShare = SETTINGS_ROLES.includes(role); // director/admin (share_links RLS)
  const tz = program.timezone;

  const supabase = await createClient();

  // Reachable inbox count (eyebrow) — deduped 'ok' guardians, program-wide.
  const everyoneCount = (
    await computeRecipients(supabase, {
      programId: program.id,
      seasonId: season?.id ?? null,
      ensembleId: null,
    })
  ).length;

  // The digest's state, and only its state: a draft waiting on a human beats an
  // approved-but-unsent one. Nothing else about the digest is read here, because
  // nothing else is rendered — the workspace loads the subject and body.
  let digestState: DigestState = "clear";
  if (!flags.digest) {
    digestState = "off";
  } else {
    const { data: digestData } = await supabase
      .from("digests")
      .select("status")
      .eq("program_id", program.id)
      .in("status", ["draft", "approved"])
      .order("week_of", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(10);
    const open = (digestData as { status: string }[] | null) ?? [];
    if (open.some((d) => d.status === "draft")) digestState = "draft";
    else if (open.length > 0) digestState = "approved";
  }

  // Recently-sent announcements + per-send delivery rollup.
  const { data: annData } = await supabase
    .from("announcements")
    .select("id, subject, ensemble_id, sent_at")
    .eq("program_id", program.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const announcements = (annData as AnnouncementRow[] | null) ?? [];

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id);
  const ensembleName = new Map(
    ((ensData as { id: string; name: string }[] | null) ?? []).map((e) => [e.id, e.name]),
  );

  const deliveredByAnn = new Map<string, { delivered: number; failed: number }>();
  if (announcements.length > 0) {
    const { data: sendData } = await supabase
      .from("announcement_sends")
      .select("announcement_id, status")
      .eq("program_id", program.id)
      .in("announcement_id", announcements.map((a) => a.id));
    for (const s of (sendData as { announcement_id: string; status: string | null }[] | null) ?? []) {
      const roll = deliveredByAnn.get(s.announcement_id) ?? { delivered: 0, failed: 0 };
      if (s.status === "sent") roll.delivered += 1;
      else if (s.status === "failed") roll.failed += 1;
      deliveredByAnn.set(s.announcement_id, roll);
    }
  }

  // Deliverability — guardians whose email isn't 'ok' (bounced / unsubscribed).
  const { count: bounceCount } = await supabase
    .from("guardians")
    .select("id", { count: "exact", head: true })
    .eq("program_id", program.id)
    .neq("email_status", "ok");

  // Shift staffing · next 14 days (only when the shifts feature is on). Open =
  // needed − confirmed signups, per dated shift in the window.
  let staffing: Array<{ id: string; title: string; open: number; needed: number }> = [];
  if (flags.shifts && season) {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 86_400_000);
    const { data: shiftData } = await supabase
      .from("shifts")
      .select("id, title, starts_at, needed_count")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", in14.toISOString())
      .order("starts_at", { ascending: true })
      .limit(6);
    const shifts = (shiftData as ShiftRow[] | null) ?? [];
    if (shifts.length > 0) {
      const { data: suData } = await supabase
        .from("shift_signups")
        .select("shift_id, status")
        .eq("program_id", program.id)
        .in("shift_id", shifts.map((s) => s.id))
        .eq("status", "confirmed");
      const confirmed = new Map<string, number>();
      for (const su of (suData as { shift_id: string }[] | null) ?? []) {
        confirmed.set(su.shift_id, (confirmed.get(su.shift_id) ?? 0) + 1);
      }
      staffing = shifts.map((s) => ({
        id: s.id,
        title: s.title,
        needed: s.needed_count,
        open: Math.max(0, s.needed_count - (confirmed.get(s.id) ?? 0)),
      }));
    }
  }

  // Is a parent-facing signup link live for this season? Reporting it is this
  // aside's job; minting and rotating it belong to /comms/shifts, where the
  // one-time URL is actually shown — a "make a new link" button here would
  // silently retire the live link and print the replacement on another page.
  const signupLinkLive =
    flags.shifts && canShare && season
      ? (await activeShareLinks(supabase, program.id)).some(
          (l) => l.resource === "signup_page" && l.resource_id === season.id,
        )
      : false;

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            {everyoneCount} reachable guardian inbox
            {everyoneCount === 1 ? "" : "es"} · deduped by email
          </p>
          <h1 className="page-h1">Comms</h1>
        </div>
        {canCompose && (
          <div className="page-head-actions">
            <Link href={`/${slug}/comms/announcements`} className="button-link accent">
              + New announcement
            </Link>
          </div>
        )}
      </div>

      <CommsTabs
        slug={slug}
        active="digest"
        digestEnabled={flags.digest}
        announcementsEnabled={flags.announcements}
        shiftsEnabled={flags.shifts}
      />

      {!emailConfigured() && (
        <p className="alert-error">
          Email sending isn&apos;t set up for this deployment yet, so nothing can
          be emailed from here. Digests can still be drafted and approved — sends
          are marked &ldquo;skipped&rdquo; until email setup is finished. (Whoever
          hosts your program&apos;s site can finish email setup.)
        </p>
      )}

      <div className="comms-body">
        <section className="comms-main">
          <DigestStatus
            slug={slug}
            state={digestState}
            canManage={canManageDigest}
            canCompose={canCompose}
          />

          <h2 className="comms-section-h">Recently sent</h2>
          {announcements.length === 0 ? (
            <p className="muted">No announcements sent yet.</p>
          ) : (
            <div className="sent-list">
              {announcements.map((a) => {
                const roll = deliveredByAnn.get(a.id);
                const audience = a.ensemble_id
                  ? ensembleName.get(a.ensemble_id) ?? "Ensemble"
                  : "Everyone";
                return (
                  <div key={a.id} className="sent-row">
                    <span className="sent-subject">{a.subject ?? "—"}</span>
                    <span className="sent-meta">
                      {audience}
                      {a.sent_at ? ` · ${formatDateInTz(a.sent_at, tz)}` : ""}
                    </span>
                    {roll && roll.delivered > 0 && (
                      <span className="sent-ok">{roll.delivered} delivered</span>
                    )}
                    {roll && roll.failed > 0 && (
                      <span className="sent-fail">{roll.failed} failed</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="comms-aside">
          {flags.shifts && (
            <div className="aside-card">
              <h3>Shift staffing · next 14 days</h3>
              {staffing.length === 0 ? (
                <p className="aside-note">No shifts scheduled in the next 14 days.</p>
              ) : (
                <div className="staffing-rows">
                  {staffing.map((s) => (
                    <div key={s.id} className="staffing-row">
                      <span>{s.title}</span>
                      {s.open > 0 ? (
                        <span className="staffing-open">{s.open} open</span>
                      ) : (
                        <span className="staffing-full">Full</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Link href={`/${slug}/comms/shifts`} className="aside-more">
                Manage shifts →
              </Link>
            </div>
          )}

          <div className="aside-card">
            <h3>Deliverability</h3>
            {(bounceCount ?? 0) > 0 ? (
              <div className="aside-note">
                <strong className="sent-fail">
                  {bounceCount} address{bounceCount === 1 ? "" : "es"} bouncing
                </strong>{" "}
                — these families miss every send.
              </div>
            ) : (
              <p className="aside-note">Every guardian inbox is reachable.</p>
            )}
            <Link href={`/${slug}/roster/email-issues`} className="aside-more">
              Fix in People →
            </Link>
          </div>

          {flags.shifts && canShare && season && (
            <div className="aside-card">
              <h3>Open shifts anyone can browse</h3>
              <p className="aside-note">
                {signupLinkLive
                  ? `A link to this season's open shifts is live. Parents claim shifts from their own family link.`
                  : `No link yet. You can share one page of this season's open shifts with anyone — a booster newsletter, a class group.`}
              </p>
              <Link href={`/${slug}/comms/shifts`} className="aside-more">
                {signupLinkLive ? "Manage the link →" : "Make the link →"}
              </Link>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
