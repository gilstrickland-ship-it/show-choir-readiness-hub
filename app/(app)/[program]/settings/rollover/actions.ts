"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { returnPath } from "@/lib/return-path";

// Season rollover wizard actions (§3, §9.4, T028). Every step is a director/admin
// server action that re-checks the role (Constitution I) and is idempotent /
// re-runnable — a director can back up and re-submit any step without creating
// duplicates or double-activating a season. Ensembles are program-level (§4), so
// they carry forward automatically; the season-scoped work is re-adding students
// (ensemble_members), copying costume set names, and flipping the active season.
//
// The wizard is now ROLLOVER-only (spec 005 US3): starting a first season is one
// submit on the Season/Today card, which calls startFirstSeason below. Both use
// the same two primitives, so there is one implementation of "make a season" and
// one of "make it the active one".

type Db = Awaited<ReturnType<typeof createClient>>;

function wizardPath(slug: string, step: string, newSeasonId: string): string {
  return `/${slug}/settings/rollover?step=${step}&newSeason=${newSeasonId}`;
}

// Insert a season, or reuse the same-label one that is already there (which is
// what makes every caller re-runnable). Returns its id, or null on failure.
async function findOrCreateSeason(
  supabase: Db,
  args: {
    programId: string;
    label: string;
    startsOn: string | null;
    endsOn: string | null;
  },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("seasons")
    .select("id")
    .eq("program_id", args.programId)
    .eq("label", args.label)
    .maybeSingle();
  const existingId = (existing as { id: string } | null)?.id ?? null;
  if (existingId) return existingId;

  const { data: created, error } = await supabase
    .from("seasons")
    .insert({
      program_id: args.programId,
      label: args.label,
      starts_on: args.startsOn,
      ends_on: args.endsOn,
      is_active: false,
    })
    .select("id")
    .single();
  if (error || !created) return null;
  return (created as { id: string }).id;
}

// Flip the active season atomically: clear whatever is active, then set this
// one. The partial unique index (one active season per program) guards against a
// double-active state; clearing first keeps the flip valid and a re-run a no-op.
async function makeSeasonActive(
  supabase: Db,
  programId: string,
  seasonId: string,
): Promise<boolean> {
  const { error: clearErr } = await supabase
    .from("seasons")
    .update({ is_active: false })
    .eq("program_id", programId)
    .eq("is_active", true)
    .neq("id", seasonId);
  if (clearErr) return false;

  const { error: setErr } = await supabase
    .from("seasons")
    .update({ is_active: true })
    .eq("program_id", programId)
    .eq("id", seasonId);
  return !setErr;
}

// Start your season (spec 005 US3) — the first-run path, one submit. A brand-new
// director used to be routed into the six-step ROLLOVER wizard for what is one
// insert plus one activation. `from` is an allow-listed key resolved server-side
// (lib/return-path), never a client-supplied URL, so the director lands back on
// whichever surface asked.
export async function startFirstSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const back =
    returnPath(slug, String(formData.get("from") ?? "")) ?? `/${slug}/dashboard`;

  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect(`${back}?seasonError=label`);

  const supabase = await createClient();

  // This card only renders for a program with NO seasons. If one appeared in the
  // meantime (a second tab, the wizard), WHICH season should be active is a
  // human decision — send them to Settings rather than guess.
  const { count } = await supabase
    .from("seasons")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  if ((count ?? 0) > 0) redirect(`${back}?seasonError=exists`);

  const seasonId = await findOrCreateSeason(supabase, {
    programId,
    label,
    startsOn: String(formData.get("starts_on") ?? "").trim() || null,
    endsOn: String(formData.get("ends_on") ?? "").trim() || null,
  });
  if (!seasonId) redirect(`${back}?seasonError=create`);

  const activated = await makeSeasonActive(supabase, programId, seasonId);
  if (!activated) redirect(`${back}?seasonError=activate`);

  // The season label rides in the app-shell header, so revalidate the layout.
  revalidatePath(`/${slug}`, "layout");
  redirect(`${back}?seasonStarted=1`);
}

// Step 1 — create the new (inactive, unarchived) season.
export async function createRolloverSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const label = String(formData.get("label") ?? "").trim();
  if (!label) {
    redirect(`/${slug}/settings/rollover?error=label`);
  }

  const supabase = await createClient();
  const newSeasonId = await findOrCreateSeason(supabase, {
    programId,
    label,
    startsOn: String(formData.get("starts_on") ?? "").trim() || null,
    endsOn: String(formData.get("ends_on") ?? "").trim() || null,
  });
  if (!newSeasonId) {
    redirect(`/${slug}/settings/rollover?error=create`);
  }

  // Nothing to carry over? Then the ensembles / returning-students / costume
  // steps have no source data — go straight to activate. Counting seasons other
  // than the one we just made keeps this idempotent: a re-run reuses the same
  // season and still lands on activate.
  const { count: priorCount } = await supabase
    .from("seasons")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId)
    .neq("id", newSeasonId);
  const nextStep = (priorCount ?? 0) === 0 ? "activate" : "ensembles";

  revalidatePath(`/${slug}/settings/rollover`);
  redirect(wizardPath(slug, nextStep, newSeasonId));
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

// Step 5 — make the new season the active one (see makeSeasonActive above).
export async function activateNewSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const newSeasonId = String(formData.get("newSeasonId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const supabase = await createClient();
  const activated = await makeSeasonActive(supabase, programId, newSeasonId);
  if (!activated) {
    redirect(
      `/${slug}/settings/rollover?step=activate&newSeason=${newSeasonId}&error=activate`,
    );
  }

  revalidatePath(`/${slug}`, "layout");
  redirect(wizardPath(slug, "archive", newSeasonId));
}
