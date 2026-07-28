import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "../../Restricted";
import { ArchivedBanner } from "../../ArchivedBanner";
import { HOSTING_ROLES, HOSTING_WRITE_ROLES } from "@/lib/nav";
import { formatDateInTz } from "@/lib/datetime";
import {
  HOSTED_EVENT_STATUS_LABELS,
  formatHostedDateRange,
  type HostedEventRow,
  type HostedSchoolRow,
  type HostedSlotRow,
} from "@/lib/hosting";
import { IntroStrip, HelpDot } from "../../IntroStrip";
import { loadGuideState } from "@/lib/guide";
import { EventEdit } from "./EventEdit";
import { SchoolsSection } from "./SchoolsSection";
import { ScheduleSection } from "./ScheduleSection";
import { hostOk, hostError, type HostSection } from "./shared";

// The host command center (spec 005 Wave 7 / US11). Four titled sections in one
// constant order — Overview · Visiting schools · Schedule · Day-of documents —
// each with a live one-line summary beside its heading, so the page can be read
// without opening anything.
//
// What it replaces: 948 lines in which every fact a host needs on the morning of
// the invitational sat behind one of six identical unlabeled `<details>`
// triangles, and eight search params existed only to print a toast at the top of
// the page, far from the form that produced them. Now only MUTATIONS sit in
// disclosures, every summary names what it holds and shows its current state,
// and messages land in the section they concern (`shared.ts`).
//
// This file loads the data and composes the sections; each section renders in
// its own sibling file. Writers (director/admin) get the edit affordances;
// board_member reads. A season-archived event renders read-only behind the
// shared ArchivedBanner (the RLS layer also blocks writes — defense in depth).

export const dynamic = "force-dynamic";

interface EventRowWithSeason extends HostedEventRow {
  seasons: { label: string; archived_at: string | null } | null;
}

