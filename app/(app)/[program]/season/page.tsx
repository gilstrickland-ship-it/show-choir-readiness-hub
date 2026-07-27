import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { SETTINGS_ROLES } from "@/lib/nav";
import {
  COMPETITION_WRITE_ROLES,
  COMPETITION_STATUSES,
  COMPETITION_STATUS_LABELS,
  competitionEnsembleMap,
  eventEnsembleMap,
} from "@/lib/competitions";
import {
  EVENTS_WRITE_ROLES,
  EVENT_KINDS,
  EVENT_KIND_LABELS,
} from "@/lib/events";
import { TRAVEL_WRITE_ROLES } from "@/lib/travel";
import { loadCompReadiness } from "@/lib/readiness";
import { activeShareLinks, seasonCalendarUrl } from "@/lib/tokens";
import { regenerateSeasonCalendarShareLink } from "./actions";
import { createCompetition, updateCompetition } from "../competitions/actions";
import { createEvent, updateEvent } from "../events/actions";
import { createTrip, updateTrip } from "../travel/actions";
import {
  zonedWallToUtc,
  zonedDateKey,
  toZonedInputValue,
  formatDateInTz,
  formatTimeInTz,
} from "@/lib/datetime";
import { formatHostedDateRange } from "@/lib/hosting";
import { StartSeasonCard } from "../StartSeasonCard";

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

// Row-edit payloads (US2). Every field here comes out of the query the spine
// already runs — the popover adds no per-row read. Fields the popover does NOT
// show still ride along as hidden inputs, because the update actions read an
// absent field as "clear it": leaving out an event's audience, note or end time
// (or a trip's linked competition) would quietly wipe them on a date fix.
interface CompEdit {
  id: string;
  name: string;
  date: string;
  status: "planned" | "confirmed" | "done";
  hostSchool: string;
  venueAddress: string;
  showchoirUrl: string;
  ensembleIds: string[];
}
interface EventEdit {
  id: string;
  title: string;
  startsWall: string; // program-tz wall clock, the datetime-local shape
  endsWall: string;
  location: string;
  note: string;
  eventKind: string;
  ensembleIds: string[];
}
interface TripEdit {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isOvernight: boolean;
  competitionId: string;
}

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
  // Edit-popover payload (writer roles only; hosting rows never carry one).
  compEdit?: CompEdit;
  eventEdit?: EventEdit;
  tripEdit?: TripEdit;
}

const FILTERS = ["everything", "competitions", "events", "trips"] as const;
type Filter = (typeof FILTERS)[number];

// Quick-add drawer sections. `?add=<kind>` opens the drawer on that section —
// which is also how a failed create comes back (the action redirects here with
// its existing ?error= code plus the section key, the roster-drawer pattern).
const ADD_KINDS = ["comp", "event", "trip"] as const;
type AddKind = (typeof ADD_KINDS)[number];

// The create actions' error codes, reworded not at all: these are the same
// messages the module pages show, rendered inside the section that produced them.
const ADD_ERROR: Record<AddKind, Record<string, string>> = {
  comp: {
    name: "A competition needs a name.",
    ensemble: "Pick at least one ensemble for the competition.",
    season: "Activate a season before adding competitions.",
    save: "Couldn't save. Try again.",
  },
  event: {
    title: "An event needs a title.",
    season: "Activate a season before adding events.",
    save: "Couldn't save. Try again.",
  },
  trip: {
    name: "A trip needs a name.",
    season: "Activate a season before adding trips.",
    save: "Couldn't save. Try again.",
  },
};

const ADD_KIND_LABEL: Record<AddKind, string> = {
  comp: "Competition",
  event: "Event",
  trip: "Trip",
};

