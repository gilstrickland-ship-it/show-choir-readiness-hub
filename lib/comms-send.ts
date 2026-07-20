import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRecipients, announcementHtml } from "@/lib/comms";
import {
  mintGuardianTokenForEmail,
  guardianLinks,
  listUnsubscribeHeaders,
  type GuardianLinks,
} from "@/lib/tokens";
import { sendEmail, type SendResult } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTimeInTz, formatDateInTz } from "@/lib/datetime";

// Shared send cores (§8, T038). The announcement and digest send loops live here
// ONCE so both the inline server-action path (no Inngest) and the Inngest jobs
// (announcement/send, digest/send) run identical code — the packet-parse
// dual-path pattern applied to sends. Each core takes a Supabase client (the
// action passes its RLS client; the Inngest job passes the service-role client)
// and returns per-status counts. Status rows written are unchanged from the
// original inline implementations.

export interface SendCounts {
  sent: number;
  skipped: number;
  failed: number;
}

// One recipient loop, shared by both cores: mint a fresh per-email token (footer
// links always work; append-only), send, and hand back the per-recipient status.
async function sendToRecipients(
  supabase: SupabaseClient,
  args: {
    programId: string;
    seasonId: string | null;
    ensembleId: string | null;
    subject: string;
    bodyMd: string;
    record: (row: { email: string; resendId: string | null; status: string }) => Promise<void>;
  },
): Promise<SendCounts> {
  const recipients = await computeRecipients(supabase, {
    programId: args.programId,
    seasonId: args.seasonId,
    ensembleId: args.ensembleId,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of recipients) {
    const minted = await mintGuardianTokenForEmail(supabase, {
      programId: args.programId,
      guardianId: r.guardianId,
    });
    const raw = "raw" in minted ? minted.raw : null;
    const links = raw ? guardianLinks(raw) : null;

    let status: string;
    let resendId: string | null = null;

    if (!links || !raw) {
      status = "failed";
      failed++;
    } else {
      const result = await sendEmail({
        to: r.email,
        subject: args.subject,
        html: announcementHtml({ bodyMd: args.bodyMd, links }),
        headers: listUnsubscribeHeaders(raw),
      });
      if (result.status === "sent") {
        status = "sent";
        resendId = result.id;
        sent++;
      } else if (result.status === "skipped_no_key") {
        status = "skipped_no_key";
        skipped++;
      } else {
        status = "failed";
        failed++;
      }
    }

    await args.record({ email: r.email, resendId, status });
  }

  return { sent, skipped, failed };
}

// ---- Guardian family-links email (§8a, F13) --------------------------------
// A links-only email: the three canonical parent links and nothing else. No
// sensitive info (Constitution III), no account (Constitution II) — just the
// family's live entry points, so "Generate/Resend links" can actually REACH the
// family instead of only showing URLs to staff.

// Branded HTML for the family-links email. Deliberately tiny: a one-line intro
// plus the three footer links assembled by announcementHtml (one link style
// across every parent email).
export function guardianLinksEmailHtml(args: {
  programName: string;
  links: GuardianLinks;
}): string {
  const intro =
    `Here are your personal links for ${args.programName}. ` +
    "Use them to view the itinerary, sign up to volunteer, and report an absence. " +
    "Keep this email — the newest links are always the ones that work.";
  return announcementHtml({ bodyMd: intro, links: args.links });
}

// Mint a FRESH per-email token (append-only — earlier links keep working) and
// send the three family links to one guardian. Returns the send status AND the
// minted raw token so a caller can surface the copyable links when email is
// unconfigured (skipped_no_key). `raw` is null only when the mint itself failed.
// Never throws.
export async function sendGuardianLinksEmail(
  supabase: SupabaseClient,
  args: {
    programId: string;
    guardianId: string;
    email: string;
    programName: string;
  },
): Promise<{ send: SendResult; raw: string | null }> {
  const minted = await mintGuardianTokenForEmail(supabase, {
    programId: args.programId,
    guardianId: args.guardianId,
  });
  if (!("raw" in minted)) {
    return { send: { status: "failed", error: minted.error }, raw: null };
  }
  const links = guardianLinks(minted.raw);
  const send = await sendEmail({
    to: args.email,
    subject: `Your ${args.programName} family links`,
    html: guardianLinksEmailHtml({ programName: args.programName, links }),
    headers: listUnsubscribeHeaders(minted.raw),
  });
  return { send, raw: minted.raw };
}

// Announcement send core. The announcement row already exists (created 'sent' by
// the action); this fans out one announcement_sends row per deduped recipient.
export async function sendAnnouncementCore(
  supabase: SupabaseClient,
  args: {
    programId: string;
    announcementId: string;
    seasonId: string | null;
    ensembleId: string | null;
    subject: string;
    bodyMd: string;
  },
): Promise<SendCounts> {
  return sendToRecipients(supabase, {
    programId: args.programId,
    seasonId: args.seasonId,
    ensembleId: args.ensembleId,
    subject: args.subject,
    bodyMd: args.bodyMd,
    record: async ({ email, resendId, status }) => {
      await supabase.from("announcement_sends").insert({
        program_id: args.programId,
        announcement_id: args.announcementId,
        email,
        resend_id: resendId,
        status,
      });
    },
  });
}

// Digest send core. Self-contained (safe for a deferred Inngest run): it re-reads
// the digest, sends only when it is 'approved' (idempotence guard — a re-fired
// job never double-sends), fans out digest_sends rows, then flips the digest to
// 'sent'. Returns null when the digest is missing or not approved.
export async function sendDigestCore(
  supabase: SupabaseClient,
  args: { programId: string; digestId: string; seasonId: string | null },
): Promise<SendCounts | null> {
  const { data: digestData } = await supabase
    .from("digests")
    .select("id, subject, body_md, status")
    .eq("id", args.digestId)
    .eq("program_id", args.programId)
    .maybeSingle();
  const digest = digestData as
    | { id: string; subject: string | null; body_md: string | null; status: string }
    | null;
  if (!digest || digest.status !== "approved") return null;

  const counts = await sendToRecipients(supabase, {
    programId: args.programId,
    seasonId: args.seasonId,
    ensembleId: null,
    subject: digest.subject ?? "",
    bodyMd: digest.body_md ?? "",
    record: async ({ email, resendId, status }) => {
      await supabase.from("digest_sends").insert({
        program_id: args.programId,
        digest_id: digest.id,
        email,
        resend_id: resendId,
        status,
      });
    },
  });

  await supabase
    .from("digests")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", digest.id)
    .eq("program_id", args.programId);

  return counts;
}

// ---- Per-recipient transactional notifications (§8a, C1) -------------------
// Absence outcomes, shift-signup confirmations, and day-before shift reminders
// are plain transactional emails to ONE guardian (no AI, Constitution IV). They
// reuse the announcement footer (three family links + Unsubscribe) and carry the
// RFC 8058 one-click List-Unsubscribe headers, exactly like broadcast sends. All
// are BEST-EFFORT: they never throw and never block the staff action or claim
// that triggered them.

// Send one plain notification to a single guardian: mint a fresh per-email token
// (append-only — earlier links keep working), render body + standard footer, and
// attach the List-Unsubscribe headers. Returns the send status. Never throws.
export async function sendGuardianNotification(
  supabase: SupabaseClient,
  args: {
    programId: string;
    guardianId: string;
    email: string;
    subject: string;
    bodyMd: string;
  },
): Promise<SendResult> {
  const minted = await mintGuardianTokenForEmail(supabase, {
    programId: args.programId,
    guardianId: args.guardianId,
  });
  if (!("raw" in minted)) return { status: "failed", error: minted.error };
  const links = guardianLinks(minted.raw);
  return sendEmail({
    to: args.email,
    subject: args.subject,
    html: announcementHtml({ bodyMd: args.bodyMd, links }),
    headers: listUnsubscribeHeaders(minted.raw),
  });
}

// The parent-facing name of whatever a shift is attached to (competition / trip /
// event), or null for a free-standing shift. Used to give confirmation and
// reminder emails a "what it's for" line.
export async function shiftAttachmentName(
  supabase: SupabaseClient,
  args: {
    programId: string;
    competitionId: string | null;
    tripId: string | null;
    eventId: string | null;
  },
): Promise<string | null> {
  const { programId, competitionId, tripId, eventId } = args;
  if (competitionId) {
    const { data } = await supabase
      .from("competitions")
      .select("name")
      .eq("id", competitionId)
      .eq("program_id", programId)
      .maybeSingle();
    return (data as { name: string } | null)?.name ?? null;
  }
  if (tripId) {
    const { data } = await supabase
      .from("trips")
      .select("name")
      .eq("id", tripId)
      .eq("program_id", programId)
      .maybeSingle();
    return (data as { name: string } | null)?.name ?? null;
  }
  if (eventId) {
    const { data } = await supabase
      .from("events")
      .select("title")
      .eq("id", eventId)
      .eq("program_id", programId)
      .maybeSingle();
    return (data as { title: string } | null)?.title ?? null;
  }
  return null;
}

// Render a date-only field (e.g. competitions.date, "YYYY-MM-DD") as a friendly
// calendar day WITHOUT the timezone rollover a bare midnight-UTC parse would
// cause: anchor at noon UTC so every US/most IANA zones land on the same day.
function formatDateOnlyInTz(date: string | null, tz: string): string {
  if (!date) return "—";
  return formatDateInTz(`${date}T12:00:00Z`, tz);
}

// C1-1. Notify the reporting guardian when staff Confirm or Dismiss their absence
// request. Address-scoped to the request's own guardian; sends only when that
// guardian's email_status is 'ok'. Best-effort — swallows everything.
export async function notifyAbsenceOutcome(args: {
  programId: string;
  requestId: string;
  outcome: "confirmed" | "dismissed";
}): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { data: reqData } = await supabase
      .from("absence_requests")
      .select("id, guardian_id, student_id, competition_id")
      .eq("id", args.requestId)
      .eq("program_id", args.programId)
      .maybeSingle();
    const req = reqData as {
      guardian_id: string | null;
      student_id: string;
      competition_id: string;
    } | null;
    if (!req?.guardian_id) return; // staff-entered request → no guardian to notify.

    const { data: gData } = await supabase
      .from("guardians")
      .select("email, email_status")
      .eq("id", req.guardian_id)
      .eq("program_id", args.programId)
      .maybeSingle();
    const guardian = gData as { email: string | null; email_status: string } | null;
    if (!guardian?.email || guardian.email_status !== "ok") return;

    const [{ data: sData }, { data: cData }, { data: pData }] = await Promise.all([
      supabase
        .from("students")
        .select("first_name")
        .eq("id", req.student_id)
        .eq("program_id", args.programId)
        .maybeSingle(),
      supabase
        .from("competitions")
        .select("name, date")
        .eq("id", req.competition_id)
        .eq("program_id", args.programId)
        .maybeSingle(),
      supabase
        .from("programs")
        .select("name, timezone")
        .eq("id", args.programId)
        .maybeSingle(),
    ]);
    const first = (sData as { first_name: string } | null)?.first_name ?? "your student";
    const comp = cData as { name: string; date: string | null } | null;
    const compName = comp?.name ?? "the competition";
    const program = pData as { name: string; timezone: string } | null;
    const tz = program?.timezone ?? "America/Chicago";
    const dateStr = formatDateOnlyInTz(comp?.date ?? null, tz);

    const { subject, bodyMd } =
      args.outcome === "confirmed"
        ? {
            subject: `Absence confirmed — ${first}, ${compName}`,
            bodyMd:
              `Thank you — staff at ${program?.name ?? "the program"} have recorded ` +
              `${first}'s absence from ${compName} on ${dateStr}. ` +
              `There's nothing more you need to do.`,
          }
        : {
            subject: `About your absence report — ${first}`,
            bodyMd:
              `Staff at ${program?.name ?? "the program"} reviewed your absence report ` +
              `for ${first} and did not mark ${first} absent, so ${first} is still ` +
              `expected at ${compName}. If that isn't right, please contact the ` +
              `program and we'll sort it out.`,
          };

    await sendGuardianNotification(supabase, {
      programId: args.programId,
      guardianId: req.guardian_id,
      email: guardian.email,
      subject,
      bodyMd,
    });
  } catch {
    // best-effort — a failed notification never affects the staff action.
  }
}

