import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES } from "@/lib/nav";
import {
  DIGEST_WRITE_ROLES,
  computeRecipients,
  bodyToHtml,
  currentWeekOf,
} from "@/lib/comms";
import { emailConfigured } from "@/lib/email";
import { formatDateInTz, formatDateTimeInTz } from "@/lib/datetime";
import Link from "next/link";
import { CommsTabs } from "../CommsTabs";
import { IntroStrip, HelpDot } from "../../IntroStrip";
import { loadGuideState } from "@/lib/guide";
import {
  draftNow,
  saveDigest,
  approveDigest,
  sendDigest,
  discardDigest,
} from "./actions";

// Comms — Digest tab (§8, T025, Constitution IV). Weekly AI-drafted parent digest:
// gather → Claude draft → director review/edit/approve → send with per-family
// token links. NEVER auto-sends. Director/admin manage; other comms roles read.
// The AI-drafting controls appear only when the `digest` flag is on.

interface DigestRow {
  id: string;
  week_of: string | null;
  status: "draft" | "approved" | "sent";
  subject: string | null;
  body_md: string | null;
  model: string | null;
  prompt_version: string | null;
  sent_at: string | null;
  created_at: string;
}

interface SendRow {
  digest_id: string;
  status: string | null;
}

export default async function DigestPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    drafted?: string;
    discarded?: string;
    saved?: string;
    approved?: string;
    done?: string;
    queued?: string;
    sent?: string;
    skipped?: string;
    failed?: string;
    error?: string;
    help?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags, membership, isSupport } =
    await getTenantContext(slug);
  requireFlag(program, "comms");
  if (!COMMS_ROLES.includes(role)) {
    return (
      <Restricted
        slug={slug}
        surface="Comms"
        role={role}
        allowed={COMMS_ROLES}
      />
    );
  }
  const canManage = DIGEST_WRITE_ROLES.includes(role);
  const digestEnabled = flags.digest;
  const tz = program.timezone;
  const sp = await searchParams;

  const supabase = await createClient();

  // First-use intro strip (spec 003 §3) — the AI drafts; a director approves.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(supabase, program.id, membership.user_id)
      : {};

  const { data: digestData } = await supabase
    .from("digests")
    .select(
      "id, week_of, status, subject, body_md, model, prompt_version, sent_at, created_at",
    )
    .eq("program_id", program.id)
    .order("week_of", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const digests = (digestData as DigestRow[] | null) ?? [];

  // Per-digest send rollup (for the sent history line).
  const rollup = new Map<string, Record<string, number>>();
  if (digests.length > 0) {
    const { data: sendData } = await supabase
      .from("digest_sends")
      .select("digest_id, status")
      .eq("program_id", program.id)
      .in(
        "digest_id",
        digests.map((d) => d.id),
      );
    for (const s of (sendData as SendRow[] | null) ?? []) {
      const m = rollup.get(s.digest_id) ?? {};
      const key = s.status ?? "unknown";
      m[key] = (m[key] ?? 0) + 1;
      rollup.set(s.digest_id, m);
    }
  }

  const recipientCount = (
    await computeRecipients(supabase, {
      programId: program.id,
      seasonId: season?.id ?? null,
      ensembleId: null,
    })
  ).length;

  const unapprovedDrafts = digests.filter((d) => d.status === "draft").length;
  const weekOf = currentWeekOf(tz);

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            <Link href={`/${slug}/comms`}>← Comms</Link> · digest workspace
          </p>
          <div className="page-title-row">
            <h1 className="page-h1">Weekly digest</h1>
            {showGuide && <HelpDot href={`/${slug}/comms/digest?help=1`} />}
          </div>
        </div>
      </div>

      {showGuide && (
        <IntroStrip
          surfaceKey="digest"
          programId={program.id}
          selfPath={`/${slug}/comms/digest`}
          guideState={guideState}
          help={sp.help === "1"}
        />
      )}

      <CommsTabs slug={slug} active="digest" shiftsEnabled={flags.shifts} />

      <p className="muted">
        An AI-drafted weekly summary a director reviews and approves before it
        sends. It never auto-sends: no approval by the reminder deadline means a
        reminder, not a send.
      </p>

      {/* Reminder banner — the reliable "unapproved draft" surface (§8, the cron
          email is best-effort; this banner always shows). */}
      {unapprovedDrafts > 0 && (
        <p className="alert-error">
          {unapprovedDrafts} digest draft{unapprovedDrafts === 1 ? "" : "s"}{" "}
          awaiting review and approval. Nothing sends to parents until you
          approve it.
        </p>
      )}

      {!emailConfigured() && (
        <p className="alert-error">
          Email sending isn&apos;t set up for this deployment yet, so nothing
          can be emailed from here. Digests can still be drafted and approved —
          sends are marked &ldquo;skipped&rdquo; until email setup is finished.
          (Whoever hosts your program&apos;s site can finish email setup.)
        </p>
      )}

      {sp.drafted && <p className="alert-ok">Draft ready below for review.</p>}
      {sp.discarded && <p className="alert-ok">Draft discarded.</p>}
      {sp.saved && <p className="alert-ok">Draft saved.</p>}
      {sp.approved && (
        <p className="alert-ok">Approved. You can send it now.</p>
      )}
      {sp.done &&
        sp.queued &&
        (emailConfigured() ? (
          <p className="alert-ok">The digest is sending in the background.</p>
        ) : (
          <p className="alert-error">
            Approved, but email sending isn&apos;t set up — recipients will be
            skipped for now.
          </p>
        ))}
      {sp.done && !sp.queued && (
        <p className="alert-ok">
          Digest sent to {sp.sent ?? 0}
          {Number(sp.skipped ?? 0) > 0 && `, skipped ${sp.skipped}`}
          {Number(sp.failed ?? 0) > 0 && `, failed ${sp.failed}`}.
        </p>
      )}
      {sp.error === "draft" && (
        <p className="alert-error">
          Couldn&apos;t draft the digest (is the AI key configured?). Try again.
        </p>
      )}
      {sp.error === "empty" && (
        <p className="alert-error">A digest needs a subject and a body.</p>
      )}
      {sp.error === "notapproved" && (
        <p className="alert-error">Only an approved digest can be sent.</p>
      )}
      {sp.skipped && !sp.done && (
        <p className="muted">Draft skipped: {sp.skipped}.</p>
      )}

      {canManage && (
        <div className="stack">
          {digestEnabled ? (
            <form action={draftNow} className="row-inline">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="tz" value={tz} />
              <input type="hidden" name="weekOf" value={weekOf} />
              <button type="submit">Draft this week now</button>
              <span className="muted">
                Week of {formatDateInTz(`${weekOf}T12:00:00Z`, tz)} ·
                recipients: {recipientCount}
              </span>
            </form>
          ) : (
            <p className="muted">
              The weekly digest isn&apos;t turned on for this program. Existing
              drafts remain reviewable.
            </p>
          )}
        </div>
      )}

      {digests.length === 0 && <p className="muted">No digests yet.</p>}

      {digests.map((d) => {
        const m = rollup.get(d.id) ?? {};
        const parts = Object.entries(m).map(([k, v]) => `${v} ${k}`);
        const editable = canManage && d.status !== "sent";
        return (
          <div key={d.id} className="confirm-box" style={{ width: "100%" }}>
            <div
              className="row-inline"
              style={{ justifyContent: "space-between" }}
            >
              <strong>
                Week of{" "}
                {d.week_of ? formatDateInTz(`${d.week_of}T12:00:00Z`, tz) : "—"}
              </strong>
              <span className="badge">{d.status}</span>
            </div>
            <div className="muted">
              {d.model ? (
                <span title={`${d.model} · ${d.prompt_version}`}>
                  AI-drafted
                </span>
              ) : (
                "Written by hand"
              )}
              {d.sent_at ? ` · sent ${formatDateTimeInTz(d.sent_at, tz)}` : ""}
              {parts.length > 0 ? ` · ${parts.join(", ")}` : ""}
            </div>

            {editable ? (
              <form
                action={saveDigest}
                className="stack"
                style={{ marginTop: "0.5rem" }}
              >
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="digestId" value={d.id} />
                <label style={{ width: "100%" }}>
                  Subject
                  <input
                    type="text"
                    name="subject"
                    defaultValue={d.subject ?? ""}
                    required
                  />
                </label>
                <label style={{ width: "100%" }}>
                  Body
                  <textarea
                    name="body_md"
                    rows={12}
                    defaultValue={d.body_md ?? ""}
                    required
                  />
                  <span className="muted">
                    Plain text works — leave a blank line between paragraphs.
                  </span>
                </label>
                <button type="submit" className="secondary">
                  Save edits
                </button>
              </form>
            ) : (
              <>
                <p style={{ marginTop: "0.5rem" }}>
                  <strong>{d.subject ?? "—"}</strong>
                </p>
                <div
                  dangerouslySetInnerHTML={{
                    __html: bodyToHtml(d.body_md ?? ""),
                  }}
                />
              </>
            )}

            {canManage && (
              <div className="row-inline" style={{ marginTop: "0.5rem" }}>
                {d.status === "draft" && (
                  <>
                    <form action={approveDigest}>
                      <input
                        type="hidden"
                        name="programId"
                        value={program.id}
                      />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="digestId" value={d.id} />
                      <button type="submit">Approve</button>
                    </form>
                    <form action={discardDigest}>
                      <input
                        type="hidden"
                        name="programId"
                        value={program.id}
                      />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="digestId" value={d.id} />
                      <button type="submit" className="discard">
                        Discard
                      </button>
                    </form>
                  </>
                )}
                {d.status === "approved" && (
                  <form action={sendDigest}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="digestId" value={d.id} />
                    <input
                      type="hidden"
                      name="seasonId"
                      value={season?.id ?? ""}
                    />
                    <button type="submit">
                      Send to {recipientCount} families now
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
