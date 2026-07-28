"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { programPath } from "@/lib/return-path";
import {
  isMemberRole,
  ensembleAnchor,
  memberAnchor,
} from "@/lib/roster/ensembles";

// Ensembles CRUD + season-scoped membership (T007). Ensembles are program-scoped;
// ensemble_members are season-scoped (a student can be in multiple ensembles in a
// season — UNIQUE(season_id, ensemble_id, student_id) holds). director/admin only,
// re-checked here as well as by RLS (Constitution I, defense in depth).
//
// Every id below arrives as a form field and is resolved inside programId before
// anything is written: requireRole proves the caller runs THIS program, not that
// the row they posted belongs to it.

// Fail closed on the slug — a value like "/evil.com" interpolated into a path
// makes a protocol-relative URL the browser follows off-site (lib/return-path).
function ensemblesPath(slug: string, sub?: string): string {
  return (
    programPath(slug, sub ? `roster/ensembles/${sub}` : "roster/ensembles") ?? "/"
  );
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function parseSortOrder(raw: string): number {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : 0;
}

async function inProgram(
  supabase: SupabaseClient,
  table: string,
  programId: string,
  id: string,
): Promise<boolean> {
  if (!id) return false;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Ensembles
// ---------------------------------------------------------------------------

export async function addEnsemble(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const list = ensemblesPath(slug);
  const name = str(formData, "name");
  if (!name) {
    redirect(`${list}?error=name`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ensembles").insert({
    program_id: programId,
    name,
    sort_order: parseSortOrder(str(formData, "sort_order")),
  });

  if (error) {
    redirect(`${list}?error=save`);
  }
  revalidatePath(list);
  redirect(`${list}?saved=1`);
}

export async function updateEnsemble(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const ensembleId = str(formData, "ensembleId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const list = ensemblesPath(slug);
  // A refusal that belongs to ONE row reopens that row's panel, so the message
  // lands inside the panel that produced it.
  const fail = (code: string): string =>
    `${list}?error=${code}&edit=${encodeURIComponent(ensembleId)}#${ensembleAnchor(ensembleId)}`;

  const name = str(formData, "name");
  if (!name) redirect(fail("name"));

  const supabase = await createClient();
  if (!(await inProgram(supabase, "ensembles", programId, ensembleId))) {
    redirect(`${list}?error=gone`);
  }

  const { error } = await supabase
    .from("ensembles")
    .update({ name, sort_order: parseSortOrder(str(formData, "sort_order")) })
    .eq("id", ensembleId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));
  revalidatePath(list);
  redirect(`${list}?saved=1`);
}

// Delete an ensemble. Blocked when anything references it (members in any season,
// costume sets, competitions) — a foreign-key violation surfaces as a friendly
// "in use" message inside the row's own panel rather than a 500.
export async function deleteEnsemble(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const ensembleId = str(formData, "ensembleId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const list = ensemblesPath(slug);
  const supabase = await createClient();
  if (!(await inProgram(supabase, "ensembles", programId, ensembleId))) {
    redirect(`${list}?error=gone`);
  }

  const { error } = await supabase
    .from("ensembles")
    .delete()
    .eq("id", ensembleId)
    .eq("program_id", programId);

  if (error) {
    redirect(
      `${list}?error=in_use&edit=${encodeURIComponent(ensembleId)}#${ensembleAnchor(ensembleId)}`,
    );
  }
  revalidatePath(list);
  redirect(`${list}?saved=1`);
}

// ---------------------------------------------------------------------------
// Season-scoped members
// ---------------------------------------------------------------------------

export async function addMember(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const ensembleId = str(formData, "ensembleId");
  const seasonId = str(formData, "seasonId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const page = ensemblesPath(slug, ensembleId);
  const studentId = str(formData, "studentId");
  const memberRole = str(formData, "role");
  if (!studentId || !seasonId || !isMemberRole(memberRole)) {
    redirect(`${page}?error=member`);
  }

  const supabase = await createClient();

  // All three ids arrive from the form, and the write policy checks only the
  // row's own program_id — so resolve each one inside THIS program before the
  // insert (Constitution I). Without this, a membership row can be stamped onto
  // another program's season/ensemble/student: invisible to them, undeletable by
  // them, and squatting the (season, ensemble, student) slot they need.
  const [seasonOk, ensembleOk, studentOk] = await Promise.all([
    inProgram(supabase, "seasons", programId, seasonId),
    inProgram(supabase, "ensembles", programId, ensembleId),
    inProgram(supabase, "students", programId, studentId),
  ]);
  if (!seasonOk || !ensembleOk || !studentOk) {
    redirect(`${page}?error=member`);
  }

  const { error } = await supabase.from("ensemble_members").insert({
    program_id: programId,
    season_id: seasonId,
    ensemble_id: ensembleId,
    student_id: studentId,
    role: memberRole,
    voice_part: str(formData, "voice_part") || null,
  });

  if (error) {
    // UNIQUE(season, ensemble, student) → already a member.
    redirect(`${page}?error=duplicate`);
  }
  revalidatePath(page);
  redirect(`${page}?saved=1`);
}

export async function updateMember(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const ensembleId = str(formData, "ensembleId");
  const memberId = str(formData, "memberId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const page = ensemblesPath(slug, ensembleId);
  const fail = (code: string): string =>
    `${page}?error=${code}&edit=${encodeURIComponent(memberId)}#${memberAnchor(memberId)}`;

  const memberRole = str(formData, "role");
  if (!isMemberRole(memberRole)) redirect(fail("member"));

  const supabase = await createClient();
  if (!(await inProgram(supabase, "ensemble_members", programId, memberId))) {
    redirect(`${page}?error=member_gone`);
  }

  const { error } = await supabase
    .from("ensemble_members")
    .update({
      role: memberRole,
      voice_part: str(formData, "voice_part") || null,
    })
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) redirect(fail("member"));
  revalidatePath(page);
  redirect(`${page}?saved=1`);
}

export async function removeMember(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const ensembleId = str(formData, "ensembleId");
  const memberId = str(formData, "memberId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const page = ensemblesPath(slug, ensembleId);
  const supabase = await createClient();
  if (!(await inProgram(supabase, "ensemble_members", programId, memberId))) {
    redirect(`${page}?error=member_gone`);
  }

  const { error } = await supabase
    .from("ensemble_members")
    .delete()
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(
      `${page}?error=member&edit=${encodeURIComponent(memberId)}#${memberAnchor(memberId)}`,
    );
  }
  revalidatePath(page);
  redirect(`${page}?saved=1`);
}
