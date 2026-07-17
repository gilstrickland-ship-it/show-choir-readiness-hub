"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KINDS,
  PIECE_CONDITIONS,
  type PieceKind,
  type PieceCondition,
} from "@/lib/costumes";

// Inventory (costume_pieces) + sets (costume_sets) CRUD — T009. Pieces are
// PROGRAM inventory (persist across seasons, no season_id); sets are
// season-scoped groupings. Writes are director/admin/costume_manager; every
// action re-checks the role via requireRole (Constitution I, defense in depth).

function parseSortOrder(raw: string): number {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : 0;
}

function textOrNull(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

function parseKind(raw: string): PieceKind | null {
  return (PIECE_KINDS as readonly string[]).includes(raw)
    ? (raw as PieceKind)
    : null;
}

function parseCondition(raw: string): PieceCondition {
  return (PIECE_CONDITIONS as readonly string[]).includes(raw)
    ? (raw as PieceCondition)
    : "good";
}

// ---------------------------------------------------------------------------
// Pieces (inventory) — props/set_pieces are just kinds on the same rails (§4)
// ---------------------------------------------------------------------------

export async function addPiece(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const kind = parseKind(String(formData.get("kind") ?? ""));
  const label = String(formData.get("label") ?? "").trim();
  if (!kind || !label) {
    redirect(`/${slug}/costumes?error=piece`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("costume_pieces").insert({
    program_id: programId,
    kind,
    label,
    set_id: textOrNull(formData.get("set_id")),
    size_label: textOrNull(formData.get("size_label")),
    color: textOrNull(formData.get("color")),
    condition: parseCondition(String(formData.get("condition") ?? "good")),
    storage_location: textOrNull(formData.get("storage_location")),
    notes: textOrNull(formData.get("notes")),
  });

  if (error) {
    redirect(`/${slug}/costumes?error=piece`);
  }
  revalidatePath(`/${slug}/costumes`);
  redirect(`/${slug}/costumes?saved=1`);
}

export async function updatePiece(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const pieceId = String(formData.get("pieceId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const kind = parseKind(String(formData.get("kind") ?? ""));
  const label = String(formData.get("label") ?? "").trim();
  if (!kind || !label) {
    redirect(`/${slug}/costumes/pieces/${pieceId}?error=piece`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_pieces")
    .update({
      kind,
      label,
      set_id: textOrNull(formData.get("set_id")),
      size_label: textOrNull(formData.get("size_label")),
      color: textOrNull(formData.get("color")),
      condition: parseCondition(String(formData.get("condition") ?? "good")),
      storage_location: textOrNull(formData.get("storage_location")),
      notes: textOrNull(formData.get("notes")),
    })
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/costumes/pieces/${pieceId}?error=piece`);
  }
  revalidatePath(`/${slug}/costumes/pieces/${pieceId}`);
  revalidatePath(`/${slug}/costumes`);
  redirect(`/${slug}/costumes/pieces/${pieceId}?saved=1`);
}

// Retire a piece = condition 'retire'. Inventory is never deleted (its
// persistence IS the continuity feature, §4) — retiring keeps the record and
// its history.
export async function retirePiece(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const pieceId = String(formData.get("pieceId") ?? "");
  const back = String(formData.get("back") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_pieces")
    .update({ condition: "retire" })
    .eq("id", pieceId)
    .eq("program_id", programId);

  const target = back === "detail" ? `/${slug}/costumes/pieces/${pieceId}` : `/${slug}/costumes`;
  if (error) {
    redirect(`${target}?error=piece`);
  }
  revalidatePath(`/${slug}/costumes`);
  redirect(`${target}?saved=1`);
}

// ---------------------------------------------------------------------------
// Sets (season-scoped grouping)
// ---------------------------------------------------------------------------

export async function addSet(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name || !seasonId) {
    redirect(`/${slug}/costumes/sets?error=set`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("costume_sets").insert({
    program_id: programId,
    season_id: seasonId,
    ensemble_id: textOrNull(formData.get("ensemble_id")),
    name,
    sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
    notes: textOrNull(formData.get("notes")),
  });

  if (error) {
    redirect(`/${slug}/costumes/sets?error=save`);
  }
  revalidatePath(`/${slug}/costumes/sets`);
  redirect(`/${slug}/costumes/sets?saved=1`);
}

export async function updateSet(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const setId = String(formData.get("setId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect(`/${slug}/costumes/sets?error=set`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_sets")
    .update({
      ensemble_id: textOrNull(formData.get("ensemble_id")),
      name,
      sort_order: parseSortOrder(String(formData.get("sort_order") ?? "0")),
      notes: textOrNull(formData.get("notes")),
    })
    .eq("id", setId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/costumes/sets?error=save`);
  }
  revalidatePath(`/${slug}/costumes/sets`);
  revalidatePath(`/${slug}/costumes/sets/${setId}`);
  redirect(`/${slug}/costumes/sets?saved=1`);
}

// Delete a set. Pieces reference it (costume_pieces.set_id, no cascade), so a set
// that still groups pieces raises an FK violation — surfaced as a friendly
// "in use" message (detach the pieces first).
export async function deleteSet(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const setId = String(formData.get("setId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_sets")
    .delete()
    .eq("id", setId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/costumes/sets?error=in_use`);
  }
  revalidatePath(`/${slug}/costumes/sets`);
  redirect(`/${slug}/costumes/sets?saved=1`);
}

// Re-point a piece into a set (set_id) — the rollover-style regrouping of §4.
export async function assignPieceToSet(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const pieceId = String(formData.get("pieceId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_pieces")
    .update({ set_id: setId })
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/costumes/sets/${setId}?error=piece`);
  }
  revalidatePath(`/${slug}/costumes/sets/${setId}`);
  redirect(`/${slug}/costumes/sets/${setId}?saved=1`);
}

// Remove a piece from its set (set_id → null). The piece stays in inventory.
export async function removePieceFromSet(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const pieceId = String(formData.get("pieceId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("costume_pieces")
    .update({ set_id: null })
    .eq("id", pieceId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/costumes/sets/${setId}?error=piece`);
  }
  revalidatePath(`/${slug}/costumes/sets/${setId}`);
  redirect(`/${slug}/costumes/sets/${setId}?saved=1`);
}
