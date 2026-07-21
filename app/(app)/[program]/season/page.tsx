import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { SETTINGS_ROLES } from "@/lib/nav";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { EVENTS_WRITE_ROLES } from "@/lib/events";
import { TRAVEL_WRITE_ROLES } from "@/lib/travel";
import { loadCompReadiness } from "@/lib/readiness";
import { activeShareLinks, seasonCalendarUrl } from "@/lib/tokens";
import { regenerateSeasonCalendarShareLink } from "./actions";
import {
  zonedWallToUtc,
  zonedDateKey,
  formatTimeInTz,
} from "@/lib/datetime";
import { formatHostedDateRange } from "@/lib/hosting";

// Season (season-workflow redesign, "Season" design ref) — one chronological
// spine for the active season, absorbing the old Competitions/Events/Travel/
// History lists. Same lean-by-construction rule the rest of the app follows:
// each source is queried ONLY when its flag is on. Read-only for every role
// (the flags are the gate). The old module routes stay live and flag/role-gated;
// this page just gives them a single ordered home. Undated items have no place
// on a chronological spine, so they're omitted here (still visible on their own
// module pages).

export const dynamic = "force-dynamic";

// Whole days from `now` to `target` (future). Past clamps to 0.
function countdownDays(target: Date, now: Date): number {
  const ms = target.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

function weekdayAbbr(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(instant)
    .toUpperCase();
}

function monthAbbr(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short" })
    .format(instant)
    .toUpperCase();
}

type ItemKind = "comp" | "event" | "trip" | "hosting";

interface SeasonItem {
  key: string;
  kind: ItemKind;
  instant: Date;
  dateKey: string; // YYYY-MM-DD in program tz
  yearMonth: string; // YYYY-MM
  dayNum: number;
  weekday: string;
  isPast: boolean;
  tag: string; // pill label
  tagClass: string; // pill variant
  title: string;
  href: string | null; // title link (comps only)
  meta: string;
  // Right-slot payloads (mutually exclusive; resolved at render).
  compId?: string;
  compStatus?: "planned" | "confirmed" | "done";
  result?: string | null;
  needsTrip?: boolean;
}

const FILTERS = ["everything", "competitions", "events", "trips"] as const;
type Filter = (typeof FILTERS)[number];

const EVENT_TAG: Record<string, { tag: string; cls: string }> = {
  rehearsal: { tag: "Rehearsal", cls: "rehearsal" },
  fundraiser: { tag: "Fundraiser", cls: "fundraiser" },
  fitting: { tag: "Fitting", cls: "event" },
  banquet: { tag: "Banquet", cls: "event" },
  other: { tag: "Event", cls: "event" },
};

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ filter?: string; calShare?: string; calError?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);

  // Any-of gate (mirrors requireFlag for the union surface): with none of the
  // absorbed flags on, Season has nothing to show and the URL 404s.
  if (
    !flags.competitions &&
    !flags.events &&
    !flags.travel &&
    !flags.archive
  ) {
    notFound();
  }

  const tz = program.timezone;
  const now = new Date();
  const base = `/${slug}`;
  const seasonId = season?.id ?? null;

  const { filter: filterParam, calShare, calError } = await searchParams;
  const filter: Filter = FILTERS.includes(filterParam as Filter)
    ? (filterParam as Filter)
    : "everything";

  const supabase = await createClient();

  // Season-calendar subscribe box (Wave G / G1) — director/admin (∪ comp-write,
  // same role set). The subscribable feed URL is knowable only at mint time
  // (hash-only storage), so it rides ?calShare= once; otherwise we show that a
  // link is active + a rotate button. Listed/revoked in Settings → Share links.
  const canManageCalendar =
    SETTINGS_ROLES.includes(role) || COMPETITION_WRITE_ROLES.includes(role);
  const activeSeasonCalLinks =
    canManageCalendar && season
      ? (await activeShareLinks(supabase, program.id)).filter(
          (l) => l.resource === "season_calendar" && l.resource_id === season.id,
        )
      : [];
  const freshSeasonCalUrl = calShare ? seasonCalendarUrl(calShare) : null;
  // Same feed, scheme swapped: Apple Calendar opens webcal:// straight into its
  // Subscribe dialog, while Google Calendar wants the https form under "From URL".
  const freshSeasonCalWebcal = freshSeasonCalUrl
    ? freshSeasonCalUrl.replace(/^https:\/\//, "webcal://")
    : null;

  // Ensemble names (shared by comp + event meta).
  const ensembleName = new Map<string, string>();
  if (seasonId && (flags.competitions || flags.events)) {
    const { data: ensData } = await supabase
      .from("ensembles")
      .select("id, name")
      .eq("program_id", program.id);
    for (const e of (ensData as { id: string; name: string }[] | null) ?? []) {
      ensembleName.set(e.id, e.name);
    }
  }

  const items: SeasonItem[] = [];
  const todayKey = zonedDateKey(now, tz);

  // Turn a date/instant into the shared spine fields.
  function place(
    kind: ItemKind,
    instant: Date,
  ): Pick<
    SeasonItem,
    "instant" | "dateKey" | "yearMonth" | "dayNum" | "weekday" | "isPast"
  > & { kind: ItemKind } {
    const dateKey = zonedDateKey(instant, tz);
    return {
      kind,
      instant,
      dateKey,
      yearMonth: dateKey.slice(0, 7),
      dayNum: Number(dateKey.slice(8, 10)),
      weekday: weekdayAbbr(instant, tz),
      isPast: dateKey < todayKey,
    };
  }

  // ---- Competitions (+ results, + trip linkage) -----------------------------
  let nextCompId: string | null = null;
  let nextCompDays: number | null = null;
  let nextCompOpenSlots = 0;
  let nextCompMeta = "";
  // Undated competitions have no place on a chronological spine, so they're
  // omitted below — but a director who added one and can't find it deserves a
  // pointer. Counted from the comps we already fetch (no extra query), surfaced
  // as a muted note near the top of the spine.
  let undatedCompCount = 0;
  if (flags.competitions && seasonId) {
    const { data: compData } = await supabase
      .from("competitions")
      .select("id, name, date, host_school, status, ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .order("date", { ascending: true, nullsFirst: false });
    const comps =
      (compData as
        | {
            id: string;
            name: string;
            date: string | null;
            host_school: string | null;
            status: "planned" | "confirmed" | "done";
            ensemble_id: string | null;
          }[]
        | null) ?? [];

    undatedCompCount = comps.filter((c) => !c.date).length;

    // Results for done comps.
    const placement = new Map<string, string | null>();
    const doneIds = comps.filter((c) => c.status === "done").map((c) => c.id);
    if (doneIds.length > 0) {
      const { data: resData } = await supabase
        .from("competition_results")
        .select("competition_id, placement")
        .eq("program_id", program.id)
        .in("competition_id", doneIds);
      for (const r of (resData as
        | { competition_id: string; placement: string | null }[]
        | null) ?? []) {
        placement.set(r.competition_id, r.placement);
      }
    }

    // Which comps already have a linked trip (only meaningful when travel is on).
    const linkedCompIds = new Set<string>();
    if (flags.travel) {
      const { data: tripLinks } = await supabase
        .from("trips")
        .select("competition_id")
        .eq("program_id", program.id)
        .eq("season_id", seasonId)
        .not("competition_id", "is", null);
      for (const t of (tripLinks as { competition_id: string | null }[] | null) ??
        []) {
        if (t.competition_id) linkedCompIds.add(t.competition_id);
      }
    }

    // Next comp = earliest upcoming planned/confirmed comp (feature row).
    const upcoming = comps.find(
      (c) =>
        c.date != null &&
        c.date >= todayKey &&
        (c.status === "planned" || c.status === "confirmed"),
    );
    nextCompId = upcoming?.id ?? null;

    for (const c of comps) {
      if (!c.date) continue; // no spine position without a date
      const instant = zonedWallToUtc(`${c.date}T00:00`, tz);
      if (!instant) continue;
      const ens = c.ensemble_id ? ensembleName.get(c.ensemble_id) : null;
      const meta = [c.host_school, ens].filter(Boolean).join(" · ") || "Host TBD";
      items.push({
        key: `comp-${c.id}`,
        ...place("comp", instant),
        tag: "Comp",
        tagClass: "comp",
        title: c.name,
        href: `${base}/competitions/${c.id}`,
        meta,
        compId: c.id,
        compStatus: c.status,
        result: c.status === "done" ? placement.get(c.id) ?? null : null,
        needsTrip: flags.travel && !linkedCompIds.has(c.id),
      });
    }

    // Feature-row extras for the next comp (reuse the readiness helper).
    if (upcoming) {
      const readiness = await loadCompReadiness(supabase, {
        programId: program.id,
        comp: upcoming,
        flags,
        role,
        base,
      });
      nextCompOpenSlots = readiness.openSlots;
      const target = readiness.firstStart
        ? new Date(readiness.firstStart)
        : zonedWallToUtc(`${upcoming.date}T00:00`, tz);
      if (target && !Number.isNaN(target.getTime())) {
        nextCompDays = countdownDays(target, now);
      }
      const ens = upcoming.ensemble_id
        ? ensembleName.get(upcoming.ensemble_id)
        : null;
      nextCompMeta = [
        readiness.firstStart
          ? `Call ${formatTimeInTz(readiness.firstStart, tz)}`
          : null,
        upcoming.host_school,
        ens,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }

  // ---- Events ---------------------------------------------------------------
  if (flags.events && seasonId) {
    const { data: eventData } = await supabase
      .from("events")
      .select("id, title, starts_at, kind, location, ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .not("starts_at", "is", null)
      .order("starts_at", { ascending: true });
    for (const e of (eventData as
      | {
          id: string;
          title: string;
          starts_at: string;
          kind: string;
          location: string | null;
          ensemble_id: string | null;
        }[]
      | null) ?? []) {
      const instant = new Date(e.starts_at);
      if (Number.isNaN(instant.getTime())) continue;
      const tag = EVENT_TAG[e.kind] ?? EVENT_TAG.other;
      const ens = e.ensemble_id
        ? ensembleName.get(e.ensemble_id)
        : "whole program";
      const meta = [e.location, formatTimeInTz(e.starts_at, tz), ens]
        .filter(Boolean)
        .join(" · ");
      items.push({
        key: `event-${e.id}`,
        ...place("event", instant),
        tag: tag.tag,
        tagClass: tag.cls,
        title: e.title,
        href: null,
        meta,
      });
    }
  }

  // ---- Trips ----------------------------------------------------------------
  if (flags.travel && seasonId) {
    const { data: tripData } = await supabase
      .from("trips")
      .select("id, name, starts_on, is_overnight")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .not("starts_on", "is", null)
      .order("starts_on", { ascending: true });
    for (const t of (tripData as
      | {
          id: string;
          name: string;
          starts_on: string;
          is_overnight: boolean;
        }[]
      | null) ?? []) {
      const instant = zonedWallToUtc(`${t.starts_on}T00:00`, tz);
      if (!instant) continue;
      items.push({
        key: `trip-${t.id}`,
        ...place("trip", instant),
        tag: "Trip",
        tagClass: "trip",
        title: t.name,
        href: `${base}/travel/${t.id}`,
        meta: t.is_overnight ? "Overnight trip" : "Day trip",
      });
    }
  }

  // ---- Hosted invitationals (Wave I2) ---------------------------------------
  // When host-mode is on, the events the program RUNS render as distinguishable
  // spine rows (a "Hosting" tag, link to the event command center). Lean: queried
  // only when the flag is on. Undated events have no spine position (omitted).
  if (flags.hosting && seasonId) {
    const { data: hostedData } = await supabase
      .from("hosted_events")
      .select("id, name, event_date, end_date")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .not("event_date", "is", null)
      .order("event_date", { ascending: true });
    for (const h of (hostedData as
      | { id: string; name: string; event_date: string; end_date: string | null }[]
      | null) ?? []) {
      const instant = zonedWallToUtc(`${h.event_date}T00:00`, tz);
      if (!instant) continue;
      // Multi-day invitationals (Wave N) show their event_date–end_date span in
      // the meta line; the spine row itself sits on the first day.
      const multiDay = h.end_date != null && h.end_date !== h.event_date;
      items.push({
        key: `hosting-${h.id}`,
        ...place("hosting", instant),
        tag: "Hosting",
        tagClass: "hosting",
        title: h.name,
        href: `${base}/hosting/${h.id}`,
        meta: multiDay
          ? `Invitational you host · ${formatHostedDateRange(h.event_date, h.end_date, tz)}`
          : "Invitational you host",
      });
    }
  }

  // Chronological order (program tz).
  items.sort((a, b) => a.instant.getTime() - b.instant.getTime());

  // Apply the active filter.
  const filterKind: Record<Exclude<Filter, "everything">, ItemKind> = {
    competitions: "comp",
    events: "event",
    trips: "trip",
  };
  const visible =
    filter === "everything"
      ? items
      : items.filter((i) => i.kind === filterKind[filter]);

  // Group consecutively by month (already sorted).
  const groups: { yearMonth: string; label: string; current: boolean; rows: SeasonItem[] }[] =
    [];
  const nowYearMonth = todayKey.slice(0, 7);
  for (const it of visible) {
    let g = groups[groups.length - 1];
    if (!g || g.yearMonth !== it.yearMonth) {
      g = {
        yearMonth: it.yearMonth,
        label: monthAbbr(it.instant, tz),
        current: it.yearMonth === nowYearMonth,
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(it);
  }

  // Filter pills — only for flag-on kinds.
  const pills: { key: Filter; label: string }[] = [{ key: "everything", label: "Everything" }];
  if (flags.competitions) pills.push({ key: "competitions", label: "Competitions" });
  if (flags.events) pills.push({ key: "events", label: "Events" });
  if (flags.travel) pills.push({ key: "trips", label: "Trips" });

  // /comms/shifts requireFlag-gates on BOTH comms AND shifts, so the "Fill
  // shifts" link only shows when both are on (otherwise it would 404).
  const canFillShifts = flags.shifts && flags.comms && SHIFT_WRITE_ROLES.includes(role);

  // Per-kind add affordances — the season spine absorbs the module lists, so it
  // must also be where a writer starts a new item. Each is gated by its flag AND
  // its module's write-role set (re-checked server-side in each create action);
  // a role with no write access sees no add buttons (the pills/rows still browse).
  // Links target the #add anchor on each module's create form.
  const canAddComp = flags.competitions && COMPETITION_WRITE_ROLES.includes(role);
  const canAddEvent = flags.events && EVENTS_WRITE_ROLES.includes(role);
  const canAddTrip = flags.travel && TRAVEL_WRITE_ROLES.includes(role);
  const canAddAny = canAddComp || canAddEvent || canAddTrip;

  return (
    <section className="season">
      <div className="season-head">
        <div className="season-head-titles">
          <p className="eyebrow">{season ? season.label : "Season"}</p>
          <h1 className="season-h1">The Season</h1>
        </div>
        <div className="season-actions">
          {canAddComp && (
            <Link href={`${base}/competitions#add`} className="button-link accent">
              + Competition
            </Link>
          )}
          {canAddEvent && (
            <Link href={`${base}/events#add`} className="button-link secondary">
              + Event
            </Link>
          )}
          {canAddTrip && (
            <Link href={`${base}/travel#add`} className="button-link secondary">
              + Trip
            </Link>
          )}
          {flags.archive && (
            <Link href={`${base}/history`} className="button-link secondary">
              Trophy case
            </Link>
          )}
        </div>
      </div>

      {!season && (
        <p className="alert-error">
          No active season yet.{" "}
          <Link href={`${base}/settings/rollover`}>Start a season</Link> to begin.
        </p>
      )}

      <div className="season-filters">
        {pills.map((p) => (
          <Link
            key={p.key}
            href={p.key === "everything" ? `${base}/season` : `${base}/season?filter=${p.key}`}
            className={`season-filter${filter === p.key ? " active" : ""}`}
            aria-current={filter === p.key ? "true" : undefined}
          >
            {p.label}
          </Link>
        ))}
        <span className="season-filter-note">
          Competitions, events, and travel — one spine, in order.
        </span>
      </div>

      {/* Subscribe in your calendar (Wave G / G1) — director/admin. One live
          feed of the whole season for Google Calendar / Apple Calendar. */}
      {canManageCalendar && season && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <h2>Subscribe in your calendar</h2>
          {calError === "season" && (
            <p className="alert-error">Activate a season before creating a calendar link.</p>
          )}
          {calError === "mint" && (
            <p className="alert-error">
              The old calendar link was retired, but a new one couldn&apos;t be created. Try
              again.
            </p>
          )}
          {freshSeasonCalUrl ? (
            <>
              <p className="muted">
                A live calendar feed of {season.label} — every competition, event,
                and trip. Copy it now (for privacy the URL is shown only this once).
                It stays current all season — new comps and time changes appear
                automatically.
              </p>
              <p className="muted">
                <strong>Google Calendar:</strong> use the https link (Other calendars →
                From URL).
              </p>
              <code style={{ wordBreak: "break-all" }}>{freshSeasonCalUrl}</code>
              <p className="muted">
                <strong>Apple Calendar:</strong> the webcal link opens Subscribe directly.
              </p>
              <code style={{ wordBreak: "break-all" }}>{freshSeasonCalWebcal}</code>
            </>
          ) : activeSeasonCalLinks.length > 0 ? (
            <p className="muted">
              A season calendar link is active for {season.label}. For privacy the
              URL is only shown once at creation — regenerate to get a fresh copyable
              link (the old one stops working). Active links are listed in{" "}
              <Link href={`/${slug}/settings`}>Settings → Share links</Link>.
            </p>
          ) : (
            <p className="muted">
              Create a live calendar feed of the whole season. Paste it into Google
              Calendar (<strong>Other calendars → From URL</strong>) or Apple
              Calendar — it updates itself as the season changes, so you never
              re-enter a date.
            </p>
          )}
          <form action={regenerateSeasonCalendarShareLink}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <button type="submit" className="secondary">
              {activeSeasonCalLinks.length > 0
                ? "Regenerate calendar link"
                : "Create calendar link"}
            </button>
          </form>
        </div>
      )}

      {undatedCompCount > 0 && (
        <p className="muted season-undated-note">
          {undatedCompCount} competition{undatedCompCount === 1 ? "" : "s"} without
          a date {undatedCompCount === 1 ? "isn't" : "aren't"} shown on the timeline
          — <Link href={`${base}/competitions`}>set dates on the Competitions page</Link>.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="muted">
          Nothing on the season calendar yet.
          {canAddAny && (
            <>
              {" "}
              Add{" "}
              {canAddComp && (
                <Link href={`${base}/competitions#add`}>a competition</Link>
              )}
              {canAddComp && (canAddEvent || canAddTrip) &&
                (canAddEvent && canAddTrip ? ", " : " or ")}
              {canAddEvent && (
                <Link href={`${base}/events#add`}>an event</Link>
              )}
              {canAddEvent && canAddTrip && " or "}
              {canAddTrip && <Link href={`${base}/travel#add`}>a trip</Link>}
              {" to get started."}
            </>
          )}
        </p>
      ) : (
        <section className="season-months">
          {groups.map((g) => (
            <div key={g.yearMonth}>
              <div className="month-head">
                <span className={`month-abbr${g.current ? " current" : ""}`}>
                  {g.label}
                </span>
                <span className="month-rule" aria-hidden="true" />
                {g.current && <span className="month-here">← You are here</span>}
              </div>
              {g.rows.map((it) =>
                it.compId && it.compId === nextCompId ? (
                  <div className="season-feature" key={it.key}>
                    <div className="season-feature-date">
                      <div className="season-feature-num">{it.dayNum}</div>
                      <div className="season-date-dow">{it.weekday}</div>
                    </div>
                    <div className="season-feature-body">
                      <div className="season-feature-badges">
                        <span className="season-next-pill">
                          Next comp
                          {nextCompDays != null
                            ? ` · ${nextCompDays} day${nextCompDays === 1 ? "" : "s"}`
                            : ""}
                        </span>
                        {canFillShifts && nextCompOpenSlots > 0 && (
                          <span className="season-shift-chip">
                            <span className="status-dot warn" aria-hidden="true" />
                            {nextCompOpenSlots} shift slot
                            {nextCompOpenSlots === 1 ? "" : "s"} open
                          </span>
                        )}
                      </div>
                      <div className="season-feature-title">
                        <Link href={`${base}/competitions/${it.compId}`}>
                          {it.title}
                        </Link>
                      </div>
                      <div className="season-feature-meta">
                        {nextCompMeta || it.meta}
                      </div>
                      <div className="season-feature-actions">
                        <Link
                          href={`${base}/competitions/${it.compId}`}
                          className="button-link"
                        >
                          Open comp week
                        </Link>
                        <Link
                          href={`${base}/competitions/${it.compId}/itinerary`}
                          className="button-link secondary"
                        >
                          Itinerary
                        </Link>
                        {canFillShifts && (
                          <Link
                            href={`${base}/comms/shifts`}
                            className="button-link secondary"
                          >
                            Fill shifts
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`season-row${it.isPast ? " past" : ""}`}
                    key={it.key}
                  >
                    <div className="season-date">
                      <div className="season-date-num">{it.dayNum}</div>
                      <div className="season-date-dow">{it.weekday}</div>
                    </div>
                    <span className={`kind-tag ${it.tagClass}`}>{it.tag}</span>
                    <div className="season-row-main">
                      <div className="season-row-title">
                        {it.href ? (
                          <Link href={it.href}>{it.title}</Link>
                        ) : (
                          it.title
                        )}
                      </div>
                      <div className="season-row-meta">{it.meta}</div>
                    </div>
                    <div className="season-row-right">
                      {it.result ? (
                        <span className="season-result">🏆 {it.result}</span>
                      ) : it.needsTrip ? (
                        <span className="season-no-trip">
                          <span className="status-dot alert" aria-hidden="true" />
                          No trip yet —{" "}
                          <Link href={`${base}/travel`}>create trip</Link>
                        </span>
                      ) : it.kind === "hosting" ? (
                        <Link className="season-link" href={it.href ?? `${base}/hosting`}>
                          Open
                        </Link>
                      ) : it.kind === "trip" ? (
                        <Link className="season-link" href={it.href ?? `${base}/travel`}>
                          Plan
                        </Link>
                      ) : it.kind === "event" ? (
                        <Link
                          className="season-link"
                          href={`${base}/events?view=month&ref=${it.dateKey}`}
                        >
                          View
                        </Link>
                      ) : (
                        <Link
                          className="season-link"
                          href={`${base}/competitions/${it.compId}`}
                        >
                          Open
                        </Link>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
