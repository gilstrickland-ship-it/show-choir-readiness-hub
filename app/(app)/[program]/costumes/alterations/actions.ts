"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  COSTUME_WRITE_ROLES,
  ALTERATION_STATUSES,
  type AlterationStatus,
} from "@/lib/costumes";

// Alterations-queue mutations (T010). Quick status-advance + notes edit on a
// costume_assignment. Reaching 'done' stamps fitted_at; leaving 'done' clears it.
// director/admin/costume_manager write. `back` carries the caller's return path
// (the alterations queue or the assignment grid).

function parseStatus(raw: string): AlterationStatus | null {
  return (ALTERATION_STATUSES as readonly string[]).includes(raw)
    ? (raw as AlterationStatus)
    : null;
}

function backTarget(slug: string, back: string): string {
  // Only allow the two known in-app return paths; default to the queue. `back`
  // may already carry a query string (e.g. the grid's ?set=…), so callers use
  // withParam() to append status flags with the correct separator.
  if (back.startsWith(`/${slug}/costumes/assignments`)) return back;
  return `/${slug}/costumes/alterations`;
}

function withParam(target: string, param: string): string {
  const sep = target.includes("?") ? "&" : "?";
  return `${target}${sep}${param}`;
}

export async function setAlterationStatus(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const status = parseStatus(String(formData.get("status") ?? ""));
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const target = backTarget(slug, String(formData.get("back") ?? ""));
  if (!status) {
    redirect(withParam(target, "error=alteration"));
  }

  const supabase = await createClient();
  const patch: {
    alteration_status: AlterationStatus;
    fitted_at?: string | null;
  } = { alteration_status: status };
  // fitted_at is the "done" stamp; keep it in lockstep with the status.
  if (status === "done") patch.fitted_at = new Date().toISOString();
  else patch.fitted_at = null;

  const { error } = await supabase
    .from("costume_assignments")
    .update(patch)
    .eq("id", assignmentId)
    .eq("program_id", programId);

  if (error) redirect(withParam(target, "error=alteration"));
  revalidatePath(target.split("?")[0]);
  redirect(withParam(target, "saved=1"));
}

export async function updateAlterationNotes(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const target = backTarget(slug, String(formData.get("back") ?? ""));
  const notes = String(formData.get("alteration_notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_assignments")
    .update({ alteration_notes: notes })
    .eq("id", assignmentId)
    .eq("program_id", programId);

  if (error) redirect(withParam(target, "error=alteration"));
  revalidatePath(target.split("?")[0]);
  redirect(withParam(target, "saved=1"));
}
