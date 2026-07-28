"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  TREASURY_WRITE_ROLES,
  BUDGET_TEMPLATE,
  PG_UNIQUE_VIOLATION,
  parseCategoryDirection,
  parseDollarsToCents,
} from "@/lib/treasury";

// Budget builder writes (T018). Categories + lines are 100% user-defined per
// program (§7 "fully custom structure"). Planned amounts are entered as dollars
// and stored as integer cents (parseDollarsToCents — no float math). Only the
// treasurer writes; every action re-checks TREASURY_WRITE_ROLES via requireRole
// (Constitution I + V, defense in depth) even though RLS also gates it.

function budgetPath(slug: string): string {
  return `/${slug}/treasury/budget`;
}

// A failure that belongs to ONE line goes back to that line: `?edit=line-<id>`
// reopens its edit popover and the page renders the message inside it, rather
// than at the top of a budget that can run several screens (the Wave-2
// section-local error contract). Without a line id there is nothing to reopen,
// so it falls back to the page-level message.
function lineErrorPath(slug: string, lineId: string, code: string): string {
  if (!lineId) return `${budgetPath(slug)}?error=${code}`;
  const key = `line-${encodeURIComponent(lineId)}`;
  return `${budgetPath(slug)}?edit=${key}&error=${code}#${key}`;
}

function parseSortOrder(raw: string): number {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : 0;
}

// The budget hierarchy is season → budget → category → line, and every level's
// parent id reaches these actions as a form field. requireRole proves the caller
// runs the program they CLAIMED, not that the parent belongs to it, so each
// parent is resolved inside this program before a child is written
// (Constitution I). The stakes are highest one level up: the single-active-
// budget index is not program-scoped, so an unresolved season id lets one
// program permanently occupy another's active-budget slot.
async function resolveOwnedId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  programId: string,
  id: string,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Budget (per season) — create draft, activate (single-active guarded)
// ---------------------------------------------------------------------------

