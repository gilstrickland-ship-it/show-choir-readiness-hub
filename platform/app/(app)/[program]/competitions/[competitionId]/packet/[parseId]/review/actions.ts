"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COMPETITION_WRITE_ROLES, ITINERARY_ITEM_KINDS } from "@/lib/competitions";
import { zonedWallToUtc } from "@/lib/datetime";

// Accept a parsed packet (§5 step 5, T015). Materializes the (director-edited)
// parsed items into the competition's DRAFT itinerary, replacing any existing
// items and marking source='parsed'. Sets the parse status 'accepted'. NOTHING
// auto-publishes — publishing stays the explicit manual action in T014
// (Constitution IV).

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function acceptParse(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const parseId = str(formData, "parseId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();

  // Find (or create) the competition's draft itinerary.
  const { data: existing } = await supabase
    .from("itineraries")
    .select("id, status")
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .maybeSingle();
  let itineraryId = (existing as { id: string } | null)?.id ?? null;
  if (!itineraryId) {
    const { data: created } = await supabase
      .from("itineraries")
      .insert({
        program_id: programId,
        competition_id: competitionId,
        status: "draft",
        source: "parsed",
      })
      .select("id")
      .single();
    itineraryId = (created as { id: string } | null)?.id ?? null;
  }
  if (!itineraryId) {
    redirect(
      `/${slug}/competitions/${competitionId}/packet/${parseId}/review?error=itinerary`,
    );
  }

  // Replace existing items with the accepted set (source='parsed' on the parent).
  await supabase
    .from("itinerary_items")
    .delete()
    .eq("itinerary_id", itineraryId)
    .eq("program_id", programId);

  const count = Number(str(formData, "count")) || 0;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    if (str(formData, `item_${i}_include`) !== "1") continue;
    const kind = str(formData, `item_${i}_kind`);
    const startsWall = str(formData, `item_${i}_starts_at`);
    const endsWall = str(formData, `item_${i}_ends_at`);
    const startsUtc = zonedWallToUtc(startsWall, tz);
    const endsUtc = zonedWallToUtc(endsWall, tz);
    rows.push({
      itinerary_id: itineraryId,
      program_id: programId,
      starts_at: startsUtc ? startsUtc.toISOString() : null,
      ends_at: endsUtc ? endsUtc.toISOString() : null,
      kind: (ITINERARY_ITEM_KINDS as readonly string[]).includes(kind) ? kind : "other",
      title: str(formData, `item_${i}_title`) || "Untitled",
      location: str(formData, `item_${i}_location`) || null,
      details: str(formData, `item_${i}_details`) || null,
      sort_order: i + 1,
    });
  }
  if (rows.length > 0) {
    await supabase.from("itinerary_items").insert(rows);
  }

  await supabase
    .from("itineraries")
    .update({ source: "parsed" })
    .eq("id", itineraryId)
    .eq("program_id", programId);

  await supabase
    .from("packet_parses")
    .update({ status: "accepted" })
    .eq("id", parseId)
    .eq("program_id", programId);

  revalidatePath(`/${slug}/competitions/${competitionId}/itinerary`);
  redirect(`/${slug}/competitions/${competitionId}/itinerary?accepted=1`);
}
