"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { programPath } from "@/lib/return-path";
import {
  COSTUME_WRITE_ROLES,
  parsePieceKind,
  parsePieceCondition,
} from "@/lib/costumes";

// Inventory (costume_pieces) + sets (costume_sets) CRUD. Pieces are PROGRAM
// inventory (persist across seasons, no season_id); sets are season-scoped
// groupings. Writes are director/admin/costume_manager; every action re-checks
// the role via requireRole (Constitution I, defense in depth).
//
// CROSS-PROGRAM REFERENCES (Constitution I). Every id below arrives as a form
// field, and requireRole only proves the caller runs THIS program — not that the
// piece/set/season/ensemble they posted belongs to it. Anyone can self-serve a
// program at /launch, so an unresolved id lets them write a row that points into
// someone else's data — and `costume_assignments` carries UNIQUE(season_id,
// piece_id), a key with no program column, so a poisoned piece id squats a slot
// its owner can neither see nor clear. Resolve first, scoped to programId, and
// fail closed to the surface's error convention when the row isn't there.
//
// Wave W moved sets CRUD onto the Assignments tab (a set is the grouping
// assignments hang off), so the set actions land back there rather than on the
// retired /costumes/sets list.

// Fail closed on the slug: it arrives as a form field, and a value like
// "/evil.com" interpolated into a path makes a protocol-relative URL the browser
// follows off-site (lib/return-path). Anything that isn't a program slug lands
// on "/" rather than building a target out of it.
function costumePath(slug: string, sub?: string): string {
  return programPath(slug, sub ? `costumes/${sub}` : "costumes") ?? "/";
}

