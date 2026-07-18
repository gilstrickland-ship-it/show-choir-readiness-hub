"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";

// Season rollover wizard actions (§3, §9.4, T028). Every step is a director/admin
// server action that re-checks the role (Constitution I) and is idempotent /
// re-runnable — a director can back up and re-submit any step without creating
// duplicates or double-activating a season. Ensembles are program-level (§4), so
// they carry forward automatically; the season-scoped work is re-adding students
// (ensemble_members), re-pointing costume sets, and flipping the active season.

function wizardPath(slug: string, step: string, newSeasonId: string): string {
  return `/${slug}/settings/rollover?step=${step}&newSeason=${newSeasonId}`;
}

// Step 1 — create the new (inactive, unarchived) season.
export async function createRolloverSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const label = String(formData.get("label") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "").trim() || null;
  const endsOn = String(formData.get("ends_on") ?? "").trim() || null;
  if (!label) {
    redirect(`/${slug}/settings/rollover?error=label`);
  }

  const supabase = await createClient();

  // Idempotent: reuse an existing same-label season rather than creating a twin.
  const { data: existing } = await supabase
    .from("seasons")
    .select("id")
    .eq("program_id", programId)
    .eq("label", label)
    .maybeSingle();

  let newSeasonId = (existing as { id: string } | null)?.id ?? null;
  if (!newSeasonId) {
    const { data: created, error } = await supabase
      .from("seasons")
      .insert({
        program_id: programId,
        label,
        starts_on: startsOn,
        ends_on: endsOn,
        is_active: false,
      })
      .select("id")
      .single();
    if (error || !created) {
      redirect(`/${slug}/settings/rollover?error=create`);
    }
    newSeasonId = (created as { id: string }).id;
  }

  revalidatePath(`/${slug}/settings/rollover`);
  redirect(wizardPath(slug, "ensembles", newSeasonId));
}

// Step 2 — ensembles carry forward automatically (program-level). This is a
// confirmation step; it only advances the wizard.
export async function confirmEnsembles(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const newSeasonId = String(formData.get("newSeasonId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);
  redirect(wizardPath(slug, "students", newSeasonId));
}

// Step 3 — returning-students checklist. Checked students are re-added to their
// chosen ensemble in the new season (idempotent upsert); unchecked active
// students are marked 'graduated'. Runs against the new season only, so the
// current season's history is untouched.
export async function rolloverStudents(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const newSeasonId = String(formData.get("newSeasonId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const studentIds = formData.getAll("student").map(String);

  const supabase = await createClient();

  const returning: { student_id: string; ensemble_id: string }[] = [];
  const graduating: string[] = [];
  for (const sid of studentIds) {
    const keep = formData.get(`return_${sid}`) === "on";
    if (keep) {
      const ensembleId = String(formData.get(`ensemble_${sid}`) ?? "").trim();
      if (ensembleId) returning.push({ student_id: sid, ensemble_id: ensembleId });
    } else {
      graduating.push(sid);
    }
  }

  if (returning.length > 0) {
    const rows = returning.map((r) => ({
      program_id: programId,
      season_id: newSeasonId,
      ensemble_id: r.ensemble_id,
      student_id: r.student_id,
      role: "performer" as const,
    }));
    // Idempotent — the (season, ensemble, student) unique index dedupes re-runs.
    await supabase
      .from("ensemble_members")
      .upsert(rows, {
        onConflict: "season_id,ensemble_id,student_id",
        ignoreDuplicates: true,
      });
  }

  if (graduating.length > 0) {
    await supabase
      .from("students")
      .update({ status: "graduated" })
      .eq("program_id", programId)
      .in("id", graduating);
  }

  revalidatePath(`/${slug}/settings/rollover`);
  redirect(wizardPath(slug, "costumes", newSeasonId));
}

// Step 4 — re-point costume sets: create an empty set in the new season for each
// set that existed in the current season (same name/ensemble/sort). Pieces stay
// program-level inventory (§4) and are re-assigned in the costume screens later.
// Idempotent: sets already present in the new season are skipped.
export async function repointCostumeSets(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const newSeasonId = String(formData.get("newSeasonId") ?? "");
  const fromSeasonId = String(formData.get("fromSeasonId") ?? "").trim() || null;
  const skip = formData.get("skip") === "1";
  await requireRole(programId, SETTINGS_ROLES);

  if (!skip && fromSeasonId) {
    const supabase = await createClient();
    const { data: oldSets } = await supabase
      .from("costume_sets")
      .select("name, ensemble_id, sort_order, notes")
      .eq("program_id", programId)
      .eq("season_id", fromSeasonId);
    const { data: newSets } = await supabase
      .from("costume_sets")
      .select("name, ensemble_id")
      .eq("program_id", programId)
      .eq("season_id", newSeasonId);
    const have = new Set(
      ((newSets as { name: string; ensemble_id: string | null }[] | null) ?? []).map(
        (s) => `${s.ensemble_id ?? ""}::${s.name}`,
      ),
    );
    const toInsert = (
      (oldSets as
        | { name: string; ensemble_id: string | null; sort_order: number; notes: string | null }[]
        | null) ?? []
    )
      .filter((s) => !have.has(`${s.ensemble_id ?? ""}::${s.name}`))
      .map((s) => ({
        program_id: programId,
        season_id: newSeasonId,
        ensemble_id: s.ensemble_id,
        name: s.name,
        sort_order: s.sort_order,
        notes: s.notes,
      }));
    if (toInsert.length > 0) {
      await supabase.from("costume_sets").insert(toInsert);
    }
  }

  revalidatePath(`/${slug}/settings/rollover`);
  redirect(wizardPath(slug, "activate", newSeasonId));
}

// Step 5 — activate the new season atomically: clear whatever is active, then set
// the new season active. The partial unique index (one active season per program)
// guards against a double-active state; clearing first keeps the flip valid and
// makes a re-run a no-op.
export async function activateNewSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const newSeasonId = String(formData.get("newSeasonId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const supabase = await createClient();
  // Clear the current active season (if any) first — the partial unique index
  // forbids two active seasons, so this ordering keeps the transition legal.
  const { error: clearErr } = await supabase
    .from("seasons")
    .update({ is_active: false })
    .eq("program_id", programId)
    .eq("is_active", true)
    .neq("id", newSeasonId);
  if (clearErr) {
    redirect(`/${slug}/settings/rollover?step=activate&newSeason=${newSeasonId}&error=activate`);
  }
  const { error: setErr } = await supabase
    .from("seasons")
    .update({ is_active: true })
    .eq("program_id", programId)
    .eq("id", newSeasonId);
  if (setErr) {
    redirect(`/${slug}/settings/rollover?step=activate&newSeason=${newSeasonId}&error=activate`);
  }

  revalidatePath(`/${slug}`, "layout");
  redirect(wizardPath(slug, "archive", newSeasonId));
}
