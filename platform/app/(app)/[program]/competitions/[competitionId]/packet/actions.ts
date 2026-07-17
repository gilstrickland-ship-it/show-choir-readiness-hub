"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { flag, type FlaggableProgram } from "@/lib/flags";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { runPacketParse } from "@/lib/ai/packet-parse";

// Packet upload + parse trigger (§5, T015, Constitution IV). Upload a PDF/image to
// Storage under {program_id}/{competition_id}/..., record a documents row, and —
// when the packet_parse flag is on — enqueue an AI parse (Inngest) or run it
// inline as a fallback when Inngest isn't configured (dev/pilot). The document is
// recorded even with the flag off, so the manual editor can still show it (T014).

function packetPath(slug: string, competitionId: string): string {
  return `/${slug}/competitions/${competitionId}/packet`;
}

const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "packet";
}

async function packetParseOn(programId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("programs")
    .select("feature_overrides")
    .eq("id", programId)
    .maybeSingle();
  return flag((data as FlaggableProgram | null) ?? { feature_overrides: null }, "packet_parse");
}

async function triggerParse(args: {
  parseId: string;
  programId: string;
  competitionId: string;
}): Promise<void> {
  if (inngestEnabled()) {
    try {
      await inngest.send({ name: "packet/parse", data: args });
      return;
    } catch {
      // fall through to inline
    }
  }
  // Inline fallback: run synchronously. runPacketParse handles its own errors and
  // leaves the row in review/failed — it never throws for API/Storage issues.
  await runPacketParse(args.parseId);
}

export async function uploadPacket(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const competitionId = String(formData.get("competitionId") ?? "");
  const { user } = await requireRole(programId, COMPETITION_WRITE_ROLES);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`${packetPath(slug, competitionId)}?error=file`);
  }
  const typedFile = file as File;
  if (!ALLOWED.has(typedFile.type)) {
    redirect(`${packetPath(slug, competitionId)}?error=type`);
  }

  const supabase = await createClient();
  const path = `${programId}/${competitionId}/${Date.now()}-${sanitizeName(typedFile.name)}`;
  const bytes = Buffer.from(await typedFile.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, bytes, { contentType: typedFile.type, upsert: false });
  if (upErr) {
    redirect(`${packetPath(slug, competitionId)}?error=upload`);
  }

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      program_id: programId,
      competition_id: competitionId,
      kind: "host_packet",
      storage_path: path,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (docErr || !doc) {
    redirect(`${packetPath(slug, competitionId)}?error=save`);
  }

  // AI parse only when the flag is on (Constitution VIII, server-side gate).
  if (await packetParseOn(programId)) {
    const { data: parse } = await supabase
      .from("packet_parses")
      .insert({
        program_id: programId,
        competition_id: competitionId,
        document_id: doc.id,
        status: "queued",
      })
      .select("id")
      .single();
    if (parse) {
      await triggerParse({ parseId: parse.id, programId, competitionId });
    }
  }

  revalidatePath(packetPath(slug, competitionId));
  redirect(`${packetPath(slug, competitionId)}?uploaded=1`);
}

// Re-run a parse (e.g. after a failure). Resets to queued and re-triggers.
export async function reparsePacket(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const competitionId = String(formData.get("competitionId") ?? "");
  const parseId = String(formData.get("parseId") ?? "");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("packet_parses")
    .update({ status: "queued", error: null })
    .eq("id", parseId)
    .eq("program_id", programId);

  await triggerParse({ parseId, programId, competitionId });

  revalidatePath(packetPath(slug, competitionId));
  redirect(`${packetPath(slug, competitionId)}?uploaded=1`);
}