function parseSortOrder(raw: string): number {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : 0;
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function nullable(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

// A row-local edit posts ONLY the fields it shows, plus `sparse=1`. Absent means
// "leave it alone" — a size fix must not clear a storage location nobody touched.
function isSparse(fd: FormData): boolean {
  return str(fd, "sparse") === "1";
}

// ---- Cross-program resolvers -----------------------------------------------

// The id when it belongs to this program, null when the field was blank, or
// false when it belongs to someone else — callers redirect on false rather than
// writing an invisible poisoned row.
async function resolveOwnedId(
  supabase: SupabaseClient,
  table: string,
  programId: string,
  id: string | null,
): Promise<string | null | false> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? false;
}

// A piece proven to be in THIS program. Required (unlike resolveOwnedId, whose
// null means "the form left it blank").
async function resolvePiece(
  supabase: SupabaseClient,
  programId: string,
  pieceId: string,
): Promise<string | null> {
  if (!pieceId) return null;
  const { data } = await supabase
    .from("costume_pieces")
    .select("id")
    .eq("id", pieceId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function resolveSet(
  supabase: SupabaseClient,
  programId: string,
  setId: string,
): Promise<string | null> {
  if (!setId) return null;
  const { data } = await supabase
    .from("costume_sets")
    .select("id")
    .eq("id", setId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Pieces (inventory) — props/set_pieces are just kinds on the same rails (§4)
// ---------------------------------------------------------------------------

export async function addPiece(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const inventory = costumePath(slug, "inventory");
  // A rejected create reopens the drawer with its message inside, so the typing
  // is still on screen next to the reason (the Wave-1 drawer contract).
  const fail = (code: string): string => `${inventory}?error=${code}&add=piece`;

  const kind = parsePieceKind(str(formData, "kind"));
  const label = str(formData, "label");
  if (!kind || !label) redirect(fail("piece"));

  const supabase = await createClient();
  const setId = await resolveOwnedId(
    supabase,
    "costume_sets",
    programId,
    nullable(formData, "set_id"),
  );
  if (setId === false) redirect(fail("set"));

  const { error } = await supabase.from("costume_pieces").insert({
    program_id: programId,
    kind,
    label,
    set_id: setId,
    size_label: nullable(formData, "size_label"),
    color: nullable(formData, "color"),
    condition: parsePieceCondition(str(formData, "condition")) ?? "good",
    storage_location: nullable(formData, "storage_location"),
    notes: nullable(formData, "notes"),
  });

  if (error) redirect(fail("save"));
  revalidatePath(inventory);
  redirect(`${inventory}?saved=1`);
}

export async function updatePiece(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const pieceId = str(formData, "pieceId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  // The inventory row panel posts `from=inventory`; the detail page posts
  // nothing and keeps its own redirects. Both are paths we build, never a URL
  // the form supplied.
  const fromInventory = str(formData, "from") === "inventory";
  const detail = costumePath(slug, `pieces/${pieceId}`);
  const inventory = costumePath(slug, "inventory");
  const ok = fromInventory ? `${inventory}?saved=1` : `${detail}?saved=1`;
  const fail = (code: string): string =>
    fromInventory
      ? `${inventory}?error=${code}&edit=${pieceId}`
      : `${detail}?error=${code}`;

  const sparse = isSparse(formData);
  const sends = (key: string): boolean => !sparse || formData.get(key) !== null;

  const kind = parsePieceKind(str(formData, "kind"));
  const label = str(formData, "label");
  if (sends("kind") && !kind) redirect(fail("piece"));
  if (sends("label") && !label) redirect(fail("piece"));

  const supabase = await createClient();
  if (!(await resolvePiece(supabase, programId, pieceId))) redirect(fail("piece"));

  const fields: Record<string, unknown> = {};
  if (sends("kind")) fields.kind = kind;
  if (sends("label")) fields.label = label;
  if (sends("size_label")) fields.size_label = nullable(formData, "size_label");
  if (sends("color")) fields.color = nullable(formData, "color");
  if (sends("condition")) {
    fields.condition = parsePieceCondition(str(formData, "condition")) ?? "good";
  }
  if (sends("storage_location")) {
    fields.storage_location = nullable(formData, "storage_location");
  }
  if (sends("notes")) fields.notes = nullable(formData, "notes");
  if (sends("set_id")) {
    const setId = await resolveOwnedId(
      supabase,
      "costume_sets",
      programId,
      nullable(formData, "set_id"),
    );
    if (setId === false) redirect(fail("set"));
    fields.set_id = setId;
  }

  const { error } = await supabase
    .from("costume_pieces")
    .update(fields)
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));
  revalidatePath(detail);
  revalidatePath(inventory);
  redirect(ok);
}

// Retire a piece = condition 'retire'. Inventory is never deleted (its
// persistence IS the continuity feature, §4) — retiring keeps the record and
// its history.
export async function retirePiece(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const pieceId = str(formData, "pieceId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const inventory = costumePath(slug, "inventory");
  const onDetail = str(formData, "back") === "detail";
  const target = onDetail ? costumePath(slug, `pieces/${pieceId}`) : inventory;
  // Retiring from the inventory list happens inside a row's panel, so its
  // refusal comes back to that panel — not to the top of the page, where the
  // create drawer would open on a message that has nothing to do with it.
  const fail = (code: string): string =>
    onDetail ? `${target}?error=${code}` : `${inventory}?error=${code}&edit=${pieceId}`;

  const supabase = await createClient();
  if (!(await resolvePiece(supabase, programId, pieceId))) redirect(fail("piece"));

  const { error } = await supabase
    .from("costume_pieces")
    .update({ condition: "retire" })
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));
  revalidatePath(inventory);
  redirect(`${target}?saved=1`);
}

// ---------------------------------------------------------------------------
// Sets (season-scoped grouping) — edited on the Assignments tab
// ---------------------------------------------------------------------------

export async function addSet(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const assignments = costumePath(slug, "assignments");
  const fail = (code: string): string => `${assignments}?error=${code}&add=set`;

  const name = str(formData, "name");
  if (!name) redirect(fail("name"));
  if (!seasonId) redirect(fail("season"));

  const supabase = await createClient();
  const [season, ensembleId] = await Promise.all([
    resolveOwnedId(supabase, "seasons", programId, seasonId),
    resolveOwnedId(supabase, "ensembles", programId, nullable(formData, "ensemble_id")),
  ]);
  if (!season) redirect(fail("season"));
  if (ensembleId === false) redirect(fail("ensemble"));

  // Land on the set that was just made, with its grid open — the whole reason
  // to add one is to start assigning into it.
  const { data, error } = await supabase
    .from("costume_sets")
    .insert({
      program_id: programId,
      season_id: seasonId,
      ensemble_id: ensembleId,
      name,
      sort_order: parseSortOrder(str(formData, "sort_order")),
      notes: nullable(formData, "notes"),
    })
    .select("id")
    .maybeSingle();

  if (error) redirect(fail("save"));
  const newId = (data as { id: string } | null)?.id;
  revalidatePath(assignments);
  redirect(newId ? `${assignments}?set=${newId}&saved=1` : `${assignments}?saved=1`);
}

export async function updateSet(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const setId = str(formData, "setId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const assignments = costumePath(slug, "assignments");
  const here = `${assignments}?set=${setId}`;
  // A refused save reopens the set-settings disclosure it came from.
  const fail = (code: string): string => `${here}&edit=set&error=${code}`;

  const name = str(formData, "name");
  if (!name) redirect(fail("name"));

  const supabase = await createClient();
  if (!(await resolveSet(supabase, programId, setId))) redirect(fail("set"));

  const ensembleId = await resolveOwnedId(
    supabase,
    "ensembles",
    programId,
    nullable(formData, "ensemble_id"),
  );
  if (ensembleId === false) redirect(fail("ensemble"));

  const { error } = await supabase
    .from("costume_sets")
    .update({
      ensemble_id: ensembleId,
      name,
      sort_order: parseSortOrder(str(formData, "sort_order")),
      notes: nullable(formData, "notes"),
    })
    .eq("id", setId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));
  revalidatePath(assignments);
  revalidatePath(costumePath(slug, `sets/${setId}`));
  redirect(`${here}&saved=1`);
}

// Delete a set. Pieces reference it (costume_pieces.set_id, no cascade), so a
// set that still groups pieces raises an FK violation — surfaced as a friendly
// "in use" message (take its pieces out first).
export async function deleteSet(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const setId = str(formData, "setId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const assignments = costumePath(slug, "assignments");
  const fail = (code: string): string =>
    `${assignments}?set=${setId}&edit=set&error=${code}`;

  const supabase = await createClient();
  if (!(await resolveSet(supabase, programId, setId))) redirect(fail("set"));

  const { error } = await supabase
    .from("costume_sets")
    .delete()
    .eq("id", setId)
    .eq("program_id", programId);

  if (error) redirect(fail("in_use"));
  revalidatePath(assignments);
  redirect(`${assignments}?deleted=1`);
}

// Put a piece into a set (set_id) — the season regrouping of §4.
export async function assignPieceToSet(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const setId = str(formData, "setId");
  const pieceId = str(formData, "pieceId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const target = costumePath(slug, `sets/${setId}`);
  const supabase = await createClient();
  // Both ids come off the form. A set from another program would pin their row;
  // a piece from another program would be re-pointed into this program's set.
  const [set, piece] = await Promise.all([
    resolveSet(supabase, programId, setId),
    resolvePiece(supabase, programId, pieceId),
  ]);
  if (!set || !piece) redirect(`${target}?error=piece`);

  const { error } = await supabase
    .from("costume_pieces")
    .update({ set_id: setId })
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) redirect(`${target}?error=save`);
  revalidatePath(target);
  redirect(`${target}?saved=1`);
}

// Take a piece out of its set (set_id → null). The piece stays in inventory.
export async function removePieceFromSet(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const setId = str(formData, "setId");
  const pieceId = str(formData, "pieceId");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const target = costumePath(slug, `sets/${setId}`);
  const supabase = await createClient();
  const [set, piece] = await Promise.all([
    resolveSet(supabase, programId, setId),
    resolvePiece(supabase, programId, pieceId),
  ]);
  if (!set || !piece) redirect(`${target}?error=piece`);

  const { error } = await supabase
    .from("costume_pieces")
    .update({ set_id: null })
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) redirect(`${target}?error=save`);
  revalidatePath(target);
  redirect(`${target}?saved=1`);
}