// Row-edit errors, in the same words the record's own page uses. `?edit=<key>`
// reopens that row's popover with the message inside it.
const EDIT_ERROR: Record<AddKind, Record<string, string>> = {
  comp: {
    name: "A competition needs a name.",
    ensemble: "Pick at least one ensemble for the competition.",
    save: "Couldn't save. Try again.",
  },
  event: {
    title: "An event needs a title.",
    save: "Couldn't save. Try again.",
  },
  trip: {
    name: "A trip needs a name.",
    dates: "A trip can't end before it starts.",
    overnight_rooms: "Remove this trip's rooms before making it a day trip.",
    save: "Couldn't save the trip. Try again.",
  },
};

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
  searchParams: Promise<{
    filter?: string;
    calShare?: string;
    calError?: string;
    add?: string;
    edit?: string;
    error?: string;
    created?: string;
    saved?: string;
    seasonError?: string;
    seasonStarted?: string;
  }>;
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

  const {
    filter: filterParam,
    calShare,
    calError,
    add: addParam,
    edit: editKey,
    error: errorParam,
    created,
    saved,
    seasonError,
    seasonStarted,
  } = await searchParams;
  const filter: Filter = FILTERS.includes(filterParam as Filter)
    ? (filterParam as Filter)
    : "everything";
  // Which quick-add section is open (and therefore which error belongs to it).
  const addKind: AddKind | null = (ADD_KINDS as readonly string[]).includes(
    addParam ?? "",
  )
    ? (addParam as AddKind)
    : null;

  // Per-kind write affordances — the season spine absorbs the module lists, so
  // it must also be where a writer adds and corrects. Each is gated by its flag
  // AND its module's write-role set (re-checked server-side in every action); a
  // role with no write access sees no "+ Add" and no row Edit at all (the pills
  // and rows still browse). One "+ Add" drawer holds every kind the viewer may
  // create; the full forms stay on the module pages behind "More options →".
  const canAddComp = flags.competitions && COMPETITION_WRITE_ROLES.includes(role);
  const canAddEvent = flags.events && EVENTS_WRITE_ROLES.includes(role);
  const canAddTrip = flags.travel && TRAVEL_WRITE_ROLES.includes(role);
  const canAddAny = canAddComp || canAddEvent || canAddTrip;

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

  // Ensemble names (shared by comp + event meta) — ordered, because the same
  // list is the quick-add drawer's "who's going" checkboxes.
  const ensembleName = new Map<string, string>();
  let ensembles: { id: string; name: string }[] = [];
  if (seasonId && (flags.competitions || flags.events)) {
    const { data: ensData } = await supabase
      .from("ensembles")
      .select("id, name")
      .eq("program_id", program.id)
      .order("sort_order", { ascending: true });
    ensembles = (ensData as { id: string; name: string }[] | null) ?? [];
    for (const e of ensembles) {
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
  // Competitions with no trip yet — the quick-add drawer's primary trip path
  // (and the same set the travel page suggests trips for). Filled from the comps
  // we already fetch; no extra query.
  let compsWithoutTrip: { id: string; name: string; date: string | null }[] = [];
  if (flags.competitions && seasonId) {
    // venue_address + showchoir_com_url ride along for the row's edit popover
    // only (updateCompetition clears what a form omits) — two extra columns on
    // a query the spine already runs.
    const { data: compData } = await supabase
      .from("competitions")
      .select(
        "id, name, date, host_school, venue_address, showchoir_com_url, status",
      )
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
            venue_address: string | null;
            showchoir_com_url: string | null;
            status: "planned" | "confirmed" | "done";
          }[]
        | null) ?? [];

    undatedCompCount = comps.filter((c) => !c.date).length;

    // Participating ensembles per competition (Feature 004 junction).
    const compEnsembles = await competitionEnsembleMap(
      supabase,
      program.id,
      comps.map((c) => c.id),
    );
    const compEnsembleLabel = (id: string): string | null => {
      const names = (compEnsembles.get(id) ?? [])
        .map((eid) => ensembleName.get(eid))
        .filter(Boolean);
      return names.length ? names.join(", ") : null;
    };

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
      compsWithoutTrip = comps
        .filter((c) => !linkedCompIds.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, date: c.date }));
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
      const ens = compEnsembleLabel(c.id);
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
        compEdit: canAddComp
          ? {
              id: c.id,
              name: c.name,
              date: c.date,
              status: c.status,
              hostSchool: c.host_school ?? "",
              venueAddress: c.venue_address ?? "",
              showchoirUrl: c.showchoir_com_url ?? "",
              ensembleIds: compEnsembles.get(c.id) ?? [],
            }
          : undefined,
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
      const ens = compEnsembleLabel(upcoming.id);
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
    // ends_at + note are here only so the row's edit popover can carry them back
    // untouched (updateEvent clears what a form omits) — no extra query, two
    // extra columns.
    const { data: eventData } = await supabase
      .from("events")
      .select("id, title, starts_at, ends_at, kind, location, note")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .not("starts_at", "is", null)
      .order("starts_at", { ascending: true });
    const eventRows =
      (eventData as
        | {
            id: string;
            title: string;
            starts_at: string;
            ends_at: string | null;
            kind: string;
            location: string | null;
            note: string | null;
          }[]
        | null) ?? [];
    // Targeted ensembles per event (Feature 004 junction; empty = whole program).
    const evEnsembles = await eventEnsembleMap(
      supabase,
      program.id,
      eventRows.map((e) => e.id),
    );
    for (const e of eventRows) {
      const instant = new Date(e.starts_at);
      if (Number.isNaN(instant.getTime())) continue;
      const tag = EVENT_TAG[e.kind] ?? EVENT_TAG.other;
      const evEnsIds = evEnsembles.get(e.id) ?? [];
      const ens =
        evEnsIds.length === 0
          ? "whole program"
          : evEnsIds.map((id) => ensembleName.get(id) ?? "?").join(", ");
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
        eventEdit: canAddEvent
          ? {
              id: e.id,
              title: e.title,
              startsWall: toZonedInputValue(e.starts_at, tz),
              endsWall: toZonedInputValue(e.ends_at, tz),
              location: e.location ?? "",
              note: e.note ?? "",
              eventKind: e.kind,
              ensembleIds: evEnsIds,
            }
          : undefined,
      });
    }
  }

  // ---- Trips ----------------------------------------------------------------
  if (flags.travel && seasonId) {
    // ends_on + competition_id ride along for the row's edit popover only
    // (updateTrip clears the link a form omits) — two extra columns, no query.
    const { data: tripData } = await supabase
      .from("trips")
      .select("id, name, starts_on, ends_on, is_overnight, competition_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .not("starts_on", "is", null)
      .order("starts_on", { ascending: true });
    for (const t of (tripData as
      | {
          id: string;
          name: string;
          starts_on: string;
          ends_on: string | null;
          is_overnight: boolean;
          competition_id: string | null;
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
        tripEdit: canAddTrip
          ? {
              id: t.id,
              name: t.name,
              startsOn: t.starts_on,
              endsOn: t.ends_on ?? "",
              isOvernight: t.is_overnight,
              competitionId: t.competition_id ?? "",
            }
          : undefined,
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

  // "Competition added." after a quick add — the created key is `<kind>-<id>`.
  const createdKind = created?.split("-")[0] ?? null;
  // A just-added or just-corrected row is the one the eye should land on.
  const highlightKey = created ?? saved ?? null;

  return (
    <section className="season">
      <div className="season-head">
        <div className="season-head-titles">
          <p className="eyebrow">{season ? season.label : "Season"}</p>
          <h1 className="season-h1">The Season</h1>
        </div>
        <div className="season-actions">
          {canAddAny && (
            <QuickAdd
              slug={slug}
              base={base}
              programId={program.id}
              seasonId={seasonId}
              tz={tz}
              ensembles={ensembles}
              compsWithoutTrip={compsWithoutTrip}
              canAddComp={canAddComp}
              canAddEvent={canAddEvent}
              canAddTrip={canAddTrip}
              openKind={addKind}
              error={errorParam ?? null}
            />
          )}
          {flags.archive && (
            <Link href={`${base}/history`} className="button-link secondary">
              Trophy case
            </Link>
          )}
        </div>
      </div>

      {!season && (
        <StartSeasonCard
          slug={slug}
          programId={program.id}
          role={role}
          timezone={tz}
          from="season"
          error={seasonError ?? null}
        />
      )}

      {seasonStarted && season && (
        <p className="alert-ok">{season.label} is now your active season.</p>
      )}

      {createdKind && (
        <p className="alert-ok">
          {createdKind === "comp"
            ? "Competition added to your season."
            : createdKind === "event"
              ? "Event added to your season."
              : "Trip added to your season."}
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
          {canAddComp ? (
            <>
              {" "}
              — <Link href={`${base}/competitions`}>set dates on the Competitions page</Link>.
            </>
          ) : (
            "."
          )}
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
                <Link href={`${base}/season?add=comp`}>a competition</Link>
              )}
              {canAddComp && (canAddEvent || canAddTrip) &&
                (canAddEvent && canAddTrip ? ", " : " or ")}
              {canAddEvent && (
                <Link href={`${base}/season?add=event`}>an event</Link>
              )}
              {canAddEvent && canAddTrip && " or "}
              {canAddTrip && <Link href={`${base}/season?add=trip`}>a trip</Link>}
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
                  <div
                    className={`season-feature${it.key === highlightKey ? " just-added" : ""}`}
                    id={`item-${it.key}`}
                    key={it.key}
                  >
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
                        <RowEdit
                          item={it}
                          variant="feature"
                          slug={slug}
                          base={base}
                          programId={program.id}
                          seasonId={seasonId}
                          tz={tz}
                          openKey={editKey ?? null}
                          error={errorParam ?? null}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`season-row${it.isPast ? " past" : ""}${
                      it.key === highlightKey ? " just-added" : ""
                    }`}
                    id={`item-${it.key}`}
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
                      <RowEdit
                        item={it}
                        variant="row"
                        slug={slug}
                        base={base}
                        programId={program.id}
                        seasonId={seasonId}
                        tz={tz}
                        openKey={editKey ?? null}
                        error={errorParam ?? null}
                      />
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

// ---------------------------------------------------------------------------
// Row edit (US2) — a small popover on the row itself for the correction this
// domain makes constantly: a name or a date that moved. Same native <details>
// as the quick-add drawer, no client JS, and no per-row query: everything the
// form needs was already loaded for the spine. Deeper work (who's going, the
// itinerary, rooms and buses) stays on the record's own page, one link away.
// A read-only role never gets here — the payloads are only built for writers.
// ---------------------------------------------------------------------------
function RowEdit({
  item,
  variant,
  slug,
  base,
  programId,
  seasonId,
  tz,
  openKey,
  error,
}: {
  item: SeasonItem;
  variant: "row" | "feature";
  slug: string;
  base: string;
  programId: string;
  seasonId: string | null;
  tz: string;
  openKey: string | null;
  error: string | null;
}) {
  const kind: AddKind | null = item.compEdit
    ? "comp"
    : item.eventEdit
      ? "event"
      : item.tripEdit
        ? "trip"
        : null;
  if (!kind) return null;

  const isOpen = openKey === item.key;
  const message =
    isOpen && error ? EDIT_ERROR[kind][error] ?? EDIT_ERROR[kind].save : null;
  // The row popover hangs off the spine's right edge; the feature row's action
  // bar sits at the left, so its panel opens the other way (both stay put on a
  // phone, where the page-head drawer flips).
  const panelClass =
    variant === "feature" ? "season-feature-edit-panel" : "season-edit-panel";

  return (
    <details className="drawer" open={isOpen}>
      <summary className="season-link">Edit</summary>
      <div className={`drawer-panel ${panelClass}`}>
        <h3 className="drawer-title">Quick edit</h3>
        {message && <p className="alert-error">{message}</p>}

        {item.compEdit && (
          <form action={updateCompetition} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={item.compEdit.id} />
            <input type="hidden" name="seasonId" value={seasonId ?? ""} />
            <input type="hidden" name="from" value="season" />
            {/* Carried through untouched — updateCompetition clears a field the
                form leaves out, and who's going is detail-page work. */}
            <input
              type="hidden"
              name="host_school"
              value={item.compEdit.hostSchool}
            />
            <input
              type="hidden"
              name="venue_address"
              value={item.compEdit.venueAddress}
            />
            <input
              type="hidden"
              name="showchoir_com_url"
              value={item.compEdit.showchoirUrl}
            />
            {item.compEdit.ensembleIds.map((id) => (
              <input key={id} type="hidden" name="ensemble_ids" value={id} />
            ))}
            <label>
              Name
              <input
                type="text"
                name="name"
                defaultValue={item.compEdit.name}
                required
              />
            </label>
            <div className="row-inline">
              <label>
                Date
                <input
                  type="date"
                  name="date"
                  defaultValue={item.compEdit.date}
                />
              </label>
              <label>
                Status
                <select name="status" defaultValue={item.compEdit.status}>
                  {COMPETITION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {COMPETITION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit">Save</button>
            <p className="muted">
              <Link href={`${base}/competitions/${item.compEdit.id}`}>
                All details →
              </Link>
            </p>
          </form>
        )}

        {item.eventEdit && (
          <form action={updateEvent} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={item.eventEdit.id} />
            <input type="hidden" name="tz" value={tz} />
            <input type="hidden" name="from" value="season" />
            {/* Carried through untouched — updateEvent clears a field the form
                leaves out, and who it's for is detail-page work. */}
            <input type="hidden" name="kind" value={item.eventEdit.eventKind} />
            <input
              type="hidden"
              name="ends_at"
              value={item.eventEdit.endsWall}
            />
            <input type="hidden" name="note" value={item.eventEdit.note} />
            {item.eventEdit.ensembleIds.map((id) => (
              <input key={id} type="hidden" name="ensemble_ids" value={id} />
            ))}
            <label>
              Title
              <input
                type="text"
                name="title"
                defaultValue={item.eventEdit.title}
                required
              />
            </label>
            <div className="row-inline">
              <label>
                Starts
                <input
                  type="datetime-local"
                  name="starts_at"
                  defaultValue={item.eventEdit.startsWall}
                />
              </label>
              <label>
                Location
                <input
                  type="text"
                  name="location"
                  defaultValue={item.eventEdit.location}
                />
              </label>
            </div>
            <button type="submit">Save</button>
            <p className="muted">
              Who it&apos;s for, an end time, a note:{" "}
              <Link href={`${base}/events/${item.eventEdit.id}`}>
                All details →
              </Link>
            </p>
          </form>
        )}

        {item.tripEdit && (
          <form action={updateTrip} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="tripId" value={item.tripEdit.id} />
            <input type="hidden" name="from" value="season" />
            {/* Keeps the trip attached to its competition — updateTrip unlinks
                a trip whose form omits the field. */}
            <input
              type="hidden"
              name="competition_id"
              value={item.tripEdit.competitionId}
            />
            <label>
              Name
              <input
                type="text"
                name="name"
                defaultValue={item.tripEdit.name}
                required
              />
            </label>
            <div className="row-inline">
              <label>
                Starts
                <input
                  type="date"
                  name="starts_on"
                  defaultValue={item.tripEdit.startsOn}
                />
              </label>
              <label>
                Ends
                <input
                  type="date"
                  name="ends_on"
                  defaultValue={item.tripEdit.endsOn}
                />
              </label>
            </div>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                name="is_overnight"
                defaultChecked={item.tripEdit.isOvernight}
              />{" "}
              Overnight (rooms + buses)
            </label>
            <button type="submit">Save</button>
            <p className="muted">
              <Link href={`${base}/travel/${item.tripEdit.id}`}>
                All details →
              </Link>
            </p>
          </form>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Quick add (US1) — one "+ Add" drawer holding a minimal form per kind. Native
// <details> only: the outer drawer is the roster-page popover, the inner
// sections share a `name` so opening one closes the others. No client JS, no
// state — `?add=<kind>` opens a section, and a failed create comes back on that
// same URL with its error code. Anything beyond the true minimum lives behind
// each section's "More options →" (the module page's full form).
// ---------------------------------------------------------------------------
function QuickAdd({
  slug,
  base,
  programId,
  seasonId,
  tz,
  ensembles,
  compsWithoutTrip,
  canAddComp,
  canAddEvent,
  canAddTrip,
  openKind,
  error,
}: {
  slug: string;
  base: string;
  programId: string;
  seasonId: string | null;
  tz: string;
  ensembles: { id: string; name: string }[];
  compsWithoutTrip: { id: string; name: string; date: string | null }[];
  canAddComp: boolean;
  canAddEvent: boolean;
  canAddTrip: boolean;
  openKind: AddKind | null;
  error: string | null;
}) {
  // The section that produced the error is the one that reopens with it.
  const errorFor = (kind: AddKind): string | null =>
    openKind === kind && error ? ADD_ERROR[kind][error] ?? ADD_ERROR[kind].save : null;

  return (
    <details className="drawer" open={openKind !== null}>
      <summary className="button-link accent">+ Add</summary>
      <div className="drawer-panel">
        <h2 className="drawer-title">Add to the season</h2>
        {!seasonId ? (
          <p className="muted">
            Start your season first — competitions, events, and trips all belong
            to a season.
          </p>
        ) : (
          <div className="quick-add-kinds">
            {canAddComp && (
              <details
                name="season-add-kind"
                className="quick-add-kind"
                open={openKind === "comp"}
              >
                <summary>{ADD_KIND_LABEL.comp}</summary>
                {errorFor("comp") && (
                  <p className="alert-error">{errorFor("comp")}</p>
                )}
                {ensembles.length === 0 ? (
                  <p className="muted">
                    Competitions need at least one ensemble (a performing group).{" "}
                    <Link href={`${base}/roster/ensembles`}>
                      Create one first →
                    </Link>
                  </p>
                ) : (
                  <form action={createCompetition} className="stack">
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="seasonId" value={seasonId} />
                    <input type="hidden" name="from" value="season" />
                    {/* Everything new starts Planned; change it on the row or
                        the comp page once the host confirms. */}
                    <input type="hidden" name="status" value="planned" />
                    <div className="row-inline">
                      <label>
                        Name
                        <input
                          type="text"
                          name="name"
                          required
                          placeholder="Midwest Invitational"
                        />
                      </label>
                      <label>
                        Date
                        <input type="date" name="date" />
                      </label>
                    </div>
                    {/* One ensemble is not a choice — it rides along hidden.
                        More than one and they all come pre-ticked (§004). */}
                    {ensembles.length === 1 ? (
                      <input
                        type="hidden"
                        name="ensemble_ids"
                        value={ensembles[0].id}
                      />
                    ) : (
                      <fieldset className="stack">
                        <legend>Who is going</legend>
                        <div className="row-inline" style={{ flexWrap: "wrap" }}>
                          {ensembles.map((e) => (
                            <label key={e.id} className="checkbox-inline">
                              <input
                                type="checkbox"
                                name="ensemble_ids"
                                value={e.id}
                                defaultChecked
                              />
                              {e.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <button type="submit">Add competition</button>
                    <p className="muted">
                      Host school, venue, and the rest:{" "}
                      <Link href={`${base}/competitions#add`}>More options →</Link>
                    </p>
                  </form>
                )}
              </details>
            )}

            {canAddEvent && (
              <details
                name="season-add-kind"
                className="quick-add-kind"
                open={openKind === "event"}
              >
                <summary>{ADD_KIND_LABEL.event}</summary>
                {errorFor("event") && (
                  <p className="alert-error">{errorFor("event")}</p>
                )}
                <form action={createEvent} className="stack">
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="seasonId" value={seasonId} />
                  <input type="hidden" name="tz" value={tz} />
                  <input type="hidden" name="from" value="season" />
                  <div className="row-inline">
                    <label>
                      Title
                      <input type="text" name="title" required />
                    </label>
                    <label>
                      Starts
                      <input type="datetime-local" name="starts_at" />
                    </label>
                    <label>
                      Kind
                      <select name="kind" defaultValue="rehearsal">
                        {EVENT_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {EVENT_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {/* Both of these are the exception, not the rule, so they stay
                      folded away until someone needs them. */}
                  {ensembles.length > 1 && (
                    <details className="stack">
                      <summary className="muted">Only some groups?</summary>
                      <div className="row-inline" style={{ flexWrap: "wrap" }}>
                        {ensembles.map((e) => (
                          <label key={e.id} className="checkbox-inline">
                            <input
                              type="checkbox"
                              name="ensemble_ids"
                              value={e.id}
                            />
                            {e.name}
                          </label>
                        ))}
                      </div>
                      <p className="muted">
                        Leave every box unticked and the whole program is invited.
                      </p>
                    </details>
                  )}
                  <details className="stack">
                    <summary className="muted">Repeats weekly?</summary>
                    <label>
                      How many weeks
                      <input
                        type="number"
                        name="repeat_count"
                        className="num"
                        min="1"
                        max="52"
                        defaultValue="1"
                      />
                    </label>
                    <p className="muted">
                      Each week becomes its own event you can change or delete on
                      its own.
                    </p>
                  </details>
                  <button type="submit">Add event</button>
                  <p className="muted">
                    Where it is, an end time, a note:{" "}
                    <Link href={`${base}/events#add`}>More options →</Link>
                  </p>
                </form>
              </details>
            )}

            {canAddTrip && (
              <details
                name="season-add-kind"
                className="quick-add-kind"
                open={openKind === "trip"}
              >
                <summary>{ADD_KIND_LABEL.trip}</summary>
                {errorFor("trip") && (
                  <p className="alert-error">{errorFor("trip")}</p>
                )}
                {compsWithoutTrip.length > 0 ? (
                  <>
                    {/* The common case by far: a bus (and rooms) for a
                        competition already on the calendar. Name and dates come
                        from that competition, server-side. */}
                    <form action={createTrip} className="stack">
                      <input type="hidden" name="programId" value={programId} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="seasonId" value={seasonId} />
                      <input type="hidden" name="from" value="season" />
                      <label>
                        For a competition
                        <select name="competition_id">
                          {compsWithoutTrip.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.date
                                ? ` · ${formatDateInTz(`${c.date}T12:00:00Z`, tz)}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-inline">
                        <input type="checkbox" name="is_overnight" /> Overnight
                        (rooms + buses)
                      </label>
                      <button type="submit">Add trip</button>
                      <p className="muted">
                        The trip takes its name and date from the competition.
                      </p>
                    </form>
                    <details className="stack">
                      <summary className="muted">Not for a competition?</summary>
                      <StandaloneTripForm
                        slug={slug}
                        programId={programId}
                        seasonId={seasonId}
                      />
                    </details>
                  </>
                ) : (
                  <StandaloneTripForm
                    slug={slug}
                    programId={programId}
                    seasonId={seasonId}
                  />
                )}
                <p className="muted">
                  Rooms, buses, and chaperones:{" "}
                  <Link href={`${base}/travel#add`}>More options →</Link>
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// A trip that isn't tied to a competition (banquet, tour) — the alternative path
// inside the trip section, and the only one when every competition already has
// a trip.
function StandaloneTripForm({
  slug,
  programId,
  seasonId,
}: {
  slug: string;
  programId: string;
  seasonId: string;
}) {
  return (
    <form action={createTrip} className="stack">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="from" value="season" />
      <div className="row-inline">
        <label>
          Name
          <input type="text" name="name" required placeholder="Spring Trip" />
        </label>
        <label>
          Starts
          <input type="date" name="starts_on" />
        </label>
        <label>
          Ends
          <input type="date" name="ends_on" />
        </label>
      </div>
      <label className="checkbox-inline">
        <input type="checkbox" name="is_overnight" /> Overnight (rooms + buses)
      </label>
      <button type="submit">Add trip</button>
    </form>
  );
}
