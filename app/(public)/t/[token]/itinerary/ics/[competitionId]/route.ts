import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveToken,
  logTokenEvent,
  guardianCan,
  parentSurfaceAvailable,
  documentAllowsToken,
} from "@/lib/tokens";
import {
  getClientIp,
  rateLimitRawToken,
  UNAVAILABLE_MESSAGE,
} from "@/lib/public-token";
import { brand } from "@/lib/brand";
import { buildIcs, slugifyForFilename, type IcsItem } from "@/lib/ics";

// Add-to-calendar (.ics) for a published itinerary on the tokenized surface
// (§8a, §9.3, C2-1). Parents had to hand-copy call times; this hands their
// calendar app a subscribable file of the same published items they already see
// on /itinerary. Same rate-limit + audit guards and the same published-only
// invariant as the packet route. RLS does not apply to anonymous visitors, so
// the service-role client is used and eligibility is checked explicitly here.
//
// It does NOT share the packet route's token boundary any more, and the reason
// is the CONTENT: this file is the schedule the shared itinerary page already
// prints, so a broadcast `itinerary` share link may pull it. The packet PDF
// names students against hotel rooms, so that one is guardian-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

// A guardian may pull the calendar for any competition of one of THEIR students'
// ensembles (active season) — identical to the packet route's check.
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
  { params }: { params: Promise<{ token: string; competitionId: string }> },
) {
  const { token, competitionId } = await params;

  // 1. Rate-limit (per-IP + per-token, §10) — same budget as every token surface.
  const ip = await getClientIp();
  if (!rateLimitRawToken(ip, token).ok) {
    return text("Too many requests — please wait a moment and try again.", 429);
  }

  // 2. Resolve via the service-role client. 404 cleanly on invalid/revoked/expired.
  const resolved = await resolveToken(token);
  if (!resolved) return text("Not found", 404);

  // 3. The owning program must run competitions (Constitution VIII — the rule
  //    lives in lib/tokens PARENT_SURFACE_FLAGS). No page to render here, so the
  //    calm sentence is the 404 body.
  if (!parentSurfaceAvailable(resolved.program, "itinerary")) {
    return text(UNAVAILABLE_MESSAGE, 404);
  }

  const supabase = createAdminClient();

  // 4. Eligibility (capability boundary) for this token kind, from the one table
  //    that decides it (DOCUMENT_TOKEN_KINDS). A share link keeps the .ics: it
  //    carries the same published TIMES the shared page shows, and no student,
  //    chaperone or room name — which is exactly why the packet, on the same
  //    competition, is guardian-only.
  if (!documentAllowsToken("itinerary_ics", resolved.kind)) {
    return text("Not found", 404);
  }
  if (resolved.kind === "share") {
    // Only an itinerary share link maps to a competition, and only to ITS own.
    if (resolved.resource !== "itinerary") return text("Not found", 404);
    if (resolved.resource_id !== competitionId) return text("Not found", 404);
  } else {
    // Guardian tokens: itinerary:view is on the allow-list; then the family must
    // actually be eligible for this competition.
    if (!guardianCan("itinerary:view")) return text("Not found", 404);
    const eligible = await guardianMayAccessCompetition(supabase, {
      programId: resolved.program.id,
      studentIds: resolved.students.map((s) => s.id),
      competitionId,
    });
    if (!eligible) return text("Not found", 404);
  }

  // 5. Load the PUBLISHED itinerary (invariant §9.3) — drafts are never visible.
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("id", competitionId)
    .eq("program_id", resolved.program.id)
    .maybeSingle();
  const competition = comp as { id: string; name: string } | null;
  if (!competition) return text("Not found", 404);

  const { data: itin } = await supabase
    .from("itineraries")
    .select("id")
    .eq("program_id", resolved.program.id)
    .eq("competition_id", competitionId)
    .eq("status", "published")
    .maybeSingle();
  const itinerary = itin as { id: string } | null;
  if (!itinerary) return text("This itinerary is not published yet.", 404);

  const { data: itemData } = await supabase
    .from("itinerary_items")
    .select("id, starts_at, ends_at, kind, title, location, details, sort_order")
    .eq("program_id", resolved.program.id)
    .eq("itinerary_id", itinerary.id)
    .order("sort_order", { ascending: true })
    .order("starts_at", { ascending: true });

  const rows =
    (itemData as
      | Array<{
          id: string;
          starts_at: string | null;
          ends_at: string | null;
          kind: string;
          title: string | null;
          location: string | null;
          details: string | null;
        }>
      | null) ?? [];

  const items: IcsItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    location: r.location,
    details: r.details,
  }));

  // 6. Audit the download (best-effort — never blocks the response).
  await logTokenEvent({
    programId: resolved.program.id,
    kind: resolved.kind,
    tokenId: resolved.tokenId,
    action: "itinerary:ics",
    ip,
    supabase,
  });

  const body = buildIcs({
    competitionName: competition.name,
    brandName: brand.name,
    uidDomain: brand.domain,
    items,
  });
  const filename = `${slugifyForFilename(competition.name)}.ics`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
