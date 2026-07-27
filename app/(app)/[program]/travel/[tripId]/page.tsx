import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  TRAVEL_WRITE_ROLES,
  GROUP_KIND_LABEL,
  relevantKinds,
  type TravelGroupKind,
} from "@/lib/travel";
import { competitionEnsembleIds } from "@/lib/competitions";
import {
  formatDateInTz,
  formatTimeInTz,
  formatDayHeadingInTz,
  zonedDateKey,
  dateKeyRange,
} from "@/lib/datetime";
import { deleteTrip } from "../actions";
import { IntroStrip, HelpDot } from "../../IntroStrip";
import { loadGuideState } from "@/lib/guide";
import { FillQueue, FillBar, type FillChip } from "./FillQueue";
import { GroupSection } from "./TripGroups";
import { ChaperoneSection } from "./TripChaperones";
import { TripEdit } from "./TripEdit";
import {
  asGroupKind,
  studentName,
  tripError,
  type AssignmentRow,
  type ChaperoneRow,
  type GroupRow,
  type Student,
} from "./shared";

// The trip page (spec 005 Wave 2). Titled sections in one constant order —
// Overview · Schedule · Still to place · Buses · Rooms · Chaperones · Papers ·
// Danger zone — each with a live one-line summary, so the page can be scanned
// without opening anything and no mutation hides behind a bare triangle (US6).
//
// ONE assignment model (US5): pick a group to fill (`?fill=<groupId>`), and the
// tap-chip queue at the top places riders one tap at a time while a sticky bar
// keeps the target up. The unassigned list is read-only status. The
// select-then-place flow that used to run alongside it (`?sel=`) is gone.
//
// This file loads the data and composes the sections; each section renders in
// its own sibling file. Errors are section-local: `?error=` (+ `?errorKind=`)
// resolves to the section that owns what failed (shared.ts), never a page-top
// pile.