export default async function HostingEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; eventId: string }>;
  // Next hands back an ARRAY for a duplicated param (?open=a&open=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, eventId } = await params;
  const { program, role, flags, membership, isSupport } =
    await getTenantContext(slug);
  requireFlag(program, "hosting");
  if (!HOSTING_ROLES.includes(role)) {
    return (
      <Restricted
        slug={slug}
        surface="Hosting"
        role={role}
        allowed={HOSTING_ROLES}
      />
    );
  }
  const tz = program.timezone;
  const base = `/${slug}`;
  const eventBase = `${base}/hosting/${eventId}`;

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();

  // First-use intro strip (spec 003 §3) — what host-mode does end to end.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(supabase, program.id, membership.user_id)
      : {};

  const { data: eventData } = await supabase
    .from("hosted_events")
    .select(
      "id, program_id, season_id, name, event_date, end_date, venue_notes, host_contact, status, created_at, updated_at, seasons(label, archived_at)",
    )
    .eq("id", eventId)
    .eq("program_id", program.id)
    .maybeSingle();
  const event = eventData as EventRowWithSeason | null;
  if (!event) notFound();

  const archived = event.seasons?.archived_at != null;
  const canWrite = HOSTING_WRITE_ROLES.includes(role) && !archived;

  const { data: schoolData } = await supabase
    .from("hosted_schools")
    .select(
      "id, program_id, hosted_event_id, school_name, ensemble_name, director_name, director_email, director_phone, performer_count, division, costume_colors, homeroom, arrival_notes, sort_order, created_at, updated_at",
    )
    .eq("program_id", program.id)
    .eq("hosted_event_id", eventId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const schools = (schoolData as HostedSchoolRow[] | null) ?? [];

  const { data: slotData } = await supabase
    .from("hosted_slots")
    .select(
      "id, program_id, hosted_event_id, hosted_school_id, kind, label, starts_at, duration_minutes, sort_order, created_at, updated_at",
    )
    .eq("program_id", program.id)
    .eq("hosted_event_id", eventId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true });
  const slots = (slotData as HostedSlotRow[] | null) ?? [];

  const statusLabel = HOSTED_EVENT_STATUS_LABELS[event.status];
  const dateStr =
    formatHostedDateRange(event.event_date, event.end_date, tz) || "No date set";
  // The invitational spans more than one day (Wave N) — drives the per-day
  // generate hint and the day-scoped shift copy. end_date is normalized to null
  // when single-day, so this is exactly "spans more than one day".
  const eventMultiDay = event.end_date != null;

  // One `?ok=` and one `?error=`, each resolving to the SECTION that owns the
  // message (shared.ts) — the eight toast-only params are gone.
  const okFlash = hostOk(one("ok"));
  const errFlash = hostError(one("error"));
  const okIn = (s: HostSection) =>
    okFlash?.section === s ? okFlash.message : null;
  const errIn = (s: HostSection) =>
    errFlash?.section === s ? errFlash.message : null;

  // `?open=` addresses ONE disclosure: a school card or slot row by id, or the
  // word for a section-level form ("event", "school", "slot", "generate"). It
  // also carries the row a `?confirm=` refers to, so the two-press destructive
  // flow reopens the panel it started in — before this, pressing "Remove school"
  // navigated to a confirm box rendered inside a panel that had just closed,
  // and the second press had nothing to press.
  const openParam = canWrite ? one("open") : null;
  const confirm = canWrite ? one("confirm") : null;
  const confirmRemoveSchoolId = confirm === "removeschool" ? openParam : null;
  const confirmDeleteSlotId = confirm === "deleteslot" ? openParam : null;
  const eventEditOpen = openParam === "event" || !!errIn("overview");

  return (
    <section className="hosting-event">
      <p className="comp-back">
        <Link href={`${base}/hosting`}>← Hosting</Link>
      </p>

      {archived && (
        <ArchivedBanner
          seasonLabel={event.seasons?.label}
          archivedAtLabel={
            event.seasons?.archived_at
              ? formatDateInTz(event.seasons.archived_at, tz)
              : null
          }
        />
      )}

      {/* ---- Header ---- */}
      <div className="comp-head">
        <div className="comp-head-titles">
          <div className="comp-status-row">
            <span className="chip">{statusLabel}</span>
          </div>
          <div className="page-title-row">
            <h1 className="comp-h1">{event.name}</h1>
            {showGuide && <HelpDot href={`${eventBase}?help=1`} />}
          </div>
          <p className="comp-meta">
            {dateStr} · {schools.length} school
            {schools.length === 1 ? "" : "s"} · {slots.length} slot
            {slots.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="comp-head-actions">
          <a
            href={`/api/pdf/host-schedule?event=${eventId}`}
            target="_blank"
            className="button-link"
          >
            Master schedule (PDF)
          </a>
        </div>
      </div>

      {showGuide && (
        <IntroStrip
          surfaceKey="hosting_event"
          programId={program.id}
          selfPath={eventBase}
          guideState={guideState}
          help={one("help") === "1"}
        />
      )}

      {/* ================= OVERVIEW ================= */}
      <section className="comp-section" id="overview">
        <div className="comp-section-head">
          <h2>Overview</h2>
          <span className="comp-section-summary">
            {dateStr} · {statusLabel}
          </span>
        </div>
        {okIn("overview") && <p className="alert-ok">{okIn("overview")}</p>}
        {errIn("overview") && (
          <p className="alert-error">{errIn("overview")}</p>
        )}
        <dl className="detail-list">
          <dt>Season</dt>
          <dd>{event.seasons?.label ?? "—"}</dd>
          <dt>Day-of contact</dt>
          <dd>
            {event.host_contact ?? (
              <span className="muted">
                Not set — visiting directors get this on their packet
              </span>
            )}
          </dd>
          <dt>Venue notes</dt>
          <dd>
            {event.venue_notes ?? <span className="muted">None yet</span>}
          </dd>
        </dl>
        {canWrite && (
          <EventEdit
            programId={program.id}
            slug={slug}
            event={event}
            summary={`${dateStr} · ${statusLabel}`}
            open={eventEditOpen}
          />
        )}
      </section>

      {/* ================= VISITING SCHOOLS ================= */}
      <SchoolsSection
        programId={program.id}
        slug={slug}
        eventId={eventId}
        eventBase={eventBase}
        schools={schools}
        canWrite={canWrite}
        open={openParam}
        confirmRemoveId={confirmRemoveSchoolId}
        ok={okIn("schools")}
        error={errIn("schools")}
      />

      {/* ================= SCHEDULE ================= */}
      <ScheduleSection
        programId={program.id}
        slug={slug}
        eventId={eventId}
        eventBase={eventBase}
        tz={tz}
        slots={slots}
        schools={schools}
        eventMultiDay={eventMultiDay}
        canWrite={canWrite}
        open={openParam}
        confirmDeleteId={confirmDeleteSlotId}
        ok={okIn("schedule")}
        error={errIn("schedule")}
      />

      {/* ================= DAY-OF DOCUMENTS ================= */}
      <section className="comp-section" id="documents">
        <div className="comp-section-head">
          <h2>Day-of documents</h2>
          <span className="comp-section-summary">
            Print-ready, straight from what&apos;s above
          </span>
        </div>
        <div className="hosting-doc-links">
          <a href={`/api/pdf/host-schedule?event=${eventId}`} target="_blank">
            Master schedule ↓
          </a>
          <a href={`/api/pdf/host-doorsigns?event=${eventId}`} target="_blank">
            Homeroom door signs ↓
          </a>
          <a href={`/api/pdf/host-packet?event=${eventId}`} target="_blank">
            Director packets ↓
          </a>
        </div>
        <p className="muted hosting-seam">
          Need volunteers for the day? Create shifts on the{" "}
          <Link href={`${base}/comms/shifts`}>Comms → Shifts</Link> page —
          either standalone or attached to a general event you make for the
          invitational.
        </p>
      </section>
    </section>
  );
}
