"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COSTUME_WRITE_ROLES, DIRECT_KINDS } from "@/lib/costumes";

// Per-competition checkout (T011). Seeding is an idempotent upsert (Constitution
// X): it inserts only the checkout rows that don't already exist. There is no
// natural unique constraint on costume_checkouts in 0001, so the action queries
// existing rows first and dedupes in application code. Actor + timestamp are
// stamped on every toggle. director/admin/costume_manager write.

interface CompetitionRow {
  id: string;
  season_id: string;
  ensemble_id: string | null;
}

// Idempotently seed checkout rows for a competition: one per active assignment of
// its ensemble+season, plus a direct piece row for each prop/set piece in that
// ensemble's sets.
export async function seedCheckout(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const competitionId = String(formData.get("competitionId") ?? "");
  await requireRole(programId, COSTUME_WRITE_ROLES);

  const base = `/${slug}/costumes/checkout`;
  if (!competitionId) redirect(base);

  const supabase = await createClient();

  const { data: compData } = await supabase
    .from("competitions")
    .select("id, season_id, ensemble_id")
    .eq("id", competitionId)
    .eq("program_id", programId)
    .maybeSingle();
  const comp = compData as CompetitionRow | null;
  if (!comp) redirect(base);
  const competition = comp as CompetitionRow;

  // Without an ensemble there's no eligibility list — nothing to seed.
  if (!competition.ensemble_id) {
    redirect(`${base}?competition=${competitionId}&seeded=1`);
  }

  // Sets for this ensemble + season → their pieces.
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id")
    .eq("program_id", programId)
    .eq("season_id", competition.season_id)
    .eq("ensemble_id", competition.ensemble_id);
  const setIds = ((setData as { id: string }[] | null) ?? []).map((s) => s.id);

  const directPieceIds: string[] = [];
  const assignablePieceIds: string[] = [];
  if (setIds.length > 0) {
    const { data: pieceData } = await supabase
      .from("costume_pieces")
      .select("id, kind")
      .eq("program_id", programId)
      .in("set_id", setIds);
    for (const p of (pieceData as { id: string; kind: string }[] | null) ?? []) {
      if ((DIRECT_KINDS as readonly string[]).includes(p.kind)) directPieceIds.push(p.id);
      else assignablePieceIds.push(p.id);
    }
  }

  // Active assignments for those assignable pieces this season.
  let assignmentIds: string[] = [];
  if (assignablePieceIds.length > 0) {
    const { data: aData } = await supabase
      .from("costume_assignments")
      .select("id")
      .eq("program_id", programId)
      .eq("season_id", competition.season_id)
      .in("piece_id", assignablePieceIds);
    assignmentIds = ((aData as { id: string }[] | null) ?? []).map((a) => a.id);
  }

  // Existing checkout rows for this competition → dedupe set (no unique index).
  const { data: existingData } = await supabase
    .from("costume_checkouts")
    .select("assignment_id, piece_id")
    .eq("program_id", programId)
    .eq("competition_id", competitionId);
  const existingAssignmentIds = new Set<string>();
  const existingDirectPieceIds = new Set<string>();
  for (const r of (existingData as
    | { assignment_id: string | null; piece_id: string | null }[]
    | null) ?? []) {
    if (r.assignment_id) existingAssignmentIds.add(r.assignment_id);
    else if (r.piece_id) existingDirectPieceIds.add(r.piece_id);
  }

  const rows: Record<string, unknown>[] = [];
  for (const assignmentId of assignmentIds) {
    if (!existingAssignmentIds.has(assignmentId)) {
      rows.push({
        program_id: programId,
        competition_id: competitionId,
        assignment_id: assignmentId,
      });
    }
  }
  for (const pieceId of directPieceIds) {
    if (!existingDirectPieceIds.has(pieceId)) {
      rows.push({
        program_id: programId,
        competition_id: competitionId,
        piece_id: pieceId,
      });
    }
  }

  if (rows.length > 0) {
    await supabase.from("costume_checkouts").insert(rows);
  }

  revalidatePath(base);
  redirect(`${base}?competition=${competitionId}&seeded=1`);
}

// Toggle a single row: pending/checked-in → checked OUT; checked OUT → checked IN.
// Every transition stamps the acting user + now().
export async function toggleCheckout(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const competitionId = String(formData.get("competitionId") ?? "");
  const checkoutId = String(formData.get("checkoutId") ?? "");
  const { user } = await requireRole(programId, COSTUME_WRITE_ROLES);

  const base = `/${slug}/costumes/checkout?competition=${competitionId}`;

  const supabase = await createClient();
  const { data: rowData } = await supabase
    .from("costume_checkouts")
    .select("id, checked_out_at, checked_in_at")
    .eq("id", checkoutId)
    .eq("program_id", programId)
    .maybeSingle();
  const row = rowData as
    | { id: string; checked_out_at: string | null; checked_in_at: string | null }
    | null;
  if (!row) redirect(`${base}&error=toggle`);
  const checkout = row as {
    id: string;
    checked_out_at: string | null;
    checked_in_at: string | null;
  };

  const now = new Date().toISOString();
  const isOut = checkout.checked_out_at != null && checkout.checked_in_at == null;

  const patch = isOut
    ? { checked_in_at: now, checked_in_by: user.id } // OUT → IN
    : {
        // pending or IN → OUT (clear any prior check-in)
        checked_out_at: now,
        checked_out_by: user.id,
        checked_in_at: null,
        checked_in_by: null,
      };

  const { error } = await supabase
    .from("costume_checkouts")
    .update(patch)
    .eq("id", checkoutId)
    .eq("program_id", programId);

  if (error) redirect(`${base}&error=toggle`);
  revalidatePath(`/${slug}/costumes/checkout`);
  redirect(base);
}
