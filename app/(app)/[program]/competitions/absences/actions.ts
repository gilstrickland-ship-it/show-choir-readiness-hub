"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { notifyAbsenceOutcome } from "@/lib/comms-send";
import { programPath } from "@/lib/return-path";
import type { AbsenceErrorKey, AbsenceOkKey } from "./shared";

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
// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
  return programPath(slug, "competitions/absences") ?? "/";
}

// The queue's one message contract (./shared). Typed by the same key unions the
// page reads, so a code no map defines is a compile error here rather than a
// blank banner there.
function queueOk(slug: string, key: AbsenceOkKey): string {
  return `${queuePath(slug)}?ok=${key}`;
}

function queueFail(slug: string, key: AbsenceErrorKey): string {
  return `${queuePath(slug)}?error=${key}`;
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
  if (!req || req.status !== "pending") redirect(queueFail(slug, "gone"));

  // The request row is ours, but the two ids ON it are references into other
  // program-scoped tables and were written by the parent-facing request flow.
  // Resolve them here too before they become an attendance row: attendance is
  // keyed (competition, student) with no program column, so a bad pair squats a
  // slot nobody in the affected program can see or clear (Constitution I).
  const [{ data: comp }, { data: student }] = await Promise.all([
    supabase
      .from("competitions")
      .select("id")
      .eq("id", req!.competition_id)
      .eq("program_id", programId)
      .maybeSingle(),
    supabase
      .from("students")
      .select("id")
      .eq("id", req!.student_id)
      .eq("program_id", programId)
      .maybeSingle(),
  ]);
  if (!comp || !student) redirect(queueFail(slug, "failed"));

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
    redirect(queueFail(slug, "failed"));
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
    redirect(queueFail(slug, "failed"));
  }

  // Let the reporting guardian know the outcome (best-effort; never blocks).
  await notifyAbsenceOutcome({ programId, requestId: req.id, outcome: "confirmed" });

  revalidatePath(queuePath(slug));
  redirect(queueOk(slug, "confirmed"));
}

export async function dismissAbsence(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const requestId = str(formData, "requestId");
  const { user } = await requireRole(programId, ATTENDANCE_WRITE_ROLES);

  const supabase = await createClient();
  const { data: disData, error: disErr } = await supabase
    .from("absence_requests")
    .update({
      status: "dismissed",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("program_id", programId)
    .eq("status", "pending")
    .select("id");
  if (disErr) {
    console.error("dismissAbsence request update failed", disErr);
    redirect(queueFail(slug, "failed"));
  }

  // Only notify when this call actually transitioned the request (not a re-submit
  // of an already-resolved one). Best-effort; never blocks the staff action.
  if (((disData as { id: string }[] | null) ?? []).length > 0) {
    await notifyAbsenceOutcome({ programId, requestId, outcome: "dismissed" });
  }

  revalidatePath(queuePath(slug));
  redirect(queueOk(slug, "dismissed"));
}
