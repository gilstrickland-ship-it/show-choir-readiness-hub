"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { flag, type FlaggableProgram } from "@/lib/flags";
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

  // The `announcements` flag gates the channel, not just the page (spec 005
  // US9-4, Constitution VIII: flags are evaluated server-side). The route 404s
  // when it is off, so the only way to reach this line with the flag down is a
  // POST to the action itself — which is exactly the case a flag has to hold.
  const { data: progData } = await supabase
    .from("programs")
    .select("tier, feature_overrides")
    .eq("id", programId)
    .maybeSingle();
  const announcementsOn = flag(
    (progData as FlaggableProgram | null) ?? { tier: "prep", feature_overrides: null },
    "announcements",
  );
  if (!announcementsOn) redirect(`/${slug}/comms`);

  // Both ids come off the form and the write policy checks only the row's own
  // program_id, so resolve them inside THIS program first (Constitution I).
  // Otherwise an announcement can be pinned to another program's season or
  // ensemble — a row they can neither see nor delete, which then blocks them
  // from ever deleting that ensemble. It also mails nobody, because
  // computeRecipients is program-scoped: an honest director who somehow gets
  // here deserves the error rather than a "sent" that reached no one.
  const inProgram = async (table: string, id: string): Promise<boolean> => {
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("program_id", programId)
      .maybeSingle();
    return Boolean(data);
  };
  if (seasonId && !(await inProgram("seasons", seasonId))) {
    redirect(`/${slug}/comms/announcements?error=season`);
  }
  if (ensembleId && !(await inProgram("ensembles", ensembleId))) {
    redirect(`/${slug}/comms/announcements?error=ensemble`);
  }

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