export async function createBudget(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name || !seasonId) {
    redirect(`${budgetPath(slug)}?error=budget`);
  }

  const supabase = await createClient();
  if (!(await resolveOwnedId(supabase, "seasons", programId, seasonId))) {
    redirect(`${budgetPath(slug)}?error=budget`);
  }

  const { error } = await supabase.from("budgets").insert({
    program_id: programId,
    season_id: seasonId,
    name,
    status: "draft",
  });

  if (error) {
    redirect(`${budgetPath(slug)}?error=budget`);
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

// Draft → active. The partial unique index uq_budgets_one_active_per_season lets
// only one active budget per season exist; a second activation raises 23505,
// which we catch and message rather than 500 (§7, T018).
export async function activateBudget(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const budgetId = String(formData.get("budgetId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("budgets")
    .update({ status: "active" })
    .eq("id", budgetId)
    .eq("program_id", programId);

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      redirect(`${budgetPath(slug)}?error=active_exists`);
    }
    redirect(`${budgetPath(slug)}?error=budget`);
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

// "Start from template" — one-click seeder of the §7 common structure, offered
// only when the budget is empty (the page passes the guard; we re-check here so
// a double-submit can't double-seed). A starting point only: everything stays
// editable afterward.
export async function seedTemplate(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const budgetId = String(formData.get("budgetId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await resolveOwnedId(supabase, "budgets", programId, budgetId))) {
    redirect(`${budgetPath(slug)}?error=budget`);
  }

  // Guard: only seed when the budget has no categories yet.
  const { count } = await supabase
    .from("budget_categories")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId)
    .eq("budget_id", budgetId);
  if ((count ?? 0) > 0) {
    redirect(`${budgetPath(slug)}?error=not_empty`);
  }

  let sort = 0;
  for (const cat of BUDGET_TEMPLATE) {
    const { data: inserted, error: catErr } = await supabase
      .from("budget_categories")
      .insert({
        program_id: programId,
        budget_id: budgetId,
        name: cat.name,
        direction: cat.direction,
        sort_order: sort++,
      })
      .select("id")
      .single();
    if (catErr || !inserted) {
      redirect(`${budgetPath(slug)}?error=budget`);
    }
    const lineRows = cat.lines.map((name, i) => ({
      program_id: programId,
      category_id: inserted.id,
      name,
      planned_cents: 0,
      sort_order: i,
    }));
    if (lineRows.length > 0) {
      const { error: lineErr } = await supabase
        .from("budget_lines")
        .insert(lineRows);
      if (lineErr) {
        redirect(`${budgetPath(slug)}?error=budget`);
      }
    }
  }

  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

// ---------------------------------------------------------------------------
// Categories CRUD
// ---------------------------------------------------------------------------

export async function addCategory(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const budgetId = String(formData.get("budgetId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  const direction = parseCategoryDirection(String(formData.get("direction") ?? ""));
  if (!name || !direction || !budgetId) {
    redirect(`${budgetPath(slug)}?error=category`);
  }

  const supabase = await createClient();
  if (!(await resolveOwnedId(supabase, "budgets", programId, budgetId))) {
    redirect(`${budgetPath(slug)}?error=category`);
  }

  const { error } = await supabase.from("budget_categories").insert({
    program_id: programId,
    budget_id: budgetId,
    name,
    direction,
    sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
  });

  if (error) {
    redirect(`${budgetPath(slug)}?error=category`);
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

export async function updateCategory(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  const direction = parseCategoryDirection(String(formData.get("direction") ?? ""));
  if (!name || !direction) {
    redirect(`${budgetPath(slug)}?error=category`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_categories")
    .update({
      name,
      direction,
      sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
    })
    .eq("id", categoryId)
    .eq("program_id", programId);

  if (error) {
    redirect(`${budgetPath(slug)}?error=category`);
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

// Delete a category. Lines reference it (budget_lines.category_id, no cascade),
// so a category that still holds lines raises an FK violation — surfaced as a
// friendly "remove its lines first" message.
export async function deleteCategory(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_categories")
    .delete()
    .eq("id", categoryId)
    .eq("program_id", programId);

  if (error) {
    redirect(`${budgetPath(slug)}?error=cat_in_use`);
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

// ---------------------------------------------------------------------------
// Lines CRUD — planned_cents entered as dollars, stored as integer cents
// ---------------------------------------------------------------------------

export async function addLine(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  const plannedRaw = String(formData.get("planned") ?? "").trim();
  // Empty planned defaults to 0; a non-empty value must parse cleanly.
  const planned = plannedRaw === "" ? 0 : parseDollarsToCents(plannedRaw);
  if (!name || !categoryId || planned === null) {
    redirect(`${budgetPath(slug)}?error=line`);
  }

  const supabase = await createClient();
  if (!(await resolveOwnedId(supabase, "budget_categories", programId, categoryId))) {
    redirect(`${budgetPath(slug)}?error=line`);
  }

  const { error } = await supabase.from("budget_lines").insert({
    program_id: programId,
    category_id: categoryId,
    name,
    planned_cents: planned,
    sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
  });

  if (error) {
    redirect(`${budgetPath(slug)}?error=line`);
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

export async function updateLine(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  const plannedRaw = String(formData.get("planned") ?? "").trim();
  const planned = plannedRaw === "" ? 0 : parseDollarsToCents(plannedRaw);
  if (!name || planned === null) {
    redirect(lineErrorPath(slug, lineId, "line"));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_lines")
    .update({
      name,
      planned_cents: planned,
      sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
    })
    .eq("id", lineId)
    .eq("program_id", programId);

  if (error) {
    redirect(lineErrorPath(slug, lineId, "line"));
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}

// Delete a line. ledger_entries.budget_line_id references it (nullable, no
// cascade); a line with entries tagged to it raises an FK violation — message
// the treasurer to re-tag those entries (void + redo) first.
export async function deleteLine(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_lines")
    .delete()
    .eq("id", lineId)
    .eq("program_id", programId);

  if (error) {
    redirect(lineErrorPath(slug, lineId, "line_in_use"));
  }
  revalidatePath(budgetPath(slug));
  redirect(`${budgetPath(slug)}?saved=1`);
}
