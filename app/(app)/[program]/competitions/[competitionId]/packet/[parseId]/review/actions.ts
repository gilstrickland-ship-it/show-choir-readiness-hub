"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  COMPETITION_WRITE_ROLES,
  ITINERARY_ITEM_KINDS,
  resolveCompetitionId,
} from "@/lib/competitions";
import { zonedWallToUtc } from "@/lib/datetime";
import { programPath } from "@/lib/return-path";
import { ACCEPT_LIVE_CONFIRM, type ReviewErrorKey } from "./shared";

// Accept a parsed packet (§5 step 5, T015). Materializes the (director-edited)
// parsed items into the competition's itinerary, replacing any existing items
// and marking source='parsed'. Sets the parse status 'accepted'. NOTHING
// auto-publishes — publishing stays the explicit manual action in T014
// (Constitution IV).
//
// …with one case that is not a draft at all. When the competition's itinerary is
// ALREADY PUBLISHED, this write replaces the items families are reading right
// now: the schedule on their phones changes the moment it lands, with no publish
// step left between them and AI-drafted text. That is the exact boundary
// Constitution IV draws, so this path asks for a second, explicit yes — and the
// review screen says out loud what it is agreeing to (see ./page.tsx).

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

  // A redirect target is never built by interpolating a value the form posted:
  // `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
  // every browser reads as a different ORIGIN and follows off-site. programPath
  // validates the slug shape and fails closed to "/" (spec 005 T143a).
  const reviewPath =
    programPath(
      slug,
      `competitions/${competitionId}/packet/${parseId}/review`,
    ) ?? "/";
  const itineraryPath =
    programPath(slug, `competitions/${competitionId}/itinerary`) ?? "/";
  const back = (key: ReviewErrorKey): string => `${reviewPath}?error=${key}`;
  const bounce = back("itinerary");

  // The competition and the parse both arrive as form fields. Resolve them
  // inside this program first — otherwise the lookup below finds nothing (RLS
  // hides the foreign row), the INSERT branch always fires, and we create an
  // itinerary hanging off another program's competition (Constitution I).
  if (!(await resolveCompetitionId(supabase, programId, competitionId))) redirect(bounce);
  const { data: parseRow } = await supabase
    .from("packet_parses")
    .select("id")
    .eq("id", parseId)
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .maybeSingle();
  if (!parseRow) redirect(bounce);

  // Find (or create) the competition's itinerary.
  const { data: existing } = await supabase
    .from("itineraries")
    .select("id, status")
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .maybeSingle();
  const current = existing as { id: string; status: string } | null;

  // The one case where accepting is not "into a draft": these items are what
  // families are reading right now, and replacing them puts AI-drafted text in
  // front of them with no step in between. The screen states that and asks for a
  // tick; this is where the tick is REQUIRED, because a form is a thing anyone
  // can post (Constitution IV — a human approves what they are seeing).
  const wasPublished = current?.status === "published";
  if (wasPublished && str(formData, "confirm") !== ACCEPT_LIVE_CONFIRM) {
    redirect(back("confirm"));
  }

  let itineraryId = current?.id ?? null;
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
  if (!itineraryId) redirect(bounce);

  // Replace existing items with the accepted set (source='parsed' on the parent).
  // "Replace" is the whole contract, so a refused delete is not a detail to
  // swallow: the insert below would then APPEND, and the competition's schedule
  // would carry every old line twice over.
  const { error: clearError } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("itinerary_id", itineraryId)
    .eq("program_id", programId);
  if (clearError) redirect(bounce);

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
    const { error } = await supabase.from("itinerary_items").insert(rows);
    if (error) redirect(bounce);
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

  revalidatePath(itineraryPath);
  // The itinerary editor's one `?ok=` contract (spec 005 T156 / ./itinerary
  // shared.ts) — the key is what decides which block on that page speaks. Which
  // of the two keys is the honest one depends on whether there is still a
  // publish step between this and a parent.
  redirect(`${itineraryPath}?ok=${wasPublished ? "accepted_live" : "accepted"}`);
}
