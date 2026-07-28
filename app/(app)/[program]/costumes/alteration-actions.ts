"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { programPath } from "@/lib/return-path";
import {
  COSTUME_WRITE_ROLES,
  parseAlterationStatus,
  type AlterationStatus,
} from "@/lib/costumes";

// Alterations-queue mutations: status advance + the fitting note on a
// costume_assignment. Reaching 'done' stamps fitted_at; leaving 'done' clears
// it. director/admin/costume_manager write.
//
// Two surfaces call these — the queue itself (the Wardrobe landing) and the
// assignment grid — so a `from` KEY says which, and the path is built here.
// It used to be a `back` PATH read straight off the form and prefix-matched,
// with a default pointing at /costumes/alterations: a route that existed only
// to redirect to /costumes, kept alive by this default. The key removes both
// the stub and the client-supplied target (Constitution I).

function landing(slug: string): string {
  return programPath(slug, "costumes") ?? "/";
}

function assignmentsPath(slug: string): string {
  return programPath(slug, "costumes/assignments") ?? "/";
}

// Where this call came from, and where its message belongs. The grid's controls
// live inside one row's panel, so a failure reopens that row rather than
// shouting from the top of a page the writer then has to re-find their row on.
function targets(
  formData: FormData,
  slug: string,
  assignmentId: string,
): { ok: string; fail: (code: string) => string } {
  const setId = String(formData.get("setId") ?? "").trim();
  const pieceId = String(formData.get("pieceId") ?? "").trim();
  if (String(formData.get("from") ?? "").trim() === "assignments" && setId) {
    const here = `${assignmentsPath(slug)}?set=${setId}`;
    return {
      ok: `${here}&saved=1`,
      fail: (code) => `${here}&edit=${pieceId}&error=${code}`,
    };
  }
  const base = landing(slug);
  return {
    ok: `${base}?saved=1`,
    fail: (code) => `${base}?edit=${assignmentId}&error=${code}`,
  };
}

// The assignment id is posted by the form, and `costume_assignments` sits under
// UNIQUE(season_id, piece_id) — a key with no program column — so it is proven
// to belong to this program before anything is written through it.
async function resolveAssignment(
  supabase: SupabaseClient,
  programId: string,
  assignmentId: string,
): Promise<string | null> {
  if (!assignmentId) return null;
  const { data } = await supabase
    .from("costume_assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function setAlterationStatus(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const { ok, fail } = targets(formData, slug, assignmentId);
  const status = parseAlterationStatus(String(formData.get("status") ?? ""));
  if (!status) redirect(fail("alteration"));

  const supabase = await createClient();
  if (!(await resolveAssignment(supabase, programId, assignmentId))) {
    redirect(fail("alteration"));
  }

  // fitted_at is the "done" stamp; keep it in lockstep with the status.
  const patch: { alteration_status: AlterationStatus; fitted_at: string | null } = {
    alteration_status: status,
    fitted_at: status === "done" ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from("costume_assignments")
    .update(patch)
    .eq("id", assignmentId)
    .eq("program_id", programId);

  if (error) redirect(fail("alteration"));
  revalidatePath(ok.split("?")[0]);
  redirect(ok);
}

export async function updateAlterationNotes(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const { ok, fail } = targets(formData, slug, assignmentId);
  const notes = String(formData.get("alteration_notes") ?? "").trim() || null;

  const supabase = await createClient();
  if (!(await resolveAssignment(supabase, programId, assignmentId))) {
    redirect(fail("alteration"));
  }

  const { error } = await supabase
    .from("costume_assignments")
    .update({ alteration_notes: notes })
    .eq("id", assignmentId)
    .eq("program_id", programId);

  if (error) redirect(fail("alteration"));
  revalidatePath(ok.split("?")[0]);
  redirect(ok);
}
