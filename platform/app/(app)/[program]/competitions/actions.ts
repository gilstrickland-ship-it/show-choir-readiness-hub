"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  COMPETITION_WRITE_ROLES,
  COMPETITION_STATUSES,
  COMMON_CAPTIONS,
  seedAttendance,
  type CompetitionStatus,
} from "@/lib/competitions";
import { flag, type FlaggableProgram } from "@/lib/flags";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { runPacketParse } from "@/lib/ai/packet-parse";

// Competitions CRUD + attendance seed + results (§5, T012). Writes are
// director/admin (§2 "Competitions / itineraries"); every action re-checks the
// role via requireRole (Constitution I) even though RLS also gates it.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function nullable(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v || null;
}

// Create a competition, then idempotently seed attendance for its ensemble+season
// (§5, invariant §9.5). ensemble is optional at create; no ensemble ⇒ no seed.
export async function createCompetition(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = nullable(formData, "seasonId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) redirect(`/${slug}/competitions?error=name`);
  if (!seasonId) redirect(`/${slug}/competitions?error=season`);

  const status = str(formData, "status") as CompetitionStatus;
  const ensembleId = nullable(formData, "ensemble_id");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitions")
    .insert({
      program_id: programId,
      season_id: seasonId,
      ensemble_id: ensembleId,
      name,
      host_school: nullable(formData, "host_school"),
      venue_address: nullable(formData, "venue_address"),
      date: nullable(formData, "date"),
      showchoir_com_url: nullable(formData, "showchoir_com_url"),
      status: COMPETITION_STATUSES.includes(status) ? status : "planned",
    })
    .select("id")
    .single();

  if (error || !data) redirect(`/${slug}/competitions?error=save`);

  await seedAttendance(supabase, {
    programId,
    competitionId: data.id,
    ensembleId,
    seasonId,
  });

  revalidatePath(`/${slug}/competitions`);
  redirect(`/${slug}/competitions/${data.id}?created=1`);
}

// Update core fields. Changing the ensemble after creation reseeds attendance and
// requires explicit confirmation (invariant §9.2) — the detail page posts
// confirm_ensemble=1 once the director acknowledges the reseed.
export async function updateCompetition(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const seasonId = nullable(formData, "seasonId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) redirect(`/${slug}/competitions/${competitionId}?error=name`);

  const newEnsemble = nullable(formData, "ensemble_id");
  const currentEnsemble = nullable(formData, "current_ensemble_id");
  const confirmed = str(formData, "confirm_ensemble") === "1";
  const ensembleChanged = newEnsemble !== currentEnsemble;

  // Guard: ensemble change without confirmation → bounce to the confirm prompt.
  if (ensembleChanged && !confirmed) {
    const pending = newEnsemble ?? "";
    redirect(
      `/${slug}/competitions/${competitionId}?confirm=ensemble&pending_ensemble=${encodeURIComponent(pending)}`,
    );
  }

  const status = str(formData, "status") as CompetitionStatus;
  const supabase = await createClient();
  const { error } = await supabase
    .from("competitions")
    .update({
      ensemble_id: newEnsemble,
      name,
      host_school: nullable(formData, "host_school"),
      venue_address: nullable(formData, "venue_address"),
      date: nullable(formData, "date"),
      showchoir_com_url: nullable(formData, "showchoir_com_url"),
      status: COMPETITION_STATUSES.includes(status) ? status : "planned",
    })
    .eq("id", competitionId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/competitions/${competitionId}?error=save`);

  // Reseed when the ensemble changed — the eligibility list is now different.
  if (ensembleChanged) {
    await seedAttendance(supabase, {
      programId,
      competitionId,
      ensembleId: newEnsemble,
      seasonId,
    });
  }

  revalidatePath(`/${slug}/competitions/${competitionId}`);
  redirect(`/${slug}/competitions/${competitionId}?saved=1`);
}

// Manual "reseed" action (idempotent; safe to re-run when the roster changes).
export async function reseedAttendance(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const seasonId = nullable(formData, "seasonId");
  const ensembleId = nullable(formData, "ensemble_id");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  await seedAttendance(supabase, { programId, competitionId, ensembleId, seasonId });

  revalidatePath(`/${slug}/competitions/${competitionId}`);
  redirect(`/${slug}/competitions/${competitionId}?reseeded=1`);
}

// Save the results row (one per competition; upsert on competition_id). Captions
// come from checkbox fields caption_<name> plus a free-add comma list.
export async function saveResults(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const captions: Record<string, boolean> = {};
  for (const name of COMMON_CAPTIONS) {
    if (formData.get(`caption_${name}`) != null) captions[name] = true;
  }
  for (const extra of str(formData, "captions_extra").split(",")) {
    const label = extra.trim();
    if (label) captions[label] = true;
  }

  const scoreRaw = str(formData, "score");
  const score = scoreRaw ? Number(scoreRaw) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("competition_results").upsert(
    {
      program_id: programId,
      competition_id: competitionId,
      placement: nullable(formData, "placement"),
      division: nullable(formData, "division"),
      score: score !== null && Number.isFinite(score) ? score : null,
      captions,
      notes: nullable(formData, "notes"),
    },
    { onConflict: "competition_id" },
  );

  if (error) redirect(`/${slug}/competitions/${competitionId}?error=results`);

  revalidatePath(`/${slug}/competitions/${competitionId}`);
  redirect(`/${slug}/competitions/${competitionId}?results=1`);
}

// Attach an inbound (email-forwarded) packet document to a competition, then
// enqueue the AI parse when the packet_parse flag is on (§14.3, T026). Inbound
// packets land with competition_id null because the parse/review screen needs
// competition context; this is the director's "which competition is this for?"
// step, after which the existing parse pipeline runs (Inngest or inline fallback).
export async function attachPacket(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const documentId = str(formData, "documentId");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);
  if (!competitionId) redirect(`/${slug}/competitions?error=attach`);

  const supabase = await createClient();

  // Scope the document + competition to this program before mutating.
  const { data: docData } = await supabase
    .from("documents")
    .select("id, competition_id")
    .eq("id", documentId)
    .eq("program_id", programId)
    .maybeSingle();
  const doc = docData as { id: string; competition_id: string | null } | null;
  if (!doc) redirect(`/${slug}/competitions?error=attach`);

  await supabase
    .from("documents")
    .update({ competition_id: competitionId })
    .eq("id", documentId)
    .eq("program_id", programId);

  // Parse only when the flag is on (Constitution VIII, server-side gate).
  const { data: prog } = await supabase
    .from("programs")
    .select("tier, feature_overrides")
    .eq("id", programId)
    .maybeSingle();
  const parseOn = flag(
    (prog as FlaggableProgram | null) ?? { tier: "prep", feature_overrides: null },
    "packet_parse",
  );

  if (parseOn) {
    const { data: parse } = await supabase
      .from("packet_parses")
      .insert({
        program_id: programId,
        competition_id: competitionId,
        document_id: documentId,
        status: "queued",
      })
      .select("id")
      .single();
    if (parse) {
      const args = { parseId: (parse as { id: string }).id, programId, competitionId };
      if (inngestEnabled()) {
        try {
          await inngest.send({ name: "packet/parse", data: args });
        } catch {
          await runPacketParse(args.parseId);
        }
      } else {
        await runPacketParse(args.parseId);
      }
    }
  }

  revalidatePath(`/${slug}/competitions`);
  redirect(`/${slug}/competitions/${competitionId}/packet?uploaded=1`);
}
