import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildExportZip } from "@/lib/export-zip";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/tokens";

// Async export-all runner (§13.2, T036). Executes ONE export_jobs row end to end:
//   queued → running → build zip → upload to the `exports` bucket → done (email a
//   signed link) OR failed (record the error). Runs on the SERVICE-ROLE client
//   because export_jobs and the exports bucket have no client write policy — the
//   job is the only writer. Shared by the Inngest function and the inline fallback
//   (dev/pilot without Inngest), mirroring the packet-parse dual-path pattern.

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function runExportJob(jobId: string, programId: string): Promise<string> {
  const admin = createAdminClient();
  const storagePath = `${programId}/${jobId}.zip`;

  await admin.from("export_jobs").update({ status: "running" }).eq("id", jobId);

  try {
    const zip = await buildExportZip(admin, programId);

    const { error: upErr } = await admin.storage
      .from("exports")
      .upload(storagePath, zip as Uint8Array, {
        contentType: "application/zip",
        upsert: true,
      });
    if (upErr) throw upErr;

    await admin
      .from("export_jobs")
      .update({
        status: "done",
        storage_path: storagePath,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Best-effort email of a signed download link. When no email key is present
    // (or no director email resolves), the in-app export page lists this job as
    // done with its own signed download link — so delivery never blocks the job.
    await emailDirectorLink(admin, programId, storagePath);

    return "done";
  } catch (e) {
    Sentry.captureException(e, { tags: { job: "export-all", programId } });
    await admin
      .from("export_jobs")
      .update({
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return "failed";
  }
}

async function emailDirectorLink(
  admin: ReturnType<typeof createAdminClient>,
  programId: string,
  storagePath: string,
): Promise<void> {
  try {
    const { data: progRow } = await admin
      .from("programs")
      .select("name, slug")
      .eq("id", programId)
      .maybeSingle();
    const program = progRow as { name: string; slug: string } | null;

    const { data: signed } = await admin.storage
      .from("exports")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    const url = signed?.signedUrl;
    if (!url) return;

    const { data: members } = await admin
      .from("program_members")
      .select("user_id")
      .eq("program_id", programId)
      .in("role", ["director", "admin"])
      .eq("status", "active")
      .not("user_id", "is", null);

    const emails: string[] = [];
    for (const m of (members as { user_id: string }[] | null) ?? []) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        if (u.user?.email) emails.push(u.user.email);
      } catch {
        // ignore — in-app link covers it.
      }
    }

    const settingsUrl = `${appBaseUrl()}/${program?.slug ?? ""}/settings/export`;
    for (const to of Array.from(new Set(emails))) {
      await sendEmail({
        to,
        subject: `Your ${program?.name ?? "program"} export is ready`,
        html: `<p>Your full program export (spreadsheets + generated PDFs) is ready.</p>
<p><a href="${url}">Download the export (.zip)</a> — this link works for 7 days.</p>
<p>You can also grab it any time from <a href="${settingsUrl}">Settings → Export &amp; Data</a>.</p>`,
      });
    }
  } catch {
    // Best-effort — the export itself already succeeded; the in-app link stands.
  }
}
