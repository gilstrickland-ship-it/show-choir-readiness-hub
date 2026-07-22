import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  TRAVEL_WRITE_ROLES,
  TRAVEL_GROUP_KINDS,
  GROUP_KIND_LABEL,
  GROUP_KIND_LABEL_PLURAL,
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
import {
  createGroup,
  updateGroup,
  deleteGroup,
  assignStudent,
  unassignStudent,
  addChaperone,
  removeChaperone,
  deleteTrip,
  updateTrip,
} from "../actions";
import { IntroStrip, HelpDot } from "../../IntroStrip";
import { loadGuideState } from "@/lib/guide";

// Two-pane assignment UI (§6, T016). LEFT: the unassigned queue — eligible
// students (the linked competition's ensemble+season, or every active-season
// student for a standalone trip) minus those already placed in every relevant
// group kind, with absent students flagged when competition-linked. RIGHT: group
// cards (rooms + buses) with per-card capacity meters (over-capacity warns, never
// blocks). Tap a student (?sel=) → tap a group's "Assign here". The one-room-one-
// bus trigger is caught in the action and rendered kindly here.

interface TripRow {
  id: string;
  name: string;
  season_id: string;
  competition_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_overnight: boolean;
}
interface GroupRow {
  id: string;
  kind: TravelGroupKind;
  label: string;
  capacity: number | null;
  notes: string | null;
  sort_order: number;
}
interface AssignmentRow {
  id: string;
  travel_group_id: string;
  student_id: string;
  student: { first_name: string; last_name: string } | null;
}
interface ChaperoneRow {
  id: string;
  travel_group_id: string;
  guardian_id: string | null;
  name_override: string | null;
  guardian: { name: string } | null;
}
interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface GuardianRow {
  id: string;
  name: string;
  student: { last_name: string } | null;
}

