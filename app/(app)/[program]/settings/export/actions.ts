"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { runExportJob } from "@/lib/export-run";

// Async export request (§13.2, T036). director/admin. Creates an export_jobs row
// (service-role: the table has no client write policy) and either enqueues the
// Inngest `export/all` job or, when Inngest is not configured (dev/pilot), runs
// the build inline — the same dual-path pattern as packet-parse. The synchronous
// direct-download route stays as the dev fallback; this path emails a signed link
// (or, with no email key, surfaces a signed link on the export page).

export async function requestExport(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const { user } = await requireRole(programId, SETTINGS_ROLES);

  // The RLS client can't write export_jobs (no client write policy) — the job
  // row is created by the service role, which the job runner also uses.
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("export_jobs")
    .insert({ program_id: programId, status: "queued", requested_by: user.id })
    .select("id")
    .single();

  if (error || !created) {
    redirect(`/${slug}/settings/export?error=export`);
  }
  const jobId = (created as { id: string }).id;

  if (inngestEnabled()) {
    await inngest.send({ name: "export/all", data: { jobId, programId } });
  } else {
    // Inline fallback (dev/pilot): build synchronously so the job still completes.
    await runExportJob(jobId, programId);
  }

  revalidatePath(`/${slug}/settings/export`);
  redirect(`/${slug}/settings/export?requested=1`);
}