// C1-2. Confirm a successful token-link shift claim to the claiming guardian.
// Sends only when the guardian's email_status is 'ok'. Best-effort.
export async function notifyShiftSignup(args: {
  programId: string;
  guardianId: string;
  shiftId: string;
}): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { data: gData } = await supabase
      .from("guardians")
      .select("email, email_status")
      .eq("id", args.guardianId)
      .eq("program_id", args.programId)
      .maybeSingle();
    const guardian = gData as { email: string | null; email_status: string } | null;
    if (!guardian?.email || guardian.email_status !== "ok") return;

    const { data: shData } = await supabase
      .from("shifts")
      .select("title, starts_at, competition_id, trip_id, event_id")
      .eq("id", args.shiftId)
      .eq("program_id", args.programId)
      .maybeSingle();
    const shift = shData as {
      title: string;
      starts_at: string | null;
      competition_id: string | null;
      trip_id: string | null;
      event_id: string | null;
    } | null;
    if (!shift) return;

    const { data: pData } = await supabase
      .from("programs")
      .select("timezone")
      .eq("id", args.programId)
      .maybeSingle();
    const tz = (pData as { timezone: string } | null)?.timezone ?? "America/Chicago";

    const attachedTo = await shiftAttachmentName(supabase, {
      programId: args.programId,
      competitionId: shift.competition_id,
      tripId: shift.trip_id,
      eventId: shift.event_id,
    });

    const whenLine = shift.starts_at
      ? `When: ${formatDateTimeInTz(shift.starts_at, tz)}`
      : "When: to be scheduled";
    const forLine = attachedTo ? `\n\nThis is for ${attachedTo}.` : "";
    const bodyMd =
      `You're signed up to volunteer for "${shift.title}". Thank you!\n\n` +
      `${whenLine}${forLine}\n\n` +
      `Need to cancel? Use the volunteer signup link below.`;

    await sendGuardianNotification(supabase, {
      programId: args.programId,
      guardianId: args.guardianId,
      email: guardian.email,
      subject: `You're signed up — ${shift.title}`,
      bodyMd,
    });
  } catch {
    // best-effort — the claim itself already succeeded.
  }
}
