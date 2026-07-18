"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  DIGEST_WRITE_ROLES,
  computeRecipients,
  announcementHtml,
  currentWeekOf,
} from "@/lib/comms";
import { mintGuardianTokenForEmail, guardianLinks } from "@/lib/tokens";
import { sendEmail } from "@/lib/email";
import { draftDigest } from "@/lib/ai/digest-draft";

// Digest review actions (§8, T025, Constitution IV). Director/admin only. The AI
// NEVER sends: "Draft now" produces a `draft`, a human edits + approves, and only
// an approved digest can be sent. The cron mirrors this — it drafts, never sends.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function digestPath(slug: string): string {
  return `/${slug}/comms/digest`;
}

// "Draft now" fallback (mirrors the packet-parse inline path). Runs the gather →
// Claude → upsert-draft worker synchronously. Requires the `digest` flag on and
// the Anthropic key present; failures surface as a friendly error param.
export async function draftNow(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tz = str(formData, "tz");
  await requireRole(programId, DIGEST_WRITE_ROLES);

  const weekOf = str(formData, "weekOf") || currentWeekOf(tz);

  // Keep redirect() OUT of the try/catch — it throws a NEXT_REDIRECT control
  // signal that must propagate, not be caught as a draft failure.
  let outcome: string;
  try {
    const res = await draftDigest(programId, weekOf);
    outcome =
      res.status === "drafted"
        ? "drafted=1"
        : `skipped=${encodeURIComponent(res.reason)}`;
  } catch {
    outcome = "error=draft";
  }

  revalidatePath(digestPath(slug));
  redirect(`${digestPath(slug)}?${outcome}`);
}

export async function saveDigest(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const digestId = str(formData, "digestId");
  await requireRole(programId, DIGEST_WRITE_ROLES);

  const subject = str(formData, "subject");
  const bodyMd = str(formData, "body_md");
  if (!subject || !bodyMd) redirect(`${digestPath(slug)}?error=empty`);

  const supabase = await createClient();
  // Editable only while not yet sent.
  await supabase
    .from("digests")
    .update({ subject, body_md: bodyMd })
    .eq("id", digestId)
    .eq("program_id", programId)
    .neq("status", "sent");

  revalidatePath(digestPath(slug));
  redirect(`${digestPath(slug)}?saved=1`);
}

export async function approveDigest(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const digestId = str(formData, "digestId");
  const { user } = await requireRole(programId, DIGEST_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("digests")
    .update({ status: "approved", approved_by: user.id })
    .eq("id", digestId)
    .eq("program_id", programId)
    .eq("status", "draft");

  revalidatePath(digestPath(slug));
  redirect(`${digestPath(slug)}?approved=1`);
}

// Send an APPROVED digest. Recipients = guardians with email_status 'ok', deduped
// by email (computeRecipients). Each email carries the family's three token links
// (minted per-email, append-only) footered onto the markdown body. Records a
// digest_sends row per recipient and flips the digest to 'sent'. Approved-only.
export async function sendDigest(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const digestId = str(formData, "digestId");
  const seasonId = str(formData, "seasonId") || null;
  await requireRole(programId, DIGEST_WRITE_ROLES);

  const supabase = await createClient();

  // Only an approved digest sends (idempotence guard: skip if already sent).
  const { data: digestData } = await supabase
    .from("digests")
    .select("id, subject, body_md, status")
    .eq("id", digestId)
    .eq("program_id", programId)
    .maybeSingle();
  const digest = digestData as
    | { id: string; subject: string | null; body_md: string | null; status: string }
    | null;
  if (!digest || digest.status !== "approved") {
    redirect(`${digestPath(slug)}?error=notapproved`);
  }
  const subject = digest.subject ?? "";
  const bodyMd = digest.body_md ?? "";

  const recipients = await computeRecipients(supabase, {
    programId,
    seasonId,
    ensembleId: null,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of recipients) {
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

    await supabase.from("digest_sends").insert({
      program_id: programId,
      digest_id: digest.id,
      email: r.email,
      resend_id: resendId,
      status,
    });
  }

  await supabase
    .from("digests")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", digest.id)
    .eq("program_id", programId);

  revalidatePath(digestPath(slug));
  redirect(`${digestPath(slug)}?done=1&sent=${sent}&skipped=${skipped}&failed=${failed}`);
}
