"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { returnPath, programPath, programRoot } from "@/lib/return-path";

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

// Every path this file builds runs through programPath: `slug` arrives as a form
// field, and a value like "/evil.com" interpolated into a path makes a
// protocol-relative URL the browser follows off-site (spec 005 T143a).
function rolloverPath(slug: string): string {
  return programPath(slug, "settings/rollover") ?? "/";
}

// The tenant shell — what `revalidatePath(…, "layout")` refreshes when the
// active season changes, since the header prints its label.
function shellPath(slug: string): string {
  return programRoot(slug) ?? "/";
}

function wizardPath(slug: string, step: string, newSeasonId: string): string {
  return `${rolloverPath(slug)}?step=${step}&newSeason=${newSeasonId}`;
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
  const existingId = await seasonIdByLabel(supabase, args.programId, args.label);
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
  if (!error && created) return (created as { id: string }).id;

  // The insert lost. Two submits arriving together (a double click, a retried
  // POST) both clear the check above, and nothing in the schema stops the second
  // — so instead of failing the director who pressed twice, look again: if the
  // season is there now, that IS the season they asked for.
  return seasonIdByLabel(supabase, args.programId, args.label);
}

// The id of this program's season with that label, if it has one. `limit(1)`
// rather than a bare maybeSingle so a program that somehow ended up with two
// same-label seasons resolves to one instead of erroring.
async function seasonIdByLabel(
  supabase: Db,
  programId: string,
  label: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("seasons")
    .select("id")
    .eq("program_id", programId)
    .eq("label", label)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// True when that season really is this program's. newSeasonId travels the wizard
// as a hidden field, and every season-scoped row a step writes carries only the
// row's own program_id for the write policy to check — so a tampered season id
// would let rows be stamped into another program's season, invisible to them and
// frozen the moment they archive it (Constitution I). Each step that writes
// re-checks, because each step is its own POST.
async function seasonInProgram(
  supabase: Db,
  programId: string,
  seasonId: string,
): Promise<boolean> {
  if (!seasonId) return false;
  const { data } = await supabase
    .from("seasons")
    .select("id")
    .eq("id", seasonId)
    .eq("program_id", programId)
    .maybeSingle();
  return Boolean(data);
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

  // Fail closed on the slug too: it arrives as a form field, and a value like
  // "/evil.com" interpolated into a path makes a protocol-relative URL the
  // browser happily follows off-site (lib/return-path).
  const back =
    returnPath(slug, String(formData.get("from") ?? "")) ??
    programPath(slug, "dashboard") ??
    "/";

  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect(`${back}?seasonError=label`);

  const supabase = await createClient();

  // This card only renders for a program with NO seasons. If one appeared in the
  // meantime it is usually the director's own second submit, which already did
  // exactly this — say "done", not "something went wrong". Anything else (a
  // season from another tab, from the wizard) is a real human decision about
  // WHICH season should be active, so that goes to Settings.
  const { data: existingData } = await supabase
    .from("seasons")
    .select("id, label, is_active")
    .eq("program_id", programId);
  const existing =
    (existingData as { id: string; label: string; is_active: boolean }[] | null) ??
    [];
  if (existing.length > 0) {
    const alreadyDone = existing.some((s) => s.label === label && s.is_active);
    if (alreadyDone) {
      revalidatePath(shellPath(slug), "layout");
      redirect(`${back}?seasonStarted=1`);
    }
    redirect(`${back}?seasonError=exists`);
  }

  const seasonId = await findOrCreateSeason(supabase, {
    programId,
    label,
    startsOn: String(formData.get("starts_on") ?? "").trim() || null,
    endsOn: String(formData.get("ends_on") ?? "").trim() || null,
  });
  if (!seasonId) redirect(`${back}?seasonError=create`);

  const activated = await makeSeasonActive(supabase, programId, seasonId);
  if (!activated) {
    // The one-active-season index is what makes a simultaneous flip fail, so a
    // failure here often means the other submit won. If the program has an
    // active season now, the job is done however it got done.
    const { data: active } = await supabase
      .from("seasons")
      .select("id")
      .eq("program_id", programId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!active) redirect(`${back}?seasonError=activate`);
  }

  // The season label rides in the app-shell header, so revalidate the layout.
  revalidatePath(shellPath(slug), "layout");
  redirect(`${back}?seasonStarted=1`);
}

// Step 1 — create the new (inactive, unarchived) season.
export async function createRolloverSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const label = String(formData.get("label") ?? "").trim();
  if (!label) {
    redirect(`${rolloverPath(slug)}?error=label`);
  }

  const supabase = await createClient();
  const newSeasonId = await findOrCreateSeason(supabase, {
    programId,
    label,
    startsOn: String(formData.get("starts_on") ?? "").trim() || null,
    endsOn: String(formData.get("ends_on") ?? "").trim() || null,
  });
  if (!newSeasonId) {
    redirect(`${rolloverPath(slug)}?error=create`);
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

  revalidatePath(rolloverPath(slug));
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

  if (!(await seasonInProgram(supabase, programId, newSeasonId))) {
    redirect(`${rolloverPath(slug)}?error=season`);
  }

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
    // The checklist posts a student id and an ensemble id per row, so both are
    // client-supplied. Re-derive the eligible sets from the program itself and
    // drop anything outside them: an ensemble_members row pointing at another
    // program's student or ensemble is invisible to that program AND squats
    // their (season, ensemble, student) slot, so their own rollover silently
    // loses the student. `graduating` below is already program-scoped by its
    // update — this brings the upsert to the same standard.
    const ours = async (table: string, ids: string[]): Promise<Set<string>> => {
      const unique = Array.from(new Set(ids));
      if (unique.length === 0) return new Set();
      const { data } = await supabase
        .from(table)
        .select("id")
        .eq("program_id", programId)
        .in("id", unique);
      return new Set(((data as { id: string }[] | null) ?? []).map((r) => r.id));
    };
    const [ourStudents, ourEnsembles] = await Promise.all([
      ours("students", returning.map((r) => r.student_id)),
      ours("ensembles", returning.map((r) => r.ensemble_id)),
    ]);

    const rows = returning
      .filter(
        (r) => ourStudents.has(r.student_id) && ourEnsembles.has(r.ensemble_id),
      )
      .map((r) => ({
        program_id: programId,
        season_id: newSeasonId,
        ensemble_id: r.ensemble_id,
        student_id: r.student_id,
        role: "performer" as const,
      }));

    // Idempotent — the (season, ensemble, student) unique index dedupes re-runs.
    if (rows.length > 0) {
      await supabase.from("ensemble_members").upsert(rows, {
        onConflict: "season_id,ensemble_id,student_id",
        ignoreDuplicates: true,
      });
    }
  }

  if (graduating.length > 0) {
    await supabase
      .from("students")
      .update({ status: "graduated" })
      .eq("program_id", programId)
      .in("id", graduating);
  }

  revalidatePath(rolloverPath(slug));
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
    // The reads below are already program-scoped; the INSERT stamps the posted
    // newSeasonId, so that one needs resolving too.
    if (!(await seasonInProgram(supabase, programId, newSeasonId))) {
      redirect(`${rolloverPath(slug)}?error=season`);
    }
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

  revalidatePath(rolloverPath(slug));
  redirect(wizardPath(slug, "activate", newSeasonId));
}

// Step 5 — make the new season the active one (see makeSeasonActive above).
export async function activateNewSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const newSeasonId = String(formData.get("newSeasonId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const supabase = await createClient();
  // makeSeasonActive is program-scoped, so a season that isn't ours would match
  // nothing and still report success — check first and say what's wrong.
  if (!(await seasonInProgram(supabase, programId, newSeasonId))) {
    redirect(`${rolloverPath(slug)}?error=season`);
  }
  const activated = await makeSeasonActive(supabase, programId, newSeasonId);
  if (!activated) {
    redirect(
      `${rolloverPath(slug)}?step=activate&newSeason=${newSeasonId}&error=activate`,
    );
  }

  revalidatePath(shellPath(slug), "layout");
  redirect(wizardPath(slug, "archive", newSeasonId));
}
