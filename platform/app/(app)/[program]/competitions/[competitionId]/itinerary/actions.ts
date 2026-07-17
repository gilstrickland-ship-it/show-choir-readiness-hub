"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COMPETITION_WRITE_ROLES, ITINERARY_ITEM_KINDS } from "@/lib/competitions";
import { zonedWallToUtc } from "@/lib/datetime";

// Manual itinerary editor (§5, T014). One itinerary per competition; items CRUD;
// publish gates parent visibility (invariant §9.3). Times arrive as program-tz
// wall clock from datetime-local inputs and are stored UTC (Constitution VII).

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function wallToIso(fd: FormData, key: string, tz: string): string | null {
  const d = zonedWallToUtc(str(fd, key), tz);
  return d ? d.toISOString() : null;
}

function itinPath(slug: string, competitionId: string): string {
  return `/${slug}/competitions/${competitionId}/itinerary`;
}

export async function addItineraryItem(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itineraryId = str(formData, "itineraryId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const kind = str(formData, "kind");
  const supabase = await createClient();
  await supabase.from("itinerary_items").insert({
    itinerary_id: itineraryId,
    program_id: programId,
    starts_at: wallToIso(formData, "starts_at", tz),
    ends_at: wallToIso(formData, "ends_at", tz),
    kind: (ITINERARY_ITEM_KINDS as readonly string[]).includes(kind) ? kind : "other",
    title: str(formData, "title") || "Untitled",
    location: str(formData, "location") || null,
    details: str(formData, "details") || null,
    sort_order: Number(str(formData, "sort_order")) || 0,
  });

  revalidatePath(itinPath(slug, competitionId));
  redirect(itinPath(slug, competitionId));
}

export async function updateItineraryItem(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itemId = str(formData, "itemId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const kind = str(formData, "kind");
  const supabase = await createClient();
  await supabase
    .from("itinerary_items")
    .update({
      starts_at: wallToIso(formData, "starts_at", tz),
      ends_at: wallToIso(formData, "ends_at", tz),
      kind: (ITINERARY_ITEM_KINDS as readonly string[]).includes(kind) ? kind : "other",
      title: str(formData, "title") || "Untitled",
      location: str(formData, "location") || null,
      details: str(formData, "details") || null,
      sort_order: Number(str(formData, "sort_order")) || 0,
    })
    .eq("id", itemId)
    .eq("program_id", programId);

  revalidatePath(itinPath(slug, competitionId));
  redirect(itinPath(slug, competitionId));
}

export async function deleteItineraryItem(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itemId = str(formData, "itemId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", itemId)
    .eq("program_id", programId);

  revalidatePath(itinPath(slug, competitionId));
  redirect(itinPath(slug, competitionId));
}

// Publish (invariant §9.3): status → published, published_at set. Confirmed on
// the page. Publishing is the gate for parent visibility / packet generation /
// shift suggestions — those consumers land in later phases.
export async function publishItinerary(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itineraryId = str(formData, "itineraryId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("itineraries")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", itineraryId)
    .eq("program_id", programId);

  revalidatePath(itinPath(slug, competitionId));
  redirect(`${itinPath(slug, competitionId)}?published=1`);
}

// Return a draft to editable state (unpublish) — kept minimal for corrections.
export async function unpublishItinerary(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itineraryId = str(formData, "itineraryId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("itineraries")
    .update({ status: "draft", published_at: null })
    .eq("id", itineraryId)
    .eq("program_id", programId);

  revalidatePath(itinPath(slug, competitionId));
  redirect(itinPath(slug, competitionId));
}
