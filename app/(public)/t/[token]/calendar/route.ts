import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveToken,
  logTokenEvent,
  seasonCalendarAvailable,
  documentAllowsToken,
} from "@/lib/tokens";
import { flag } from "@/lib/flags";
import {
  getClientIp,
  rateLimitRawToken,
  UNAVAILABLE_MESSAGE,
} from "@/lib/public-token";
import { brand } from "@/lib/brand";
import { buildIcs, type IcsItem } from "@/lib/ics";

// Subscribable staff season calendar (.ics) on the tokenized surface (§8a, Wave
// G / G1). Parents already got a per-competition ICS; directors want the WHOLE
// season live in Google Calendar. A season_calendar share link (resource_id = a
// season id) resolves here and emits the season's competitions, events, and trips
// as one text/calendar feed the calendar app re-polls on its own. Mirrors the
// packet/ics routes exactly: same rate-limit + audit guards, service-role client
// (RLS does not apply to anonymous visitors), revocable like every share link.
// SHARE TOKENS ONLY — a guardian (per-family) token never addresses a season.
// Feature-flagged like the rest of the parent surface (Constitution VIII); this
// is the one ANY-OF gate, and each section inside is filtered on its own flag.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Rate-limit (per-IP + per-token, §10) — same budget as every token surface.
  const ip = await getClientIp();
  if (!rateLimitRawToken(ip, token).ok) {
    return text("Too many requests — please wait a moment and try again.", 429);
  }

  // 2. Resolve via the service-role client. 404 cleanly on invalid/revoked/expired.
  const resolved = await resolveToken(token);
  if (!resolved) return text("Not found", 404);

  // 3. Eligibility: a season_calendar SHARE link only — the token kind from the
  //    one table that decides it (DOCUMENT_TOKEN_KINDS), the resource here.
  //    Anything else 404s (a guardian token, or a share link for a different
  //    resource, reveals nothing).
  if (!documentAllowsToken("season_feed", resolved.kind)) {
    return text("Not found", 404);
  }
  if (resolved.kind !== "share" || resolved.resource !== "season_calendar") {
    return text("Not found", 404);
  }

  // 3b. Feature flags (Constitution VIII — rule in lib/tokens). This is the one
  //     ANY-OF surface, mirroring the Season page that mints the link: it 404s
  //     only when competitions, events AND travel are all off. Each SECTION
  //     below is then filtered by its own flag, so a program with events turned
  //     off never has an event appear in a calendar someone already subscribed
  //     to — turning a feature off has to empty the feed too, not just the page.
  if (!seasonCalendarAvailable(resolved.program)) {
    return text(UNAVAILABLE_MESSAGE, 404);
  }
  const showCompetitions = flag(resolved.program, "competitions");
  const showEvents = flag(resolved.program, "events");
  const showTrips = flag(resolved.program, "travel");

  const programId = resolved.program.id;
  const seasonId = resolved.resource_id;

  const supabase = createAdminClient();

  // Confirm the season still exists in this program (a deleted season → empty
  // feed via 404 rather than a stale calendar).
  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("id, label")
    .eq("id", seasonId)
    .eq("program_id", programId)
    .maybeSingle();
  const season = seasonRow as { id: string; label: string } | null;
  if (!season) return text("Not found", 404);

  const items: IcsItem[] = [];

  // ---- Competitions -------------------------------------------------------
  // Dated comps only. Timed from the published itinerary's FIRST timed item when
  // one exists (a real call time), else an all-day event on the comp date. Draft
  // itineraries contribute nothing beyond the comp's own date (invariant §9.3).
  const { data: compRows } = showCompetitions
    ? await supabase
        .from("competitions")
        .select("id, name, date, host_school")
        .eq("program_id", programId)
        .eq("season_id", seasonId)
        .not("date", "is", null)
    : { data: null };
  const comps =
    (compRows as
      | { id: string; name: string; date: string | null; host_school: string | null }[]
      | null) ?? [];
  const emittedCompIds = new Set<string>();

  // First published-itinerary call time per competition (one batched pass).
  const firstStartByComp = new Map<string, string>();
  if (comps.length > 0) {
    const compIds = comps.map((c) => c.id);
    const { data: itinRows } = await supabase
      .from("itineraries")
      .select("id, competition_id")
      .eq("program_id", programId)
      .eq("status", "published")
      .in("competition_id", compIds);
    const itins =
      (itinRows as { id: string; competition_id: string }[] | null) ?? [];
    if (itins.length > 0) {
      const itinToComp = new Map(itins.map((i) => [i.id, i.competition_id]));
      const { data: itemRows } = await supabase
        .from("itinerary_items")
        .select("itinerary_id, starts_at")
        .eq("program_id", programId)
        .in(
          "itinerary_id",
          itins.map((i) => i.id),
        )
        .not("starts_at", "is", null)
        .order("starts_at", { ascending: true });
      for (const it of (itemRows as
        | { itinerary_id: string; starts_at: string }[]
        | null) ?? []) {
        const compId = itinToComp.get(it.itinerary_id);
        // Rows arrive earliest-first, so the first seen per comp is the call time.
        if (compId && !firstStartByComp.has(compId)) {
          firstStartByComp.set(compId, it.starts_at);
        }
      }
    }
  }

  for (const c of comps) {
    if (!c.date) continue;
    emittedCompIds.add(c.id);
    const firstStart = firstStartByComp.get(c.id) ?? null;
    if (firstStart) {
      items.push({
        id: `comp-${c.id}`,
        title: c.name,
        kind: "competition",
        startsAt: firstStart,
        endsAt: null,
        location: c.host_school,
        details: null,
      });
    } else {
      items.push({
        id: `comp-${c.id}`,
        title: c.name,
        kind: "competition",
        startsAt: null,
        endsAt: null,
        location: c.host_school,
        details: null,
        allDay: true,
        allDayStart: c.date,
        allDayEnd: c.date,
      });
    }
  }

  // ---- Events (timed) -----------------------------------------------------
  const { data: eventRows } = showEvents
    ? await supabase
        .from("events")
        .select("id, title, starts_at, ends_at, location")
        .eq("program_id", programId)
        .eq("season_id", seasonId)
        .not("starts_at", "is", null)
    : { data: null };
  for (const e of (eventRows as
    | {
        id: string;
        title: string;
        starts_at: string;
        ends_at: string | null;
        location: string | null;
      }[]
    | null) ?? []) {
    items.push({
      id: `event-${e.id}`,
      title: e.title,
      kind: "event",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      location: e.location,
      details: null,
    });
  }

  // ---- Trips (all-day span) ----------------------------------------------
  // Skip a trip that duplicates a comp already on the feed: a single-day trip
  // auto-created for a day competition would land on the exact same date as the
  // comp. A MULTI-DAY trip (starts_on != ends_on) always emits — its span carries
  // real information (nationals runs Thu–Sun) the comp's single date does not.
  const { data: tripRows } = showTrips
    ? await supabase
        .from("trips")
        .select("id, name, starts_on, ends_on, competition_id")
        .eq("program_id", programId)
        .eq("season_id", seasonId)
        .not("starts_on", "is", null)
    : { data: null };
  for (const t of (tripRows as
    | {
        id: string;
        name: string;
        starts_on: string;
        ends_on: string | null;
        competition_id: string | null;
      }[]
    | null) ?? []) {
    const singleDay = !t.ends_on || t.ends_on === t.starts_on;
    if (singleDay && t.competition_id && emittedCompIds.has(t.competition_id)) {
      continue; // day-comp auto-trip — the competition already covers this date.
    }
    items.push({
      id: `trip-${t.id}`,
      title: t.name,
      kind: "trip",
      startsAt: null,
      endsAt: null,
      location: null,
      details: null,
      allDay: true,
      allDayStart: t.starts_on,
      allDayEnd: t.ends_on ?? t.starts_on,
    });
  }

  // 4. Audit the download (best-effort — never blocks the response).
  await logTokenEvent({
    programId,
    kind: resolved.kind,
    tokenId: resolved.tokenId,
    action: "season:calendar",
    ip,
    supabase,
  });

  const body = buildIcs({
    brandName: brand.name,
    uidDomain: brand.domain,
    productName: "Season Calendar",
    calendarName: `${resolved.program.name} — ${season.label}`,
    refreshInterval: "PT12H",
    items,
  });

  // Times ride as UTC instants (each subscriber's app renders them in its own tz);
  // all-day dates are tz-agnostic. So the feed needs no server-side tz formatting.
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="season.ics"',
      "Cache-Control": "no-store",
    },
  });
}
