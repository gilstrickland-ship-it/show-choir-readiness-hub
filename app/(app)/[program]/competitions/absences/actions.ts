"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";

// Staff review queue for parent-submitted absence requests (§5, §8a). Confirm
// flips the student's attendance row to 'absent' and stamps the request
// resolved; Dismiss just resolves the request. Writers: director / admin /
// costume_manager (matches the attendance-edit + absence_requests_manage
// gates). No parent-written state reaches attendance without this step
// (Constitution II).

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function queuePath(slug: string): string {
  return `/${slug}/competitions/absences`;
}

export async function confirmAbsence(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const requestId = str(formData, "requestId");
  const { user } = await requireRole(programId, ATTENDANCE_WRITE_ROLES);

  const supabase = await createClient();

  // Load the request (program-scoped) to get competition + student.
  const { data: reqData } = await supabase
    .from("absence_requests")
    .select("id, competition_id, student_id, status")
    .eq("id", requestId)
    .eq("program_id", programId)
    .maybeSingle();
  const req = reqData as
    | { id: string; competition_id: string; student_id: string; status: string }
    | null;
  if (!req || req.status !== "pending") redirect(`${queuePath(slug)}?error=gone`);

  // Flip the attendance row to absent (idempotent upsert on the unique key).
  const { error: attErr } = await supabase.from("attendance").upsert(
    {
      program_id: programId,
      competition_id: req.competition_id,
      student_id: req.student_id,
      status: "absent",
    },
    { onConflict: "competition_id,student_id" },
  );
  if (attErr) {
    console.error("confirmAbsence attendance upsert failed", attErr);
    redirect(`${queuePath(slug)}?error=failed`);
  }

  const { error: updErr } = await supabase
    .from("absence_requests")
    .update({
      status: "confirmed",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", req.id)
    .eq("program_id", programId);
  if (updErr) {
    console.error("confirmAbsence request update failed", updErr);
    redirect(`${queuePath(slug)}?error=failed`);
  }

  revalidatePath(queuePath(slug));
  redirect(`${queuePath(slug)}?done=confirmed`);
}

export async function dismissAbsence(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const requestId = str(formData, "requestId");
  const { user } = await requireRole(programId, ATTENDANCE_WRITE_ROLES);

  const supabase = await createClient();
  const { error: disErr } = await supabase
    .from("absence_requests")
    .update({
      status: "dismissed",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("program_id", programId)
    .eq("status", "pending");
  if (disErr) {
    console.error("dismissAbsence request update failed", disErr);
    redirect(`${queuePath(slug)}?error=failed`);
  }

  revalidatePath(queuePath(slug));
  redirect(`${queuePath(slug)}?done=dismissed`);
}
