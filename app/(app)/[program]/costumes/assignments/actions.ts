"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COSTUME_WRITE_ROLES } from "@/lib/costumes";

// Assignment grid mutations (T010). One piece → one student per season, enforced
// by UNIQUE(season_id, piece_id) in 0001 — assigning an already-assigned piece
// re-points it to the new student rather than raising a conflict. director/admin/
// costume_manager write.

export async function assignPiece(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const pieceId = String(formData.get("pieceId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const back = `/${slug}/costumes/assignments?set=${setId}`;
  if (!seasonId || !pieceId || !studentId) {
    redirect(`${back}&error=assign`);
  }

  const supabase = await createClient();

  // The grid's dropdowns were the only thing keeping these four ids consistent,
  // and a form field is not a constraint. Re-derive the whole eligibility list
  // server-side: the set is ours and in this season, the piece is in that set,
  // and the student is a member of the set's ensemble this season. Without this
  // an edited field lands a row on UNIQUE(season_id, piece_id) — a key with no
  // program column — squatting another program's slot permanently (Const. I).
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, ensemble_id")
    .eq("id", setId)
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .maybeSingle();
  const set = setData as { id: string; ensemble_id: string | null } | null;
  if (!set || !set.ensemble_id) redirect(`${back}&error=assign`);

  const [{ data: season }, { data: piece }, { data: member }] = await Promise.all([
    supabase
      .from("seasons")
      .select("id")
      .eq("id", seasonId)
      .eq("program_id", programId)
      .maybeSingle(),
    supabase
      .from("costume_pieces")
      .select("id")
      .eq("id", pieceId)
      .eq("program_id", programId)
      .eq("set_id", set!.id)
      .maybeSingle(),
    supabase
      .from("ensemble_members")
      .select("student_id")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .eq("ensemble_id", set!.ensemble_id)
      .eq("student_id", studentId)
      .maybeSingle(),
  ]);
  if (!season || !piece || !member) redirect(`${back}&error=assign`);

  // Honor UNIQUE(season_id, piece_id): re-point an existing assignment instead
  // of inserting a duplicate. Reassigning to a new student resets the fitting
  // (the garment now needs checking against a different body).
  const { data: existing } = await supabase
    .from("costume_assignments")
    .select("id, student_id")
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .eq("piece_id", pieceId)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; student_id: string };
    if (row.student_id !== studentId) {
      const { error } = await supabase
        .from("costume_assignments")
        .update({
          student_id: studentId,
          alteration_status: "none",
          alteration_notes: null,
          fitted_at: null,
        })
        .eq("id", row.id)
        .eq("program_id", programId);
      if (error) redirect(`${back}&error=assign`);
    }
  } else {
    const { error } = await supabase.from("costume_assignments").insert({
      program_id: programId,
      season_id: seasonId,
      piece_id: pieceId,
      student_id: studentId,
    });
    if (error) redirect(`${back}&error=assign`);
  }

  revalidatePath(`/${slug}/costumes/assignments`);
  redirect(`${back}&saved=1`);
}

export async function unassignPiece(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const back = `/${slug}/costumes/assignments?set=${setId}`;
  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("program_id", programId);

  if (error) redirect(`${back}&error=assign`);
  revalidatePath(`/${slug}/costumes/assignments`);
  redirect(`${back}&saved=1`);
}
