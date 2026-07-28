"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COMPETITION_WRITE_ROLES, resolveCompetitionId } from "@/lib/competitions";
import { flag, type FlaggableProgram } from "@/lib/flags";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { runPacketParse } from "@/lib/ai/packet-parse";
import { programPath } from "@/lib/return-path";

// Packet upload + parse trigger (§5, T015, Constitution IV). Upload a PDF/image to
// Storage under {program_id}/{competition_id}/..., record a documents row, and —
// when the packet_parse flag is on — enqueue an AI parse (Inngest) or run it
// inline as a fallback when Inngest isn't configured (dev/pilot). The document is
// recorded even with the flag off, so the manual editor can still show it (T014).

function packetPath(slug: string, competitionId: string): string {
// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
  return programPath(slug, `competitions/${competitionId}/packet`) ?? "/";
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
    .select("tier, feature_overrides")
    .eq("id", programId)
    .maybeSingle();
  return flag(
    (data as FlaggableProgram | null) ?? { tier: "prep", feature_overrides: null },
    "packet_parse",
  );
}

// A parse row is only safe to hand to the service-role worker once BOTH of the
// rows it points at have been proved to belong to this program. The worker runs
// with RLS bypassed, so a row poisoned out-of-band (PostgREST accepts direct
// inserts) would otherwise have it read another tenant's document and
// competition. Returns the row's status, or null when anything is out of tenant.
async function dispatchableParse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  parseId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("packet_parses")
    .select("status, competition_id, document_id")
    .eq("id", parseId)
    .eq("program_id", programId)
    .maybeSingle();
  const parse = data as
    | { status: string; competition_id: string; document_id: string }
    | null;
  if (!parse) return null;

  const [comp, { data: docRow }] = await Promise.all([
    resolveCompetitionId(supabase, programId, parse.competition_id),
    supabase
      .from("documents")
      .select("id")
      .eq("id", parse.document_id)
      .eq("program_id", programId)
      .maybeSingle(),
  ]);
  if (!comp || !docRow) return null;
  return parse.status;
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

  // competitionId is a hidden field. Resolve it inside this program BEFORE the
  // upload: it names the storage folder, and it is the id the documents and
  // packet_parses rows below are filed under (Constitution I).
  if (!(await resolveCompetitionId(supabase, programId, competitionId))) {
    redirect(`${packetPath(slug, competitionId)}?error=save`);
  }

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

// Run a stuck parse inline (F7). Rows can strand in queued/running when the
// inline fallback process died or Inngest never delivered. This runs the existing
// worker synchronously. runPacketParse re-reads the row and drives it through
// running → review/failed; we only invoke it while the row is still queued/running
// so a completed row (someone else finished, double-submit) is left untouched.
export async function runParseNow(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const competitionId = String(formData.get("competitionId") ?? "");
  const parseId = String(formData.get("parseId") ?? "");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  const status = await dispatchableParse(supabase, programId, parseId);
  if (status === null) redirect(`${packetPath(slug, competitionId)}?error=parse`);
  if (status === "queued" || status === "running") {
    await runPacketParse(parseId);
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
  if ((await dispatchableParse(supabase, programId, parseId)) === null) {
    redirect(`${packetPath(slug, competitionId)}?error=parse`);
  }

  await supabase
    .from("packet_parses")
    .update({ status: "queued", error: null })
    .eq("id", parseId)
    .eq("program_id", programId);

  await triggerParse({ parseId, programId, competitionId });

  revalidatePath(packetPath(slug, competitionId));
  redirect(`${packetPath(slug, competitionId)}?uploaded=1`);
}