function studentName(s: { first_name: string; last_name: string }): string {
  return `${s.last_name}, ${s.first_name}`;
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; tripId: string }>;
  searchParams: Promise<{
    sel?: string;
    fill?: string;
    conflict?: string;
    conflictKind?: string;
    error?: string;
    confirm?: string;
    groupId?: string;
    help?: string;
  }>;
}) {
  const { program: slug, tripId } = await params;
  const { program, role, flags, membership, isSupport } =
    await getTenantContext(slug);
  requireFlag(program, "travel");
  const canWrite = TRAVEL_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const sp = await searchParams;

  const supabase = await createClient();

  // First-use intro strip (spec 003 §3) — how the tap-to-place loading flow works.
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

  // This season's competitions for the Edit-trip linker (mirrors the create form
  // on travel/page.tsx). Writers only — the read-only view has no linker.
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

  // Groups for this trip.
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

  // Queue: eligible students still missing a relevant kind, sorted by name.
  const queue = eligible.filter((s) => neededOf(s.id).length > 0);

  const selId = sp.sel && studentById.has(sp.sel) ? sp.sel : null;
  const selStudent = selId ? studentById.get(selId)! : null;
  const selNeeds = selId ? neededOf(selId) : [];

  // H1 bulk-fill flow: `?fill=<groupId>` makes one group the *active target*.
  // A sticky bar names it and the unassigned queue becomes big tap-chips — one
  // tap places a rider and the page re-renders (server data) with the bar still
  // up. Writers only; ignore a stale/foreign id. The chip list offers only riders
  // who still need this group's kind, so a tap never trips the one-room-one-bus
  // guard. Counts re-derive from `assignmentsByGroup` every render (no client
  // state that can lie); over-capacity warns, never blocks.
  const fillGroup =
    canWrite && sp.fill ? (groups.find((g) => g.id === sp.fill) ?? null) : null;
  const fillKind = fillGroup?.kind ?? null;

  // Cascade-delete confirmations (the ?confirm= confirm-box idiom used across the
  // app): a group or the whole trip is only removed on the second, explicit tap.
  const confirmDeleteTrip = sp.confirm === "deletetrip" && canWrite;
  const confirmDeleteGroup =
    sp.confirm === "deletegroup" && canWrite ? sp.groupId : null;
  const fillMembers = fillGroup
    ? (assignmentsByGroup.get(fillGroup.id) ?? [])
    : [];
  const fillCount = fillMembers.length;
  const fillOver =
    fillGroup?.capacity != null && fillCount > fillGroup.capacity;
  const fillChips =
    fillGroup && fillKind
      ? queue.filter((s) => neededOf(s.id).includes(fillKind))
      : [];

  // Kinds/sections to render: buses always (writers can add); rooms when overnight
  // or any room group already exists.
  const kindsToShow: TravelGroupKind[] = TRAVEL_GROUP_KINDS.filter((k) => {
    if (k === "bus") return true;
    return trip.is_overnight || groups.some((g) => g.kind === "room");
  });

  // Friendly one-room-one-bus conflict message (§6).
  let conflictMsg: string | null = null;
  if (sp.conflict && sp.conflictKind) {
    const s = studentById.get(sp.conflict);
    const kind = sp.conflictKind as TravelGroupKind;
    const existing = groups.find(
      (g) =>
        g.kind === kind &&
        (assignmentsByGroup.get(g.id) ?? []).some(
          (a) => a.student_id === sp.conflict,
        ),
    );
    const who = s ? s.first_name : "That student";
    conflictMsg = existing
      ? `${who} is already in ${existing.label} — remove them there first.`
      : `${who} is already assigned to a ${GROUP_KIND_LABEL[kind].toLowerCase()} on this trip.`;
  }

  const roomsExist = groups.some((g) => g.kind === "room");

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

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/travel`}>← Travel</Link>
      </p>
      <div className="page-title-row">
        <h1>{trip.name}</h1>
        {showGuide && <HelpDot href={`/${slug}/travel/${tripId}?help=1`} />}
      </div>
      {showGuide && (
        <IntroStrip
          surfaceKey="trip"
          programId={program.id}
          selfPath={`/${slug}/travel/${tripId}`}
          guideState={guideState}
          help={sp.help === "1"}
        />
      )}
      <p className="muted">
        {trip.starts_on
          ? formatDateInTz(`${trip.starts_on}T12:00:00Z`, tz)
          : "No dates"}
        {trip.ends_on && trip.ends_on !== trip.starts_on
          ? ` – ${formatDateInTz(`${trip.ends_on}T12:00:00Z`, tz)}`
          : ""}
        {" · "}
        <span className="badge">{trip.is_overnight ? "Overnight" : "Day"}</span>
        {trip.competition_id && compName ? (
          <>
            {" · "}
            <Link href={`/${slug}/competitions/${trip.competition_id}`}>
              {compName}
            </Link>
          </>
        ) : null}
      </p>

      {/* Edit trip (name / dates / overnight / linked competition) — writers
          only, in the two-tap details idiom used across this page. Pre-filled
          with the current values; the competition select mirrors the create
          form on travel/page.tsx. The overnight toggle is room-safe: the action
          rejects clearing it while rooms still exist. */}
      {canWrite && (
        <details className="stack">
          <summary className="muted">Edit trip</summary>
          <form
            action={updateTrip}
            className="stack"
            style={{ gap: "0.5rem", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="tripId" value={tripId} />
            <label>
              Name
              <input type="text" name="name" defaultValue={trip.name} required />
            </label>
            <div className="row-inline">
              <label>
                Starts
                <input
                  type="date"
                  name="starts_on"
                  defaultValue={trip.starts_on ?? ""}
                />
              </label>
              <label>
                Ends
                <input
                  type="date"
                  name="ends_on"
                  defaultValue={trip.ends_on ?? ""}
                />
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  name="is_overnight"
                  defaultChecked={trip.is_overnight}
                />{" "}
                Overnight (rooms + buses)
              </label>
            </div>
            <label>
              Competition (optional)
              <select
                name="competition_id"
                defaultValue={trip.competition_id ?? ""}
              >
                <option value="">— none (banquet, tour, standalone)</option>
                {seasonComps.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="secondary">
              Save trip
            </button>
          </form>
        </details>
      )}

      {/* Derived-document downloads (§6, VI) */}
      <p className="row-inline">
        <a href={`/api/pdf/bus?trip=${trip.id}`} target="_blank" rel="noopener">
          Download bus manifest (PDF)
        </a>
        {(trip.is_overnight || roomsExist) && (
          <a
            href={`/api/pdf/rooms?trip=${trip.id}`}
            target="_blank"
            rel="noopener"
          >
            Download room sheets (PDF)
          </a>
        )}
      </p>

      {conflictMsg && <p className="alert-error">{conflictMsg}</p>}
      {sp.error === "name" && (
        <p className="alert-error">A trip needs a name.</p>
      )}
      {sp.error === "dates" && (
        <p className="alert-error">
          A trip can&apos;t end before it starts.
        </p>
      )}
      {sp.error === "overnight_rooms" && (
        <p className="alert-error">
          Remove this trip&apos;s rooms before making it a day trip.
        </p>
      )}
      {sp.error === "save" && (
        <p className="alert-error">Couldn&apos;t save the trip. Try again.</p>
      )}
      {sp.error === "assign" && (
        <p className="alert-error">
          Couldn&apos;t place that student. Try again.
        </p>
      )}
      {sp.error === "group" && (
        <p className="alert-error">A group needs a kind and a label.</p>
      )}
      {sp.error === "chaperone" && (
        <p className="alert-error">
          Pick a guardian or type a name for the chaperone.
        </p>
      )}

      {/* Trip schedule (G2.5) — read-only per-day view for multi-day trips. */}
      {isMultiDay && (
        <section className="stack trip-schedule" style={{ width: "100%" }}>
          <h2>Trip schedule</h2>
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
                <ul
                  className="stack"
                  style={{ listStyle: "none", padding: 0, margin: 0 }}
                >
                  {day.entries.map((e, i) => (
                    <li
                      key={i}
                      className="row-inline"
                      style={{ gap: "0.5rem" }}
                    >
                      <strong>{formatTimeInTz(e.startsAt, tz)}</strong>
                      <span>{e.label}</span>
                      <span className="chip">
                        {e.source === "event" ? "event" : "itinerary"}
                      </span>
                      {e.sublabel && (
                        <span className="muted">· {e.sublabel}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ============ H1: bulk-fill tap-chip queue (active target) ============ */}
      {/* Drag-free bus/room loading for phones: with a target picked, the whole
          unassigned queue (for that kind) becomes big tap-chips. One tap = one
          rider placed; the page re-renders from server data and the sticky bar
          below keeps the target up. Renders for every viewport (great on desktop
          too) and sits alongside — not replacing — the two-pane flow. */}
      {fillGroup && (
        <section className="travel-fill-queue stack">
          <h2>Tap a name to add to {fillGroup.label}</h2>
          {fillChips.length === 0 ? (
            <p className="alert-ok">
              Everyone who still needs a{" "}
              {GROUP_KIND_LABEL[fillGroup.kind].toLowerCase()} is placed.
            </p>
          ) : (
            <div className="travel-chip-grid">
              {fillChips.map((s) => {
                const isAbsent = absent.has(s.id);
                const needs = neededOf(s.id);
                return (
                  <form
                    key={s.id}
                    action={assignStudent}
                    className="travel-chip-form"
                  >
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="tripId" value={tripId} />
                    <input
                      type="hidden"
                      name="travelGroupId"
                      value={fillGroup.id}
                    />
                    <input type="hidden" name="studentId" value={s.id} />
                    <input type="hidden" name="kind" value={fillGroup.kind} />
                    <input type="hidden" name="fill" value={fillGroup.id} />
                    <button
                      type="submit"
                      className="travel-chip"
                      style={{ opacity: isAbsent ? 0.6 : 1 }}
                      aria-label={`Add ${studentName(s)} to ${fillGroup.label}`}
                    >
                      <span className="travel-chip-name">{studentName(s)}</span>
                      <span className="travel-chip-badges">
                        {isAbsent && (
                          <span className="chip danger">absent</span>
                        )}
                        {needs.map((k) => (
                          <span key={k} className="chip">
                            needs {GROUP_KIND_LABEL[k].toLowerCase()}
                          </span>
                        ))}
                      </span>
                    </button>
                  </form>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1.5rem",
          width: "100%",
        }}
      >
        {/* ==================== LEFT: unassigned queue ==================== */}
        <div className="stack" style={{ flex: "1 1 16rem", minWidth: "14rem" }}>
          <h2>Unassigned · {queue.length}</h2>
          {eligible.length === 0 && (
            <p className="muted">
              No eligible students.{" "}
              {trip.competition_id
                ? "Add ensemble members for the linked competition's ensemble this season."
                : "Add ensemble members for this season."}
            </p>
          )}
          {eligible.length > 0 && queue.length === 0 && (
            <p className="alert-ok">Everyone eligible is placed.</p>
          )}

          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {queue.map((s) => {
              const isAbsent = absent.has(s.id);
              const isSel = s.id === selId;
              const needs = neededOf(s.id);
              return (
                <li
                  key={s.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    padding: "0.5rem",
                    borderBottom: "1px solid var(--border)",
                    background: isSel ? "var(--border)" : undefined,
                    borderRadius: isSel ? 6 : undefined,
                    opacity: isAbsent ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {studentName(s)}
                    {isAbsent && <span className="chip danger"> absent</span>}
                  </div>
                  <div
                    className="row-inline"
                    style={{ gap: "0.35rem", flexWrap: "wrap" }}
                  >
                    {needs.map((k) => (
                      <span key={k} className="chip">
                        needs {GROUP_KIND_LABEL[k].toLowerCase()}
                      </span>
                    ))}
                  </div>
                  {canWrite &&
                    (isSel ? (
                      <div className="row-inline">
                        <strong>Selected — choose a group →</strong>
                        <Link
                          href={`/${slug}/travel/${tripId}`}
                          className="linklike"
                        >
                          Cancel
                        </Link>
                      </div>
                    ) : (
                      <Link
                        href={`/${slug}/travel/${tripId}?sel=${s.id}`}
                        className="linklike"
                      >
                        Select to place
                      </Link>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>

        {/* ==================== RIGHT: group cards ==================== */}
        <div className="stack" style={{ flex: "3 1 26rem", minWidth: "18rem" }}>
          {kindsToShow.map((kind) => {
            const kindGroups = groups.filter((g) => g.kind === kind);
            // Anchor target so the post-add redirect lands back on this section
            // (createGroup redirects to …#rooms / …#buses) instead of the top.
            const sectionAnchor = kind === "room" ? "rooms" : "buses";
            return (
              <div key={kind} id={sectionAnchor} className="stack">
                <h2>{GROUP_KIND_LABEL_PLURAL[kind]}</h2>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "1rem",
                    width: "100%",
                  }}
                >
                  {kindGroups.map((g) => {
                    const members = (assignmentsByGroup.get(g.id) ?? []).sort(
                      (a, b) =>
                        studentName(
                          a.student ?? { first_name: "", last_name: "" },
                        ).localeCompare(
                          studentName(
                            b.student ?? { first_name: "", last_name: "" },
                          ),
                        ),
                    );
                    const count = members.length;
                    const over = g.capacity != null && count > g.capacity;
                    const groupChaps = chaperonesByGroup.get(g.id) ?? [];
                    const selAlreadyHere = selId
                      ? (studentKinds.get(selId)?.has(kind) ?? false)
                      : false;
                    const canAssignHere =
                      selStudent != null && selNeeds.includes(kind);
                    const isFillTarget = fillGroup?.id === g.id;
                    return (
                      <div
                        key={g.id}
                        className="stack"
                        style={{
                          flex: "1 1 15rem",
                          minWidth: "13rem",
                          border: `1px solid ${
                            isFillTarget
                              ? "var(--accent)"
                              : over
                                ? "var(--warn)"
                                : "var(--border)"
                          }`,
                          background: over ? "rgba(217,119,6,0.08)" : undefined,
                          borderRadius: 8,
                          padding: "0.75rem",
                        }}
                      >
                        <div
                          className="row-inline"
                          style={{ justifyContent: "space-between" }}
                        >
                          <strong>{g.label}</strong>
                          <span className={over ? "chip danger" : "chip"}>
                            {count}
                            {g.capacity != null ? ` / ${g.capacity}` : ""}
                            {over ? " over" : ""}
                          </span>
                        </div>
                        {g.notes && <p className="muted">{g.notes}</p>}

                        {/* H1: fill affordance — make this group the active target.
                            Tapping switches the sticky bar + chip queue to it;
                            when it's already active, "Done" drops ?fill=. */}
                        {canWrite &&
                          (isFillTarget ? (
                            <Link
                              href={`/${slug}/travel/${tripId}`}
                              className="travel-fill-toggle is-active"
                            >
                              Filling this{" "}
                              {GROUP_KIND_LABEL[kind].toLowerCase()} — Done
                            </Link>
                          ) : (
                            <Link
                              href={`/${slug}/travel/${tripId}?fill=${g.id}`}
                              className="travel-fill-toggle"
                            >
                              Fill this {GROUP_KIND_LABEL[kind].toLowerCase()}
                            </Link>
                          ))}

                        {/* Members */}
                        <ul
                          style={{ listStyle: "none", padding: 0, margin: 0 }}
                        >
                          {members.map((a) => (
                            <li
                              key={a.id}
                              className="row-inline"
                              style={{
                                justifyContent: "space-between",
                                gap: "0.5rem",
                              }}
                            >
                              <span
                                style={{
                                  opacity: absent.has(a.student_id) ? 0.6 : 1,
                                }}
                              >
                                {a.student ? studentName(a.student) : "?"}
                                {absent.has(a.student_id) && (
                                  <span className="chip danger"> absent</span>
                                )}
                              </span>
                              {canWrite && (
                                <form action={unassignStudent}>
                                  <input
                                    type="hidden"
                                    name="programId"
                                    value={program.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="slug"
                                    value={slug}
                                  />
                                  <input
                                    type="hidden"
                                    name="tripId"
                                    value={tripId}
                                  />
                                  <input
                                    type="hidden"
                                    name="assignmentId"
                                    value={a.id}
                                  />
                                  <button
                                    type="submit"
                                    className="linklike danger"
                                    aria-label={`Remove ${
                                      a.student ? studentName(a.student) : "student"
                                    } from ${g.label}`}
                                  >
                                    remove
                                  </button>
                                </form>
                              )}
                            </li>
                          ))}
                          {members.length === 0 && (
                            <li className="muted">Empty</li>
                          )}
                        </ul>

                        {/* One-tap add (D7): a per-card picker of unassigned-
                            queue students who still need THIS kind, posting
                            straight to assignStudent — no select-then-scroll.
                            The select-then-"Assign here" flow below stays for
                            desktop. Offering only students missing this kind
                            avoids the one-room-one-bus conflict on submit. */}
                        {canWrite &&
                          (() => {
                            const addable = queue.filter((s) =>
                              neededOf(s.id).includes(kind),
                            );
                            return addable.length > 0 ? (
                              <form
                                action={assignStudent}
                                className="row-inline"
                                style={{ gap: "0.35rem", flexWrap: "wrap" }}
                              >
                                <input
                                  type="hidden"
                                  name="programId"
                                  value={program.id}
                                />
                                <input type="hidden" name="slug" value={slug} />
                                <input
                                  type="hidden"
                                  name="tripId"
                                  value={tripId}
                                />
                                <input
                                  type="hidden"
                                  name="travelGroupId"
                                  value={g.id}
                                />
                                <input type="hidden" name="kind" value={kind} />
                                <select
                                  name="studentId"
                                  defaultValue=""
                                  required
                                  aria-label={`Add a student to ${g.label}`}
                                >
                                  <option value="">Add a student…</option>
                                  {addable.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {studentName(s)}
                                    </option>
                                  ))}
                                </select>
                                <button type="submit" className="secondary">
                                  Add
                                </button>
                              </form>
                            ) : null;
                          })()}

                        {/* Assign selected student here */}
                        {canWrite &&
                          selStudent &&
                          (canAssignHere ? (
                            <form action={assignStudent}>
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="tripId"
                                value={tripId}
                              />
                              <input
                                type="hidden"
                                name="travelGroupId"
                                value={g.id}
                              />
                              <input
                                type="hidden"
                                name="studentId"
                                value={selStudent.id}
                              />
                              <input type="hidden" name="kind" value={kind} />
                              <button type="submit" className="secondary">
                                Assign {selStudent.first_name} here
                              </button>
                            </form>
                          ) : selAlreadyHere ? (
                            <p className="muted">
                              {selStudent.first_name} already has a{" "}
                              {GROUP_KIND_LABEL[kind].toLowerCase()}.
                            </p>
                          ) : null)}

                        {/* Chaperones */}
                        <div className="stack" style={{ gap: "0.35rem" }}>
                          <span className="muted">Chaperones</span>
                          <ul
                            style={{ listStyle: "none", padding: 0, margin: 0 }}
                          >
                            {groupChaps.map((c) => {
                              const chapName = c.guardian_id
                                ? (guardianName.get(c.guardian_id) ??
                                  c.guardian?.name ??
                                  "?")
                                : (c.name_override ?? "?");
                              return (
                              <li
                                key={c.id}
                                className="row-inline"
                                style={{
                                  justifyContent: "space-between",
                                  gap: "0.5rem",
                                }}
                              >
                                <span>{chapName}</span>
                                {canWrite && (
                                  <form action={removeChaperone}>
                                    <input
                                      type="hidden"
                                      name="programId"
                                      value={program.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="slug"
                                      value={slug}
                                    />
                                    <input
                                      type="hidden"
                                      name="tripId"
                                      value={tripId}
                                    />
                                    <input
                                      type="hidden"
                                      name="chaperoneId"
                                      value={c.id}
                                    />
                                    <button
                                      type="submit"
                                      className="linklike danger"
                                      aria-label={`Remove ${chapName} from ${g.label}`}
                                    >
                                      remove
                                    </button>
                                  </form>
                                )}
                              </li>
                              );
                            })}
                            {groupChaps.length === 0 && (
                              <li className="muted">None yet</li>
                            )}
                          </ul>
                          {/* Chaperone-ratio awareness (D6): purely informational,
                              never a warning — programs' policies vary (common
                              guidance is ~1:10 for day trips). Shown only when the
                              group actually has riders. */}
                          {count > 0 && (
                            <p
                              className="muted"
                              style={{ margin: 0, fontSize: "0.85rem" }}
                            >
                              {groupChaps.length > 0
                                ? `1 chaperone per ${Math.ceil(
                                    count / groupChaps.length,
                                  )} student${
                                    Math.ceil(count / groupChaps.length) === 1
                                      ? ""
                                      : "s"
                                  }`
                                : "No chaperone assigned yet"}
                            </p>
                          )}
                          {canWrite && (
                            <form
                              action={addChaperone}
                              className="stack"
                              style={{ gap: "0.35rem" }}
                            >
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="tripId"
                                value={tripId}
                              />
                              <input
                                type="hidden"
                                name="travelGroupId"
                                value={g.id}
                              />
                              <select
                                name="guardian_id"
                                defaultValue=""
                                aria-label="Chaperone — pick a guardian"
                              >
                                <option value="">— parent (guardian)…</option>
                                {guardians.map((gd) => (
                                  <option key={gd.id} value={gd.id}>
                                    {gd.name}
                                    {gd.student?.last_name
                                      ? ` (${gd.student.last_name})`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                name="name_override"
                                placeholder="…or type a one-off helper's name"
                                aria-label="Chaperone — or type a one-off helper's name"
                              />
                              <button type="submit" className="secondary">
                                Add chaperone
                              </button>
                            </form>
                          )}
                        </div>

                        {/* Edit / delete group */}
                        {canWrite && (
                          <details open={confirmDeleteGroup === g.id}>
                            <summary className="muted">
                              Edit {GROUP_KIND_LABEL[kind].toLowerCase()}
                            </summary>
                            <form
                              action={updateGroup}
                              className="stack"
                              style={{ gap: "0.35rem", marginTop: "0.5rem" }}
                            >
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="tripId"
                                value={tripId}
                              />
                              <input
                                type="hidden"
                                name="groupId"
                                value={g.id}
                              />
                              <label>
                                Label
                                <input
                                  type="text"
                                  name="label"
                                  defaultValue={g.label}
                                  required
                                />
                              </label>
                              <label>
                                Capacity
                                <input
                                  type="number"
                                  name="capacity"
                                  className="num"
                                  defaultValue={g.capacity ?? ""}
                                  min={0}
                                />
                              </label>
                              <label>
                                Sort
                                <input
                                  type="number"
                                  name="sort_order"
                                  className="num"
                                  defaultValue={g.sort_order}
                                />
                              </label>
                              <label>
                                Notes
                                <input
                                  type="text"
                                  name="notes"
                                  defaultValue={g.notes ?? ""}
                                />
                              </label>
                              <button type="submit" className="secondary">
                                Save
                              </button>
                            </form>
                            {confirmDeleteGroup === g.id ? (
                              <div
                                className="confirm-box stack"
                                style={{ marginTop: "0.5rem" }}
                              >
                                <p>
                                  Delete {g.label}? Its rider assignments and
                                  chaperones are removed too.
                                </p>
                                <form
                                  action={deleteGroup}
                                  className="row-inline"
                                >
                                  <input
                                    type="hidden"
                                    name="programId"
                                    value={program.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="slug"
                                    value={slug}
                                  />
                                  <input
                                    type="hidden"
                                    name="tripId"
                                    value={tripId}
                                  />
                                  <input
                                    type="hidden"
                                    name="groupId"
                                    value={g.id}
                                  />
                                  <button type="submit" className="danger">
                                    Confirm delete
                                  </button>
                                  <Link href={`/${slug}/travel/${tripId}`}>
                                    Cancel
                                  </Link>
                                </form>
                              </div>
                            ) : (
                              <p style={{ marginTop: "0.5rem" }}>
                                <Link
                                  className="linklike danger"
                                  href={`/${slug}/travel/${tripId}?confirm=deletegroup&groupId=${g.id}`}
                                >
                                  Delete this{" "}
                                  {GROUP_KIND_LABEL[kind].toLowerCase()} (and
                                  its assignments)
                                </Link>
                              </p>
                            )}
                          </details>
                        )}
                      </div>
                    );
                  })}
                  {kindGroups.length === 0 && (
                    <p className="muted">
                      No {GROUP_KIND_LABEL_PLURAL[kind].toLowerCase()} yet.
                    </p>
                  )}
                </div>

                {/* Add a group of this kind */}
                {canWrite && (
                  <form action={createGroup} className="row-inline">
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="kind" value={kind} />
                    <label>
                      Add {GROUP_KIND_LABEL[kind].toLowerCase()}
                      <input
                        type="text"
                        name="label"
                        required
                        placeholder={kind === "room" ? "Room 214" : "Bus 1"}
                      />
                    </label>
                    <label>
                      Capacity
                      <input
                        type="number"
                        name="capacity"
                        className="num"
                        min={0}
                      />
                    </label>
                    <button type="submit" className="secondary">
                      Add
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Danger zone — delete trip (two-tap confirm-box idiom) */}
      {canWrite && (
        <details open={confirmDeleteTrip}>
          <summary className="muted">Delete trip</summary>
          {confirmDeleteTrip ? (
            <div className="confirm-box stack" style={{ marginTop: "0.5rem" }}>
              <p>
                Delete this trip? All its buses, rooms, and assignments go with
                it.
              </p>
              <form action={deleteTrip} className="row-inline">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="tripId" value={tripId} />
                <button type="submit" className="danger">
                  Confirm delete trip
                </button>
                <Link href={`/${slug}/travel/${tripId}`}>Cancel</Link>
              </form>
            </div>
          ) : (
            <p style={{ marginTop: "0.5rem" }}>
              <Link
                className="linklike danger"
                href={`/${slug}/travel/${tripId}?confirm=deletetrip`}
              >
                Delete this trip and all its groups, assignments, and chaperones
              </Link>
            </p>
          )}
        </details>
      )}

      {/* H1: sticky target bar — pinned to the viewport bottom while a group is
          being filled. Styled like the mobile tab bar. Count/capacity re-derive
          from server data every render; over-capacity warns (never blocks). The
          "Done" control is a real link that drops ?fill= and returns to browse. */}
      {fillGroup && (
        <div className="travel-fill-bar">
          <span className="travel-fill-bar-label">
            Filling <strong>{fillGroup.label}</strong>
            <span className={fillOver ? "chip danger" : "chip"}>
              {fillCount}
              {fillGroup.capacity != null ? ` / ${fillGroup.capacity}` : ""}
              {fillOver ? " over" : ""}
            </span>
          </span>
          <Link
            href={`/${slug}/travel/${tripId}`}
            className="travel-fill-bar-done"
          >
            Done
          </Link>
        </div>
      )}
    </section>
  );
}
