"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ANNOUNCEMENT_WRITE_ROLES } from "@/lib/comms";
import { sendAnnouncementCore } from "@/lib/comms-send";
import { inngest, inngestEnabled } from "@/lib/inngest/client";

// Send an announcement (§8, T038). Immediate: creates the announcement (status
// 'sent'), then fans out one announcement_sends row per deduped recipient,
// emailing each via Resend with the family's three token links footered. The
// human writing it IS the approval — no AI, no queue. Director/admin only. When
// RESEND_API_KEY is absent, sends record 'skipped_no_key' so dev/pilot works.
//
// The recipient fan-out runs on Inngest (retry/batching) when INNGEST_EVENT_KEY
// is set, or inline via the SAME send core when it is absent — the packet-parse
// dual-path pattern. announcement_sends status rows are identical either way.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function sendAnnouncement(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId") || null;
  await requireRole(programId, ANNOUNCEMENT_WRITE_ROLES);

  const subject = str(formData, "subject");
  const bodyMd = str(formData, "body_md");
  const ensembleId = str(formData, "ensemble_id") || null;

  if (!subject || !bodyMd) redirect(`/${slug}/comms/announcements?error=empty`);

  const supabase = await createClient();

  // Create the announcement (sent).
  const { data: annData, error: annErr } = await supabase
    .from("announcements")
    .insert({
      program_id: programId,
      season_id: seasonId,
      ensemble_id: ensembleId,
      subject,
      body_md: bodyMd,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (annErr || !annData) redirect(`/${slug}/comms/announcements?error=save`);
  const announcementId = (annData as { id: string }).id;

  // Async path: enqueue the fan-out and return immediately (the announcement is
  // already 'sent'; sends land as the job runs).
  if (inngestEnabled()) {
    await inngest.send({
      name: "announcement/send",
      data: { programId, announcementId, seasonId, ensembleId, subject, bodyMd },
    });
    revalidatePath(`/${slug}/comms/announcements`);
    redirect(`/${slug}/comms/announcements?done=1&queued=1`);
  }

  // Inline fallback (no Inngest): run the same core now and report counts.
  const { sent, skipped, failed } = await sendAnnouncementCore(supabase, {
    programId,
    announcementId,
    seasonId,
    ensembleId,
    subject,
    bodyMd,
  });

  revalidatePath(`/${slug}/comms/announcements`);
  redirect(
    `/${slug}/comms/announcements?done=1&sent=${sent}&skipped=${skipped}&failed=${failed}`,
  );
}
