"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";

// Ensembles CRUD + season-scoped membership (T007). Ensembles are program-scoped;
// ensemble_members are season-scoped (a student can be in multiple ensembles in a
// season — UNIQUE(season_id, ensemble_id, student_id) holds). director/admin only.

const MEMBER_ROLES = ["performer", "band", "crew", "manager"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

function parseSortOrder(raw: string): number {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Ensembles
// ---------------------------------------------------------------------------

export async function addEnsemble(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect(`/${slug}/roster/ensembles?error=name`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ensembles").insert({
    program_id: programId,
    name,
    sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
  });

  if (error) {
    redirect(`/${slug}/roster/ensembles?error=save`);
  }
  revalidatePath(`/${slug}/roster/ensembles`);
  redirect(`/${slug}/roster/ensembles?saved=1`);
}

export async function updateEnsemble(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const ensembleId = String(formData.get("ensembleId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect(`/${slug}/roster/ensembles?error=name`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ensembles")
    .update({ name, sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")) })
    .eq("id", ensembleId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/ensembles?error=save`);
  }
  revalidatePath(`/${slug}/roster/ensembles`);
  redirect(`/${slug}/roster/ensembles?saved=1`);
}

// Delete an ensemble. Blocked when anything references it (members in any season,
// costume sets, competitions) — a foreign-key violation surfaces as a friendly
// "in use" message rather than a 500.
export async function deleteEnsemble(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const ensembleId = String(formData.get("ensembleId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ensembles")
    .delete()
    .eq("id", ensembleId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/ensembles?error=in_use`);
  }
  revalidatePath(`/${slug}/roster/ensembles`);
  redirect(`/${slug}/roster/ensembles?saved=1`);
}

// ---------------------------------------------------------------------------
// Season-scoped members
// ---------------------------------------------------------------------------

export async function addMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const ensembleId = String(formData.get("ensembleId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const studentId = String(formData.get("studentId") ?? "");
  const memberRole = String(formData.get("role") ?? "performer") as MemberRole;
  if (!studentId || !seasonId || !MEMBER_ROLES.includes(memberRole)) {
    redirect(`/${slug}/roster/ensembles/${ensembleId}?error=member`);
  }

  const supabase = await createClient();

  // All three ids arrive from the form, and the write policy checks only the
  // row's own program_id — so resolve each one inside THIS program before the
  // insert (Constitution I). Without this, a membership row can be stamped onto
  // another program's season/ensemble/student: invisible to them, undeletable by
  // them, and squatting the (season, ensemble, student) slot they need.
  const inProgram = async (table: string, id: string): Promise<boolean> => {
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("program_id", programId)
      .maybeSingle();
    return Boolean(data);
  };
  const [seasonOk, ensembleOk, studentOk] = await Promise.all([
    inProgram("seasons", seasonId),
    inProgram("ensembles", ensembleId),
    inProgram("students", studentId),
  ]);
  if (!seasonOk || !ensembleOk || !studentOk) {
    redirect(`/${slug}/roster/ensembles/${ensembleId}?error=member`);
  }

  const { error } = await supabase.from("ensemble_members").insert({
    program_id: programId,
    season_id: seasonId,
    ensemble_id: ensembleId,
    student_id: studentId,
    role: memberRole,
    voice_part: String(formData.get("voice_part") ?? "").trim() || null,
  });

  if (error) {
    // UNIQUE(season, ensemble, student) → already a member.
    redirect(`/${slug}/roster/ensembles/${ensembleId}?error=duplicate`);
  }
  revalidatePath(`/${slug}/roster/ensembles/${ensembleId}`);
  redirect(`/${slug}/roster/ensembles/${ensembleId}?saved=1`);
}

export async function updateMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const ensembleId = String(formData.get("ensembleId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const memberRole = String(formData.get("role") ?? "performer") as MemberRole;
  if (!MEMBER_ROLES.includes(memberRole)) {
    redirect(`/${slug}/roster/ensembles/${ensembleId}?error=member`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ensemble_members")
    .update({
      role: memberRole,
      voice_part: String(formData.get("voice_part") ?? "").trim() || null,
    })
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/ensembles/${ensembleId}?error=member`);
  }
  revalidatePath(`/${slug}/roster/ensembles/${ensembleId}`);
  redirect(`/${slug}/roster/ensembles/${ensembleId}?saved=1`);
}

export async function removeMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const ensembleId = String(formData.get("ensembleId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ensemble_members")
    .delete()
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/ensembles/${ensembleId}?error=member`);
  }
  revalidatePath(`/${slug}/roster/ensembles/${ensembleId}`);
  redirect(`/${slug}/roster/ensembles/${ensembleId}?saved=1`);
}
