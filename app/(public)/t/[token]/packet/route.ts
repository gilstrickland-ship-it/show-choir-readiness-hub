import { createAdminClient } from "@/lib/supabase/admin";
import { resolveToken, logTokenEvent } from "@/lib/tokens";
import { getClientIp, rateLimitRawToken } from "@/lib/public-token";
import { renderParentPacket } from "@/lib/pdf/render";

// Parent packet on the tokenized surface (§8a, §9, F15). Parents never had a way
// to download the packet PDF — it was staff-only behind api/pdf. This route opens
// it to the family (guardian token) and to a published-itinerary share link,
// under the SAME published-only invariant (§9.3) and the same rate-limit + audit
// guards as every other token surface. RLS does not apply to anonymous visitors,
// so the service-role client is used and eligibility is checked explicitly here.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

// A guardian may pull the packet for any competition of one of THEIR students'
// ensembles (active season). Returns true only when the competition is in the
// token's program and targets a family ensemble. Publication is enforced later
// by renderParentPacket (409 when not published).
async function guardianMayAccessCompetition(
  supabase: ReturnType<typeof createAdminClient>,
  args: { programId: string; studentIds: string[]; competitionId: string },
): Promise<boolean> {
  if (args.studentIds.length === 0) return false;

  const { data: comp } = await supabase
    .from("competitions")
    .select("id, ensemble_id, season_id")
    .eq("id", args.competitionId)
    .eq("program_id", args.programId)
    .maybeSingle();
  const competition = comp as
    | { id: string; ensemble_id: string | null; season_id: string }
    | null;
  if (!competition || !competition.ensemble_id) return false;

  const { data: mems } = await supabase
    .from("ensemble_members")
    .select("student_id")
    .eq("program_id", args.programId)
    .eq("season_id", competition.season_id)
    .eq("ensemble_id", competition.ensemble_id)
    .in("student_id", args.studentIds)
    .limit(1);
  return ((mems as { student_id: string }[] | null) ?? []).length > 0;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(request.url);

  // 1. Rate-limit (per-IP + per-token, §10) — same budget as every token surface.
  const ip = await getClientIp();
  if (!rateLimitRawToken(ip, token).ok) {
    return text("Too many requests — please wait a moment and try again.", 429);
  }

  // 2. Resolve via the service-role client. 404 cleanly on invalid/revoked/expired.
  const resolved = await resolveToken(token);
  if (!resolved) return text("Not found", 404);

  const supabase = createAdminClient();

  // 3. Determine the eligible competition for this token kind.
  let competitionId: string | null = null;
  if (resolved.kind === "share") {
    // Only an itinerary share link maps to a competition packet.
    if (resolved.resource !== "itinerary") return text("Not found", 404);
    competitionId = resolved.resource_id;
  } else {
    competitionId = url.searchParams.get("competition");
    if (!competitionId) return text("Missing ?competition=", 400);
    const eligible = await guardianMayAccessCompetition(supabase, {
      programId: resolved.program.id,
      studentIds: resolved.students.map((s) => s.id),
      competitionId,
    });
    if (!eligible) return text("Not found", 404);
  }

  // 4. Audit the download (best-effort — never blocks the render).
  await logTokenEvent({
    programId: resolved.program.id,
    kind: resolved.kind,
    tokenId: resolved.tokenId,
    action: "packet:download",
    ip,
    supabase,
  });

  // 5. Render via the shared packet renderer (published-only gate → 409/404).
  const result = await renderParentPacket(supabase, competitionId);
  if (!result.ok) return text(result.message, result.status);
  return result.response;
}
