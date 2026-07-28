"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { runExportJob } from "@/lib/export-run";
import { programPath } from "@/lib/return-path";
import type { ExportErrorKey, ExportOkKey } from "../shared";

// Async export request (§13.2, T036). director/admin. Creates an export_jobs row
// (service-role: the table has no client write policy) and either enqueues the
// Inngest `export/all` job or, when Inngest is not configured (dev/pilot), runs
// the build inline — the same dual-path pattern as packet-parse. The synchronous
// direct-download route stays as the dev fallback; this path emails a signed link
// (or, with no email key, surfaces a signed link on the export page).

// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
function exportPath(slug: string): string {
  return programPath(slug, "settings/export") ?? "/";
}

// One `?ok=`/`?error=` contract, read back through lib/flash's prototype-safe
// lookup (spec 005 Wave 13 / T164) — `?requested=1` was a param whose only job
// was to print one toast.
function done(slug: string, key: ExportOkKey): string {
  return `${exportPath(slug)}?ok=${key}`;
}

function fail(slug: string, key: ExportErrorKey): string {
  return `${exportPath(slug)}?error=${key}`;
}

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
    redirect(fail(slug, "export"));
  }
  const jobId = (created as { id: string }).id;

  if (inngestEnabled()) {
    await inngest.send({ name: "export/all", data: { jobId, programId } });
  } else {
    // Inline fallback (dev/pilot): build synchronously so the job still completes.
    await runExportJob(jobId, programId);
  }

  revalidatePath(exportPath(slug));
  redirect(done(slug, "requested"));
}
