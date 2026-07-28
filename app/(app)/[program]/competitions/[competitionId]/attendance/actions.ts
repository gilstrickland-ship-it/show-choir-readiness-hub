"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  ATTENDANCE_WRITE_ROLES,
  ATTENDANCE_STATUSES,
  resolveCompetitionId,
} from "@/lib/competitions";
import { programPath } from "@/lib/return-path";

// Attendance edit (§5, T012). Writers: director/admin/costume_manager (matrix
// "Attendance edit"). Upsert one row per (competition, student); the note rides
// along with whichever status button was tapped.
export async function setAttendance(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const competitionId = String(formData.get("competitionId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  await requireRole(programId, ATTENDANCE_WRITE_ROLES);

  const status = String(formData.get("status") ?? "expected");
  const safeStatus = (ATTENDANCE_STATUSES as readonly string[]).includes(status)
    ? status
    : "expected";
  const note = String(formData.get("note") ?? "").trim() || null;

// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
  const path =
    programPath(slug, `competitions/${competitionId}/attendance`) ?? "/";
  const supabase = await createClient();

  // Both ids come off the form. The row's unique key is (competition, student)
  // with no program column, so an unresolved pair here squats a slot in another
  // program's roster that they can neither see nor clear (Constitution I).
  const [comp, { data: student }] = await Promise.all([
    resolveCompetitionId(supabase, programId, competitionId),
    supabase
      .from("students")
      .select("id")
      .eq("id", studentId)
      .eq("program_id", programId)
      .maybeSingle(),
  ]);
  if (!comp || !student) redirect(`${path}?error=save`);

  const { error } = await supabase
    .from("attendance")
    .upsert(
      {
        program_id: programId,
        competition_id: competitionId,
        student_id: studentId,
        status: safeStatus,
        note,
      },
      { onConflict: "competition_id,student_id" },
    );
  // A swallowed error here is a tap that silently does nothing, forever.
  if (error) redirect(`${path}?error=save`);

  revalidatePath(path);
  redirect(path);
}
