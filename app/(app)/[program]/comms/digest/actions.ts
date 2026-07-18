"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { DIGEST_WRITE_ROLES, currentWeekOf } from "@/lib/comms";
import { sendDigestCore } from "@/lib/comms-send";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
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

// Send an APPROVED digest (§8, T038). Recipients = guardians with email_status
// 'ok', deduped by email; each email carries the family's three token links
// footered onto the markdown body. The fan-out runs on Inngest (retry/batching)
// when INNGEST_EVENT_KEY is set, or inline via the SAME send core when absent
// (packet-parse dual-path). The core is approved-only and flips the digest to
// 'sent' — idempotent, so a retried job never double-sends. digest_sends rows are
// unchanged either way.
export async function sendDigest(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const digestId = str(formData, "digestId");
  const seasonId = str(formData, "seasonId") || null;
  await requireRole(programId, DIGEST_WRITE_ROLES);

  const supabase = await createClient();

  // Pre-check approved so a non-approved digest never enqueues (the core guards
  // too — this is just for a clean error before the async hand-off).
  const { data: digestData } = await supabase
    .from("digests")
    .select("status")
    .eq("id", digestId)
    .eq("program_id", programId)
    .maybeSingle();
  if ((digestData as { status: string } | null)?.status !== "approved") {
    redirect(`${digestPath(slug)}?error=notapproved`);
  }

  // Async path: enqueue and return; the job flips the digest to 'sent'.
  if (inngestEnabled()) {
    await inngest.send({
      name: "digest/send",
      data: { programId, digestId, seasonId },
    });
    revalidatePath(digestPath(slug));
    redirect(`${digestPath(slug)}?done=1&queued=1`);
  }

  // Inline fallback (no Inngest): run the same core now and report counts.
  const counts = await sendDigestCore(supabase, { programId, digestId, seasonId });
  if (!counts) {
    redirect(`${digestPath(slug)}?error=notapproved`);
  }
  revalidatePath(digestPath(slug));
  redirect(
    `${digestPath(slug)}?done=1&sent=${counts.sent}&skipped=${counts.skipped}&failed=${counts.failed}`,
  );
}
