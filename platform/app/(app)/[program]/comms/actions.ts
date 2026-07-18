"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ANNOUNCEMENT_WRITE_ROLES, computeRecipients, announcementHtml } from "@/lib/comms";
import { mintGuardianTokenForEmail, guardianLinks } from "@/lib/tokens";
import { sendEmail } from "@/lib/email";

// Send an announcement (§8). Immediate: creates the announcement (status 'sent')
// + one announcement_sends row per deduped recipient, and emails each via
// Resend with the family's three token links footered. The human writing it IS
// the approval — no AI, no queue. Director/admin only. When RESEND_API_KEY is
// absent, sends record 'skipped_no_key' so dev/pilot works without email infra.

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

  if (!subject || !bodyMd) redirect(`/${slug}/comms?error=empty`);

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
  if (annErr || !annData) redirect(`/${slug}/comms?error=save`);
  const announcementId = (annData as { id: string }).id;

  const recipients = await computeRecipients(supabase, {
    programId,
    seasonId,
    ensembleId,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of recipients) {
    // Mint a fresh token for THIS email so its footer links always work
    // (append-only; hash-only storage means a prior raw is unrecoverable).
    const minted = await mintGuardianTokenForEmail(supabase, {
      programId,
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
        subject,
        html: announcementHtml({ bodyMd, links }),
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

    await supabase.from("announcement_sends").insert({
      program_id: programId,
      announcement_id: announcementId,
      email: r.email,
      resend_id: resendId,
      status,
    });
  }

  revalidatePath(`/${slug}/comms`);
  redirect(
    `/${slug}/comms?done=1&sent=${sent}&skipped=${skipped}&failed=${failed}`,
  );
}
