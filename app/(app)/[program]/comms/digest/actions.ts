"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { DIGEST_WRITE_ROLES, currentWeekOf } from "@/lib/comms";
import { sendDigestCore } from "@/lib/comms-send";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { draftDigest } from "@/lib/ai/digest-draft";
import { programPath } from "@/lib/return-path";

// Digest review actions (§8, T025, Constitution IV). Director/admin only. The AI
// NEVER sends: "Draft now" produces a `draft`, a human edits + approves, and only
// an approved digest can be sent. The cron mirrors this — it drafts, never sends.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// The digest workspace is the ONE home for the digest lifecycle (spec 005
// US9-1): draft, edit, approve, discard, send, history. The Comms landing shows
// the state and links here, so every action below returns to this page and the
// `backTo` fork these redirects used to carry is gone with the landing's forms.
function digestPath(slug: string): string {
// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
  return programPath(slug, "comms/digest") ?? "/";
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

// The three things a reviewer can do to a draft they are LOOKING AT, in one
// action, because they are one form (Constitution IV).
//
// Approve and Send used to be sibling forms carrying nothing but the digest id,
// while the subject and body lived in a third form whose only submit was "Save
// edits". A director who corrected the AI's text and pressed Approve therefore
// approved the STORED row — their edits were discarded by the redirect's
// re-render, and Send could then deliver un-reviewed AI text to every guardian.
// What a human approves must be what the human was reading, so the buttons live
// inside the form that holds the text and arrive with it: this action PERSISTS
// the posted subject/body first and only then flips status. Approve and Send
// remain two separate presses.
const INTENTS = ["save", "approve", "send"] as const;
type Intent = (typeof INTENTS)[number];

function intentOf(fd: FormData): Intent | null {
  const raw = str(fd, "intent");
  return (INTENTS as readonly string[]).includes(raw) ? (raw as Intent) : null;
}

export async function reviewDigest(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const digestId = str(formData, "digestId");
  const seasonId = str(formData, "seasonId") || null;
  const { user } = await requireRole(programId, DIGEST_WRITE_ROLES);
  const dest = digestPath(slug);

  const intent = intentOf(formData);
  if (!intent || !digestId) redirect(`${dest}?error=intent`);

  const subject = str(formData, "subject");
  const bodyMd = str(formData, "body_md");
  if (!subject || !bodyMd) redirect(`${dest}?error=empty`);

  const supabase = await createClient();

  // Persist first, always — including on the way to approving or sending, which
  // is the whole point. Editable only while not yet sent; `.select()` proves a
  // row actually matched, so a digest that has already gone out (or is not this
  // program's) cannot fall through to the status flip below.
  const { data: savedRow, error: saveError } = await supabase
    .from("digests")
    .update({ subject, body_md: bodyMd })
    .eq("id", digestId)
    .eq("program_id", programId)
    .neq("status", "sent")
    .select("id, status")
    .maybeSingle();
  const saved = savedRow as { id: string; status: string } | null;
  if (saveError || !saved) redirect(`${dest}?error=save`);

  if (intent === "save") {
    revalidatePath(dest);
    redirect(`${dest}?saved=1`);
  }

  if (intent === "approve") {
    // Draft-only, unchanged: the guard is what makes approval a one-way step.
    const { data: approvedRow } = await supabase
      .from("digests")
      .update({ status: "approved", approved_by: user.id })
      .eq("id", digestId)
      .eq("program_id", programId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (!approvedRow) redirect(`${dest}?error=notdraft`);
    revalidatePath(dest);
    redirect(`${dest}?approved=1`);
  }

  await sendApprovedDigest(supabase, { programId, digestId, seasonId, dest });
}

// Discard an unapproved draft (§7 redesign — the digest card's danger action).
// Draft-only: the `.eq("status", "draft")` guard means an already-approved or
// sent digest can NEVER be discarded here, so this never destroys an approved or
// sent parent-facing record (Constitution IV — nothing that reached parents is
// touched). A discarded week simply re-drafts on the next run.
export async function discardDigest(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const digestId = str(formData, "digestId");
  await requireRole(programId, DIGEST_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("digests")
    .delete()
    .eq("id", digestId)
    .eq("program_id", programId)
    .eq("status", "draft");

  revalidatePath(digestPath(slug));
  redirect(`${digestPath(slug)}?discarded=1`);
}

// Send an APPROVED digest (§8, T038). Recipients = guardians with email_status
// 'ok', deduped by email; each email carries the family's three token links
// footered onto the markdown body. The fan-out runs on Inngest (retry/batching)
// when INNGEST_EVENT_KEY is set, or inline via the SAME send core when absent
// (packet-parse dual-path). The core is approved-only and flips the digest to
// 'sent' — idempotent, so a retried job never double-sends. digest_sends rows are
// unchanged either way.
//
// Not a server action: reviewDigest is the only way in, so the body being sent
// is always the body that was just persisted from the reviewer's screen.
async function sendApprovedDigest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  {
    programId,
    digestId,
    seasonId,
    dest,
  }: { programId: string; digestId: string; seasonId: string | null; dest: string },
): Promise<never> {
  // Pre-check approved so a non-approved digest never enqueues (the core guards
  // too — this is just for a clean error before the async hand-off).
  const { data: digestData } = await supabase
    .from("digests")
    .select("status")
    .eq("id", digestId)
    .eq("program_id", programId)
    .maybeSingle();
  if ((digestData as { status: string } | null)?.status !== "approved") {
    redirect(`${dest}?error=notapproved`);
  }

  // Async path: enqueue and return; the job flips the digest to 'sent'.
  if (inngestEnabled()) {
    await inngest.send({
      name: "digest/send",
      data: { programId, digestId, seasonId },
    });
    revalidatePath(dest);
    redirect(`${dest}?done=1&queued=1`);
  }

  // Inline fallback (no Inngest): run the same core now and report counts.
  const counts = await sendDigestCore(supabase, { programId, digestId, seasonId });
  if (!counts) {
    redirect(`${dest}?error=notapproved`);
  }
  revalidatePath(dest);
  redirect(
    `${dest}?done=1&sent=${counts.sent}&skipped=${counts.skipped}&failed=${counts.failed}`,
  );
}
