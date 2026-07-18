"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ATTENDANCE_WRITE_ROLES, ATTENDANCE_STATUSES } from "@/lib/competitions";

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

  const supabase = await createClient();
  await supabase
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

  revalidatePath(`/${slug}/competitions/${competitionId}/attendance`);
  redirect(`/${slug}/competitions/${competitionId}/attendance`);
}
