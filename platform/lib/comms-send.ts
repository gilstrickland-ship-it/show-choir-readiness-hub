import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRecipients, announcementHtml } from "@/lib/comms";
import { mintGuardianTokenForEmail, guardianLinks } from "@/lib/tokens";
import { sendEmail } from "@/lib/email";

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
    const links = "raw" in minted ? guardianLinks(minted.raw) : null;

    let status: string;
    let resendId: string | null = null;

    if (!links) {
      status = "failed";
      failed++;
    } else {
      const result = await sendEmail({
        to: r.email,
        subject: args.subject,
        html: announcementHtml({ bodyMd: args.bodyMd, links }),
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
