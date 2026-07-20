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
import { CommsTabs } from "./CommsTabs";
import { regenerateSignupShareLink } from "./shifts/actions";
import { approveDigest, discardDigest, sendDigest } from "./digest/actions";

// Comms landing — the Digest surface (§7 redesign). The AI-drafted weekly digest
// awaiting a director's approval is the focal card (Constitution IV: nothing
// sends to parents until a human approves — the Approve/Discard here are the
// existing draft→approved / draft-delete actions, never an auto-send). Alongside
// it: a "recently sent" announcement log and staffing / deliverability /
// broadcast-link asides. The full digest workspace (draft-now, all weeks, inline
// edit) lives at /comms/digest; Announcements composing lives at
// /comms/announcements. Comms is hidden from board_member; flagged-off or
// role-forbidden → 404.

interface DigestRow {
  id: string;
  week_of: string | null;
  status: "draft" | "approved" | "sent";
  subject: string | null;
  body_md: string | null;
}
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

// A short plain-text preview of a markdown body for the draft card (headings /
// emphasis / links stripped to their text). Never rendered as HTML.
function previewText(md: string, max = 280): string {
  const plain = md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__|[*_`>#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

export default async function CommsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    approved?: string;
    discarded?: string;
    done?: string;
    queued?: string;
    sent?: string;
    skipped?: string;
    failed?: string;
    error?: string;
  }>;
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
  const canAnnounce = ANNOUNCEMENT_WRITE_ROLES.includes(role);
  const canShare = SETTINGS_ROLES.includes(role); // director/admin (share_links RLS)
  const tz = program.timezone;
  const sp = await searchParams;

  const supabase = await createClient();

  // Reachable inbox count (eyebrow) — deduped 'ok' guardians, program-wide.
  const everyoneCount = (
    await computeRecipients(supabase, {
      programId: program.id,
      seasonId: season?.id ?? null,
      ensembleId: null,
    })
  ).length;

  // The digest awaiting attention: newest unapproved draft first, else an
  // approved-but-unsent digest ready to go.
  const { data: digestData } = await supabase
    .from("digests")
    .select("id, week_of, status, subject, body_md")
    .eq("program_id", program.id)
    .in("status", ["draft", "approved"])
    .order("week_of", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);
  const openDigests = (digestData as DigestRow[] | null) ?? [];
  const draft = openDigests.find((d) => d.status === "draft") ?? null;
  const approved = draft ? null : openDigests.find((d) => d.status === "approved") ?? null;

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
        {canAnnounce && (
          <div className="page-head-actions">
            <Link href={`/${slug}/comms/announcements`} className="button-link accent">
              + New announcement
            </Link>
          </div>
        )}
      </div>

      <CommsTabs slug={slug} active="digest" shiftsEnabled={flags.shifts} />

      {sp.approved && <p className="alert-ok">Approved. You can send it now.</p>}
      {sp.discarded && <p className="alert-ok">Draft discarded.</p>}
      {sp.done && sp.queued && (
        <p className="alert-ok">The digest is sending in the background.</p>
      )}
      {sp.done && !sp.queued && (
        <p className="alert-ok">
          Digest sent to {sp.sent ?? 0}
          {Number(sp.skipped ?? 0) > 0 && `, skipped ${sp.skipped}`}
          {Number(sp.failed ?? 0) > 0 && `, failed ${sp.failed}`}.
        </p>
      )}
      {sp.error === "notapproved" && (
        <p className="alert-error">Only an approved digest can be sent.</p>
      )}

      {!emailConfigured() && (
        <p className="alert-error">
          Email sending is not configured (no RESEND_API_KEY). Digests can be
          drafted and approved, but sends are marked &ldquo;skipped&rdquo; until
          email is set up.
        </p>
      )}

      <div className="comms-body">
        <section className="comms-main">
          {/* Digest draft card — the approval gate (Constitution IV). Only a draft
              renders it; the Approve/Discard forms are the existing actions. */}
          {draft && (
            <div className="digest-card">
              <div className="digest-card-head">
                <h2>Weekly digest — draft</h2>
                <span className="chip warn">Awaiting your approval</span>
              </div>
              <p className="muted">
                AI-drafted from this week&apos;s events, itinerary, and open shifts.
                Nothing sends to parents until you approve — edit freely first.
              </p>
              <div className="digest-preview">
                <strong>Subject: {draft.subject ?? "—"}</strong>
                <p>{draft.body_md ? previewText(draft.body_md) : "No content yet."}</p>
              </div>
              {canManageDigest && (
                <div className="digest-actions">
                  <form action={approveDigest}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="digestId" value={draft.id} />
                    <input type="hidden" name="backTo" value="comms" />
                    <button type="submit" className="accent">
                      Approve &amp; send to {everyoneCount}
                    </button>
                  </form>
                  <Link href={`/${slug}/comms/digest`} className="button-link secondary">
                    Edit draft
                  </Link>
                  <form action={discardDigest}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="digestId" value={draft.id} />
                    <input type="hidden" name="backTo" value="comms" />
                    <button type="submit" className="discard">
                      Discard
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* Approved but not yet sent — the send gate. */}
          {approved && (
            <div className="digest-card">
              <div className="digest-card-head">
                <h2>Weekly digest — approved</h2>
                <span className="chip">Ready to send</span>
              </div>
              <div className="digest-preview">
                <strong>Subject: {approved.subject ?? "—"}</strong>
              </div>
              {canManageDigest && (
                <div className="digest-actions">
                  <form action={sendDigest}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="digestId" value={approved.id} />
                    <input type="hidden" name="seasonId" value={season?.id ?? ""} />
                    <input type="hidden" name="backTo" value="comms" />
                    <button type="submit" className="accent">
                      Send to {everyoneCount} families now
                    </button>
                  </form>
                  <Link href={`/${slug}/comms/digest`} className="button-link secondary">
                    Review in workspace
                  </Link>
                </div>
              )}
            </div>
          )}

          {!draft && !approved && (
            <div className="digest-card empty">
              <h2>Weekly digest</h2>
              <p className="muted">
                No digest awaiting approval. The weekly digest is AI-drafted for a
                director to review and approve — it never auto-sends.
              </p>
              {canManageDigest && (
                <Link href={`/${slug}/comms/digest`} className="button-link secondary">
                  Open the digest workspace
                </Link>
              )}
            </div>
          )}

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
              <h3>Broadcast signup link</h3>
              <p className="aside-note">
                A read-only link anyone can open to browse this season&apos;s open
                shifts. Parents claim shifts from their own family link. The URL is
                shown once when you generate it.
              </p>
              <form action={regenerateSignupShareLink}>
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="seasonId" value={season.id} />
                <button type="submit" className="linklike">
                  Regenerate signup link →
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