interface TripRow {
  id: string;
  name: string;
  season_id: string;
  competition_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_overnight: boolean;
}
interface GuardianRow {
  id: string;
  name: string;
  student: { last_name: string } | null;
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; tripId: string }>;
  // Next hands back an ARRAY for a duplicated param (?fill=a&fill=b), so every
  // read below goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, tripId } = await params;
  const { program, role, flags, membership, isSupport } =
    await getTenantContext(slug);
  requireFlag(program, "travel");
  const canWrite = TRAVEL_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const tripHref = `/${slug}/travel/${tripId}`;

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();

  // First-use intro strip (spec 003 §3) — how the fill flow works.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(supabase, program.id, membership.user_id)
      : {};

  const { data: tripData } = await supabase
    .from("trips")
    .select(
      "id, name, season_id, competition_id, starts_on, ends_on, is_overnight",
    )
    .eq("id", tripId)
    .eq("program_id", program.id)
    .maybeSingle();
  const trip = tripData as TripRow | null;
  if (!trip) notFound();

  // Linked competition name (if any) + its participating ensembles (Feature 004).
  let compName: string | null = null;
  let compEnsembleIds: string[] = [];
  if (trip.competition_id) {
    const { data: c } = await supabase
      .from("competitions")
      .select("name")
      .eq("id", trip.competition_id)
      .maybeSingle();
    compName = (c as { name: string } | null)?.name ?? null;
    compEnsembleIds = await competitionEnsembleIds(supabase, trip.competition_id);
  }

  // This season's competitions for the Overview edit popover's linker (mirrors
  // the create form on travel/page.tsx). Writers only — read-only has no linker.
  let seasonComps: { id: string; name: string }[] = [];
  if (canWrite) {
    const { data: compRows } = await supabase
      .from("competitions")
      .select("id, name")
      .eq("program_id", program.id)
      .eq("season_id", trip.season_id)
      .order("date", { ascending: true, nullsFirst: false });
    seasonComps = (compRows as { id: string; name: string }[] | null) ?? [];
  }

  // Groups for this trip (buses first, then rooms — `kind` sorts that way).
  const { data: groupData } = await supabase
    .from("travel_groups")
    .select("id, kind, label, capacity, notes, sort_order")
    .eq("program_id", program.id)
    .eq("trip_id", tripId)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const groups = (groupData as GroupRow[] | null) ?? [];
  const groupIds = groups.map((g) => g.id);

  // Assignments + chaperones across the trip's groups.
  let assignments: AssignmentRow[] = [];
  let chaperones: ChaperoneRow[] = [];
  if (groupIds.length > 0) {
    const { data: aData } = await supabase
      .from("travel_assignments")
      .select(
        "id, travel_group_id, student_id, student:students(first_name, last_name)",
      )
      .eq("program_id", program.id)
      .in("travel_group_id", groupIds);
    assignments = (aData as AssignmentRow[] | null) ?? [];

    const { data: cData } = await supabase
      .from("travel_chaperones")
      .select(
        "id, travel_group_id, guardian_id, name_override, guardian:guardians(name)",
      )
      .eq("program_id", program.id)
      .in("travel_group_id", groupIds);
    chaperones = (cData as ChaperoneRow[] | null) ?? [];
  }

  // Eligible students (§6): competition-linked ⇒ the UNION of that competition's
  // participating ensembles' members (Feature 004); else every student who is an
  // ensemble member this season (Constitution VI — read through ensemble_members,
  // never students directly). The byId map dedupes double-rostered students.
  let eligible: Student[] = [];
  {
    let q = supabase
      .from("ensemble_members")
      .select("students(id, first_name, last_name)")
      .eq("program_id", program.id)
      .eq("season_id", trip.season_id);
    if (trip.competition_id && compEnsembleIds.length > 0)
      q = q.in("ensemble_id", compEnsembleIds);
    const { data: memberData } = await q;
    const byId = new Map<string, Student>();
    for (const m of (memberData as { students: Student | null }[] | null) ??
      []) {
      if (m.students) byId.set(m.students.id, m.students);
    }
    eligible = [...byId.values()].sort((a, b) =>
      studentName(a).localeCompare(studentName(b)),
    );
  }
  const studentById = new Map(eligible.map((s) => [s.id, s]));

  // Absent students (only meaningful when competition-linked).
  const absent = new Set<string>();
  if (trip.competition_id) {
    const { data: attData } = await supabase
      .from("attendance")
      .select("student_id")
      .eq("program_id", program.id)
      .eq("competition_id", trip.competition_id)
      .eq("status", "absent");
    for (const a of (attData as { student_id: string }[] | null) ?? []) {
      absent.add(a.student_id);
    }
  }

  // Guardians for the chaperone picker (name + student surname for context).
  const { data: gData } = await supabase
    .from("guardians")
    .select("id, name, student:students(last_name)")
    .eq("program_id", program.id)
    .order("name", { ascending: true });
  const guardians = (gData as GuardianRow[] | null) ?? [];
  const guardianName = new Map(guardians.map((g) => [g.id, g.name]));

  // Derived maps.
  const assignmentsByGroup = new Map<string, AssignmentRow[]>();
  const studentKinds = new Map<string, Set<TravelGroupKind>>();
  const kindByGroup = new Map(groups.map((g) => [g.id, g.kind]));
  for (const a of assignments) {
    const list = assignmentsByGroup.get(a.travel_group_id) ?? [];
    list.push(a);
    assignmentsByGroup.set(a.travel_group_id, list);
    const k = kindByGroup.get(a.travel_group_id);
    if (k) {
      const set = studentKinds.get(a.student_id) ?? new Set<TravelGroupKind>();
      set.add(k);
      studentKinds.set(a.student_id, set);
    }
  }
  const riderCount = new Map(
    groups.map((g) => [g.id, assignmentsByGroup.get(g.id)?.length ?? 0]),
  );
  const chaperonesByGroup = new Map<string, ChaperoneRow[]>();
  for (const c of chaperones) {
    const list = chaperonesByGroup.get(c.travel_group_id) ?? [];
    list.push(c);
    chaperonesByGroup.set(c.travel_group_id, list);
  }

  const needed = relevantKinds(trip.is_overnight);
  const neededOf = (studentId: string): TravelGroupKind[] => {
    const has = studentKinds.get(studentId) ?? new Set();
    return needed.filter((k) => !has.has(k));
  };

  // Who still needs a seat (and a bed, on an overnight trip), by name.
  const queue = eligible.filter((s) => neededOf(s.id).length > 0);

  // The fill target: `?fill=<groupId>` makes one group active. Writers only;
  // a stale or foreign id is ignored.
  const fillParam = one("fill");
  const fillGroup =
    canWrite && fillParam
      ? (groups.find((g) => g.id === fillParam) ?? null)
      : null;
  const fillMembers = fillGroup
    ? (assignmentsByGroup.get(fillGroup.id) ?? [])
    : [];
  const fillChips: FillChip[] = fillGroup
    ? queue
        .filter((s) => neededOf(s.id).includes(fillGroup.kind))
        .map((s) => ({
          id: s.id,
          name: studentName(s),
          absent: absent.has(s.id),
          needs: neededOf(s.id),
        }))
    : [];

  // Cascade-delete confirmations (the ?confirm= confirm-box idiom used across the
  // app): a group or the whole trip is only removed on the second, explicit tap.
  const confirmDeleteTrip = one("confirm") === "deletetrip" && canWrite;
  const confirmDeleteGroup =
    one("confirm") === "deletegroup" && canWrite ? one("groupId") : null;

  // Section-local messages. Every error code maps to the section that owns what
  // failed; the two that could belong to either group section carry the kind.
  const err = tripError(one("error"));
  const errKind = asGroupKind(one("errorKind")) ?? "bus";
  const overviewError = err?.slot === "overview" ? err.message : null;
  const chaperoneError = err?.slot === "chaperones" ? err.message : null;
  const groupError = (k: TravelGroupKind): string | null =>
    err?.slot === "group" && errKind === k ? err.message : null;

  // The friendly one-room-one-bus message (§6), rendered in the section of the
  // kind it happened in.
  const conflictId = one("conflict");
  const conflictKind = asGroupKind(one("conflictKind"));
  let conflictMsg: string | null = null;
  if (conflictId && conflictKind) {
    const s = studentById.get(conflictId);
    const existing = groups.find(
      (g) =>
        g.kind === conflictKind &&
        (assignmentsByGroup.get(g.id) ?? []).some(
          (a) => a.student_id === conflictId,
        ),
    );
    const who = s ? s.first_name : "That student";
    conflictMsg = existing
      ? `${who} is already in ${existing.label} — remove them there first.`
      : `${who} is already assigned to a ${GROUP_KIND_LABEL[
          conflictKind
        ].toLowerCase()} on this trip.`;
  }

  const roomsExist = groups.some((g) => g.kind === "room");

  // Which group sections render, in the page's constant order — Buses, then
  // Rooms (US6). Buses always (a writer can add one); rooms when the trip is
  // overnight or a room already exists. Spelled out rather than filtered from
  // TRAVEL_GROUP_KINDS, which is storage order (room first) and read that way
  // by the queries above.
  const kindsToShow: TravelGroupKind[] = (
    ["bus", "room"] as TravelGroupKind[]
  ).filter((k) => k !== "room" || trip.is_overnight || roomsExist);

  // ---- Trip schedule (G2.5): read-only per-day merge, multi-day trips only ----
  // A nationals trip runs several days; staff want one place that shows what
  // happens each day. We merge the linked competition's PUBLISHED itinerary items
  // (invariant §9.3 — drafts never leak) with program events whose time falls in
  // the trip's date range (program tz), bucketed by day. Empty days say so, and a
  // hint points staff at the pattern for park days / meals (create them as events).
  // Lean by construction: these queries run ONLY when the trip spans >1 day.
  const isMultiDay =
    !!trip.starts_on && !!trip.ends_on && trip.starts_on !== trip.ends_on;

  interface ScheduleEntry {
    startsAt: string;
    label: string;
    sublabel: string | null;
    source: "itinerary" | "event";
  }
  let scheduleByDay: {
    key: string;
    label: string;
    entries: ScheduleEntry[];
  }[] = [];
  if (isMultiDay) {
    const dayKeys = dateKeyRange(trip.starts_on, trip.ends_on);
    const entriesByDay = new Map<string, ScheduleEntry[]>();
    for (const k of dayKeys) entriesByDay.set(k, []);

    // Linked competition's published itinerary items.
    if (trip.competition_id) {
      const { data: itinRow } = await supabase
        .from("itineraries")
        .select("id")
        .eq("program_id", program.id)
        .eq("competition_id", trip.competition_id)
        .eq("status", "published")
        .maybeSingle();
      const itinId = (itinRow as { id: string } | null)?.id ?? null;
      if (itinId) {
        const { data: itinItems } = await supabase
          .from("itinerary_items")
          .select("starts_at, kind, title, location")
          .eq("program_id", program.id)
          .eq("itinerary_id", itinId)
          .not("starts_at", "is", null)
          .order("starts_at", { ascending: true });
        for (const it of (itinItems as
          | {
              starts_at: string;
              kind: string;
              title: string | null;
              location: string | null;
            }[]
          | null) ?? []) {
          const bucket = entriesByDay.get(zonedDateKey(it.starts_at, tz));
          if (bucket)
            bucket.push({
              startsAt: it.starts_at,
              label: it.title ?? it.kind,
              sublabel: it.location,
              source: "itinerary",
            });
        }
      }
    }

    // Program events (this season) with a time inside the trip's day range.
    const { data: evRows } = await supabase
      .from("events")
      .select("starts_at, title, location, kind")
      .eq("program_id", program.id)
      .eq("season_id", trip.season_id)
      .not("starts_at", "is", null)
      .order("starts_at", { ascending: true });
    for (const e of (evRows as
      | {
          starts_at: string;
          title: string;
          location: string | null;
          kind: string;
        }[]
      | null) ?? []) {
      const bucket = entriesByDay.get(zonedDateKey(e.starts_at, tz));
      if (bucket)
        bucket.push({
          startsAt: e.starts_at,
          label: e.title,
          sublabel: e.location,
          source: "event",
        });
    }

    scheduleByDay = dayKeys.map((k) => ({
      key: k,
      label: formatDayHeadingInTz(`${k}T12:00:00Z`, tz),
      entries: (entriesByDay.get(k) ?? []).sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    }));
  }
  const scheduleCount = scheduleByDay.reduce(
    (n, d) => n + d.entries.length,
    0,
  );

  // Overview's live summary — also the Edit-trip popover's summary line, so a
  // collapsed disclosure still says what it holds.
  const dateText = trip.starts_on
    ? `${formatDateInTz(`${trip.starts_on}T12:00:00Z`, tz)}${
        trip.ends_on && trip.ends_on !== trip.starts_on
          ? ` – ${formatDateInTz(`${trip.ends_on}T12:00:00Z`, tz)}`
          : ""
      }`
    : "No dates yet";
  const factSummary = `${dateText} · ${
    trip.is_overnight ? "overnight" : "day trip"
  }`;

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/travel`}>← Travel</Link>
      </p>
      <div className="page-title-row">
        <h1>{trip.name}</h1>
        {showGuide && <HelpDot href={`${tripHref}?help=1`} />}
      </div>
      {showGuide && (
        <IntroStrip
          surfaceKey="trip"
          programId={program.id}
          selfPath={tripHref}
          guideState={guideState}
          help={one("help") === "1"}
        />
      )}

      {/* The fill queue stays at the top of the page while a group is the active
          target: every tap reloads the page here, so the next name is already
          under the thumb. */}
      {fillGroup && (
        <FillQueue
          group={fillGroup}
          chips={fillChips}
          programId={program.id}
          slug={slug}
          tripId={tripId}
        />
      )}

      {/* ---------------------------- Overview ---------------------------- */}
      <section id="overview" className="travel-section stack">
        <div className="travel-section-head">
          <h2>Overview</h2>
          <span className="travel-section-summary">{factSummary}</span>
        </div>
        {overviewError && <p className="alert-error">{overviewError}</p>}
        <p className="muted">
          {trip.competition_id && compName ? (
            <>
              For{" "}
              <Link href={`/${slug}/competitions/${trip.competition_id}`}>
                {compName}
              </Link>
            </>
          ) : (
            "Not tied to a competition."
          )}
        </p>
        {canWrite && (
          <TripEdit
            programId={program.id}
            slug={slug}
            tripId={tripId}
            name={trip.name}
            startsOn={trip.starts_on ?? ""}
            endsOn={trip.ends_on ?? ""}
            isOvernight={trip.is_overnight}
            competitionId={trip.competition_id ?? ""}
            seasonComps={seasonComps}
            summary={factSummary}
          />
        )}
      </section>

      {/* ---------------------------- Schedule ---------------------------- */}
      {isMultiDay && (
        <section id="schedule" className="travel-section stack">
          <div className="travel-section-head">
            <h2>Schedule</h2>
            <span className="travel-section-summary">
              {scheduleByDay.length} days · {scheduleCount} scheduled
            </span>
          </div>
          <p className="muted">
            What happens each day — the linked competition&apos;s published
            itinerary and this season&apos;s events, merged by day. Add park
            days, meals, and free time as events and they&apos;ll show here on
            the right day.
          </p>
          {scheduleByDay.map((day) => (
            <div key={day.key} className="stack" style={{ gap: "0.35rem" }}>
              <h3 className="itinerary-day-heading">{day.label}</h3>
              {day.entries.length === 0 ? (
                <p className="muted">— nothing scheduled yet</p>
              ) : (
                <ul className="travel-day-list">
                  {day.entries.map((e, i) => (
                    <li key={i} className="row-inline" style={{ gap: "0.5rem" }}>
                      <strong>{formatTimeInTz(e.startsAt, tz)}</strong>
                      <span>{e.label}</span>
                      <span className="chip">
                        {e.source === "event" ? "event" : "itinerary"}
                      </span>
                      {e.sublabel && <span className="muted">· {e.sublabel}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ------------------------- Still to place ------------------------- */}
      {/* Read-only status (US5): who still needs a bus, and a room when it's an
          overnight. Placing happens by picking a group to fill, below. */}
      <section id="unassigned" className="travel-section stack">
        <div className="travel-section-head">
          <h2>Still to place</h2>
          <span className="travel-section-summary">
            {queue.length === 0
              ? "Everyone is placed"
              : `${queue.length} to go`}
          </span>
        </div>
        {eligible.length === 0 ? (
          <p className="muted">
            No eligible students.{" "}
            {trip.competition_id
              ? "Add ensemble members for the linked competition's ensemble this season."
              : "Add ensemble members for this season."}
          </p>
        ) : queue.length === 0 ? (
          <p className="alert-ok">Everyone eligible is placed.</p>
        ) : (
          <>
            {canWrite && (
              <p className="muted">
                Pick a bus or a room below, then tap names to fill it.
              </p>
            )}
            <ul className="travel-unassigned">
              {queue.map((s) => (
                <li
                  key={s.id}
                  className={absent.has(s.id) ? "is-absent" : undefined}
                >
                  <span className="travel-unassigned-name">
                    {studentName(s)}
                  </span>
                  {absent.has(s.id) && <span className="chip danger">absent</span>}
                  {neededOf(s.id).map((k) => (
                    <span key={k} className="chip">
                      needs {GROUP_KIND_LABEL[k].toLowerCase()}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ------------------------- Buses · Rooms -------------------------- */}
      {kindsToShow.map((kind) => (
        <GroupSection
          key={kind}
          kind={kind}
          groups={groups.filter((g) => g.kind === kind)}
          membersByGroup={assignmentsByGroup}
          absent={absent}
          canWrite={canWrite}
          programId={program.id}
          slug={slug}
          tripId={tripId}
          tripHref={tripHref}
          fillGroupId={fillGroup?.id ?? null}
          confirmDeleteGroupId={confirmDeleteGroup}
          error={groupError(kind)}
          conflict={conflictKind === kind ? conflictMsg : null}
        />
      ))}

      {/* --------------------------- Chaperones --------------------------- */}
      <ChaperoneSection
        groups={groups}
        chaperonesByGroup={chaperonesByGroup}
        riderCount={riderCount}
        guardians={guardians}
        guardianName={guardianName}
        canWrite={canWrite}
        programId={program.id}
        slug={slug}
        tripId={tripId}
        error={chaperoneError}
      />

      {/* ----------------------------- Papers ----------------------------- */}
      <section id="papers" className="travel-section stack">
        <div className="travel-section-head">
          <h2>Papers</h2>
          <span className="travel-section-summary">
            Print-ready, straight from what&apos;s above
          </span>
        </div>
        <p className="row-inline">
          <a href={`/api/pdf/bus?trip=${trip.id}`} target="_blank" rel="noopener">
            Bus manifest (PDF)
          </a>
          {(trip.is_overnight || roomsExist) && (
            <a
              href={`/api/pdf/rooms?trip=${trip.id}`}
              target="_blank"
              rel="noopener"
            >
              Room sheets (PDF)
            </a>
          )}
        </p>
      </section>

      {/* --------------------------- Danger zone -------------------------- */}
      {canWrite && (
        <section id="danger" className="travel-section stack">
          <div className="travel-section-head">
            <h2>Danger zone</h2>
            <span className="travel-section-summary">
              Deleting a trip can&apos;t be undone
            </span>
          </div>
          <details open={confirmDeleteTrip}>
            <summary className="travel-disclosure">
              Delete trip · {groups.length} buses and rooms ·{" "}
              {assignments.length} placed
            </summary>
            {confirmDeleteTrip ? (
              <div className="confirm-box stack" style={{ marginTop: "0.5rem" }}>
                <p>
                  Delete this trip? All its buses, rooms, and assignments go
                  with it.
                </p>
                <form action={deleteTrip} className="row-inline">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="tripId" value={tripId} />
                  <button type="submit" className="danger">
                    Confirm delete trip
                  </button>
                  <Link href={tripHref}>Cancel</Link>
                </form>
              </div>
            ) : (
              <p style={{ marginTop: "0.5rem" }}>
                <Link
                  className="linklike danger"
                  href={`${tripHref}?confirm=deletetrip`}
                >
                  Delete this trip and all its groups, assignments, and
                  chaperones
                </Link>
              </p>
            )}
          </details>
        </section>
      )}

      {fillGroup && (
        <FillBar
          group={fillGroup}
          count={fillMembers.length}
          over={
            fillGroup.capacity != null && fillMembers.length > fillGroup.capacity
          }
          tripHref={tripHref}
        />
      )}
    </section>
  );
}
