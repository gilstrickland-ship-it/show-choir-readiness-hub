import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveToken,
  logTokenEvent,
  parentSurfaceAvailable,
  documentAllowsToken,
} from "@/lib/tokens";
import {
  getClientIp,
  rateLimitRawToken,
  UNAVAILABLE_MESSAGE,
} from "@/lib/public-token";
import { renderParentPacket } from "@/lib/pdf/render";

// Parent packet on the tokenized surface (§8a, §9, F15). Parents never had a way
// to download the packet PDF — it was staff-only behind api/pdf. This route opens
// it to THE FAMILY, under the published-only invariant (§9.3) and the same
// rate-limit + audit guards as every other token surface. RLS does not apply to
// anonymous visitors, so the service-role client is used and eligibility is
// checked explicitly here.
//
// GUARDIAN TOKENS ONLY. This route used to accept an `itinerary` SHARE link too,
// and that was the bug: publishing an itinerary auto-mints a broadcast link, the
// director is told they shared the times, and the same URL served a PDF printing
// bus and hotel-ROOM assignments student by student, plus chaperone and
// volunteer names. A link meant for a booster Facebook post cannot carry a
// rooming list for minors. The capability was narrowed to match the promise
// rather than the promise widened to match the capability (Constitution III;
// see SHARE_CAPABILITIES in lib/tokens). A share token now 404s here exactly
// like an unknown one — the itinerary times it WAS promised are still at
// /t/<token>/itinerary and its .ics.

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
    .select("id, season_id")
    .eq("id", args.competitionId)
    .eq("program_id", args.programId)
    .maybeSingle();
  const competition = comp as { id: string; season_id: string } | null;
  if (!competition) return false;

  // A competition can include several ensembles (Feature 004) — read the junction.
  const { data: ceRows } = await supabase
    .from("competition_ensembles")
    .select("ensemble_id")
    .eq("program_id", args.programId)
    .eq("competition_id", competition.id);
  const ensembleIds = ((ceRows as { ensemble_id: string }[] | null) ?? []).map(
    (r) => r.ensemble_id,
  );
  if (ensembleIds.length === 0) return false;

  const { data: mems } = await supabase
    .from("ensemble_members")
    .select("student_id")
    .eq("program_id", args.programId)
    .eq("season_id", competition.season_id)
    .in("ensemble_id", ensembleIds)
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

  // 3. Eligibility: GUARDIAN TOKENS ONLY, asked of the one table that decides it
  //    (DOCUMENT_TOKEN_KINDS) rather than answered again here. A share link — of
  //    any resource, including its own competition's `itinerary` — reveals
  //    nothing, so it gets the same "Not found" as a token that never existed.
  //    Checked BEFORE the flag gate below, so the calm "your program doesn't use
  //    this" sentence is only ever said to a family, never to whoever picked a
  //    broadcast URL out of a public post.
  if (!documentAllowsToken("packet_pdf", resolved.kind)) {
    return text("Not found", 404);
  }
  // The table above is the policy. This line is only TypeScript learning what it
  // already decided — `resolved.students` exists on the guardian branch alone.
  if (resolved.kind !== "guardian") return text("Not found", 404);

  // 4. The owning program must actually run competitions (Constitution VIII —
  //    the rule lives in lib/tokens PARENT_SURFACE_FLAGS). A file route has no
  //    page to render, so the calm sentence rides as the 404 body.
  if (!parentSurfaceAvailable(resolved.program, "packet")) {
    return text(UNAVAILABLE_MESSAGE, 404);
  }

  const supabase = createAdminClient();

  const competitionId = url.searchParams.get("competition");
  if (!competitionId) return text("Missing ?competition=", 400);
  const eligible = await guardianMayAccessCompetition(supabase, {
    programId: resolved.program.id,
    studentIds: resolved.students.map((s) => s.id),
    competitionId,
  });
  if (!eligible) return text("Not found", 404);

  // 5. Audit the download (best-effort — never blocks the render).
  await logTokenEvent({
    programId: resolved.program.id,
    kind: resolved.kind,
    tokenId: resolved.tokenId,
    action: "packet:download",
    ip,
    supabase,
  });

  // 6. Render via the shared packet renderer (published-only gate → 409/404).
  const result = await renderParentPacket(supabase, competitionId);
  if (!result.ok) return text(result.message, result.status);
  return result.response;
}
