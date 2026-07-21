import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "../../Restricted";
import { ArchivedBanner } from "../../ArchivedBanner";
import { HOSTING_ROLES, HOSTING_WRITE_ROLES } from "@/lib/nav";
import {
  formatDateInTz,
  formatTimeInTz,
  toZonedInputValue,
} from "@/lib/datetime";
import {
  HOSTED_EVENT_STATUSES,
  HOSTED_EVENT_STATUS_LABELS,
  HOSTED_SLOT_KINDS,
  HOSTED_SLOT_KIND_LABELS,
  NO_HEALTH_LABEL,
  DEFAULT_WARMUP_MINUTES,
  DEFAULT_PERFORM_MINUTES,
  type HostedEventRow,
  type HostedSchoolRow,
  type HostedSlotRow,
} from "@/lib/hosting";
import {
  updateHostedEvent,
  addHostedSchool,
  updateHostedSchool,
  removeHostedSchool,
  addHostedSlot,
  updateHostedSlot,
  removeHostedSlot,
  generateHostedSchedule,
  shiftRemainingSlots,
} from "../actions";

// Host-mode event command center (Wave I2) — one page, three sections + header,
// the comp-week idiom. Schools, schedule builder (generate + shift-remaining),
// and day-of documents. Writers (director/admin) get inline edit/add/remove;
// board_member reads. Season-archived events render read-only behind the shared
// ArchivedBanner (the RLS layer also blocks writes — defense in depth).

export const dynamic = "force-dynamic";

interface EventRowWithSeason extends HostedEventRow {
  seasons: { label: string; archived_at: string | null } | null;
}

export default async function HostingEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; eventId: string }>;
  searchParams: Promise<{
    saved?: string;
    created?: string;
    school_saved?: string;
    school_removed?: string;
    slot_saved?: string;
    slot_removed?: string;
    generated?: string;
    shifted?: string;
    dir?: string;
    error?: string;
    confirm?: string;
    schoolId?: string;
  }>;
}) {
  const { program: slug, eventId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "hosting");
  if (!HOSTING_ROLES.includes(role)) {
    return <Restricted slug={slug} surface="Hosting" role={role} allowed={HOSTING_ROLES} />;
  }
  const tz = program.timezone;
  const sp = await searchParams;
  const base = `/${slug}`;
  const eventBase = `${base}/hosting/${eventId}`;

  const supabase = await createClient();
  const { data: eventData } = await supabase
    .from("hosted_events")
    .select(
      "id, program_id, season_id, name, event_date, venue_notes, status, created_at, updated_at, seasons(label, archived_at)",
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

  const schoolName = new Map<string, string>();
  for (const s of schools) schoolName.set(s.id, s.school_name);

  // Rooms-in-use + duplicate-homeroom detection (warn, never block).
  const homeroomCount = new Map<string, number>();
  for (const s of schools) {
    const hr = (s.homeroom ?? "").trim();
    if (hr) homeroomCount.set(hr, (homeroomCount.get(hr) ?? 0) + 1);
  }
  const roomsInUse = Array.from(homeroomCount.keys()).sort((a, b) => a.localeCompare(b));
  const dupHomerooms = new Set(
    Array.from(homeroomCount.entries())
      .filter(([, n]) => n > 1)
      .map(([hr]) => hr),
  );

  const hasSlots = slots.length > 0;
  const confirmRemoveSchool = sp.confirm === "removeschool" && canWrite ? sp.schoolId : null;
  const confirmReplace = sp.confirm === "replace" && canWrite;

  const statusLabel = HOSTED_EVENT_STATUS_LABELS[event.status];
  const dateStr = event.event_date
    ? formatDateInTz(`${event.event_date}T12:00:00Z`, tz)
    : "No date set";

  return (
    <section className="hosting-event stack">
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

      {sp.created && <p className="alert-ok">Invitational created.</p>}
      {sp.saved && <p className="alert-ok">Saved.</p>}
      {sp.school_saved && <p className="alert-ok">School saved.</p>}
      {sp.school_removed && <p className="alert-ok">School removed.</p>}
      {sp.slot_saved && <p className="alert-ok">Schedule slot saved.</p>}
      {sp.slot_removed && <p className="alert-ok">Slot removed.</p>}
      {sp.generated && <p className="alert-ok">Schedule generated from your schools.</p>}
      {sp.shifted && (
        <p className="alert-ok">
          Moved that slot and everything after it {sp.shifted} minute
          {sp.shifted === "1" ? "" : "s"} {sp.dir === "earlier" ? "earlier" : "later"}.
        </p>
      )}
      {sp.error === "archived" && (
        <p className="alert-error">This season is archived — nothing here can be changed.</p>
      )}
      {sp.error === "name" && <p className="alert-error">The invitational needs a name.</p>}
      {sp.error === "school_name" && <p className="alert-error">A school needs a name.</p>}
      {sp.error === "start" && (
        <p className="alert-error">Pick a start time to generate the schedule.</p>
      )}
      {sp.error === "noschools" && (
        <p className="alert-error">Add at least one school before generating a schedule.</p>
      )}
      {sp.error === "delta" && (
        <p className="alert-error">Enter a non-zero number of minutes to shift.</p>
      )}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      {/* ---- Header ---- */}
      <div className="comp-head">
        <div className="comp-head-titles">
          <div className="comp-status-row">
            <span className="chip">{statusLabel}</span>
          </div>
          <h1 className="comp-h1">{event.name}</h1>
          <p className="comp-meta">
            {dateStr} · {schools.length} school{schools.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="comp-head-actions">
          <a href={`/api/pdf/host-schedule?event=${eventId}`} target="_blank" className="button-link">
            Master schedule (PDF)
          </a>
        </div>
      </div>

      {canWrite && (
        <details className="hosting-header-edit">
          <summary>Edit invitational details</summary>
          <form action={updateHostedEvent} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={eventId} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" defaultValue={event.name} required />
              </label>
              <label>
                Date
                <input type="date" name="event_date" defaultValue={event.event_date ?? ""} />
              </label>
              <label>
                Status
                <select name="status" defaultValue={event.status}>
                  {HOSTED_EVENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {HOSTED_EVENT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Venue notes
              <textarea name="venue_notes" rows={2} defaultValue={event.venue_notes ?? ""} />
            </label>
            <p className="muted">{NO_HEALTH_LABEL}</p>
            <button type="submit">Save details</button>
          </form>
        </details>
      )}

      {/* ================= SCHOOLS ================= */}
      <section className="comp-section" id="schools">
        <div className="comp-section-head">
          <h2>Visiting schools</h2>
          <span className="comp-att-summary">
            {roomsInUse.length > 0
              ? `Rooms in use: ${roomsInUse.join(", ")}`
              : "No homerooms assigned yet"}
          </span>
        </div>
        <p className="muted">
          Adult director contact and a performer count only — never visiting-school student
          data. {NO_HEALTH_LABEL}
        </p>

        {schools.length === 0 ? (
          <p className="muted">No visiting schools yet. Add the first one below.</p>
        ) : (
          <div className="stack">
            {schools.map((s) => {
              const dup = s.homeroom && dupHomerooms.has(s.homeroom.trim());
              return (
                <div className="hosting-school-card" key={s.id}>
                  <div className="hosting-school-head">
                    <strong>{s.school_name}</strong>
                    {s.ensemble_name ? <span className="muted"> · {s.ensemble_name}</span> : null}
                    {s.homeroom ? (
                      <span className={`chip${dup ? " warn" : ""}`}>
                        {s.homeroom}
                        {dup ? " · shared" : ""}
                      </span>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <details>
                      <summary>Edit</summary>
                      <form action={updateHostedSchool} className="stack">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="schoolId" value={s.id} />
                        <input type="hidden" name="sort_order" value={s.sort_order} />
                        <SchoolFields school={s} />
                        <button type="submit">Save school</button>
                      </form>
                      {confirmRemoveSchool === s.id ? (
                        <div className="confirm-box stack">
                          <p>
                            Remove <strong>{s.school_name}</strong>? Its schedule slots are kept
                            but unlinked from the school.
                          </p>
                          <form action={removeHostedSchool} className="row-inline">
                            <input type="hidden" name="programId" value={program.id} />
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="schoolId" value={s.id} />
                            <button type="submit" className="danger">
                              Confirm remove
                            </button>
                            <Link href={`${eventBase}#schools`}>Cancel</Link>
                          </form>
                        </div>
                      ) : (
                        <p>
                          <Link
                            className="linklike"
                            href={`${eventBase}?confirm=removeschool&schoolId=${s.id}#schools`}
                          >
                            Remove school
                          </Link>
                        </p>
                      )}
                    </details>
                  ) : (
                    <dl className="detail-list">
                      {s.director_name && (
                        <>
                          <dt>Director</dt>
                          <dd>
                            {s.director_name}
                            {s.director_email ? ` · ${s.director_email}` : ""}
                            {s.director_phone ? ` · ${s.director_phone}` : ""}
                          </dd>
                        </>
                      )}
                      {s.performer_count != null && (
                        <>
                          <dt>Performers</dt>
                          <dd>{s.performer_count}</dd>
                        </>
                      )}
                      {s.division && (
                        <>
                          <dt>Division</dt>
                          <dd>{s.division}</dd>
                        </>
                      )}
                      {s.costume_colors && (
                        <>
                          <dt>Costume colors</dt>
                          <dd>{s.costume_colors}</dd>
                        </>
                      )}
                      {s.arrival_notes && (
                        <>
                          <dt>Arrival notes</dt>
                          <dd>{s.arrival_notes}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canWrite && (
          <details className="hosting-add" open={schools.length === 0}>
            <summary>Add a visiting school</summary>
            <form action={addHostedSchool} className="stack">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="eventId" value={eventId} />
              <SchoolFields school={null} />
              <button type="submit">Add school</button>
            </form>
          </details>
        )}
      </section>

      {/* ================= SCHEDULE BUILDER ================= */}
      <section className="comp-section" id="schedule">
        <div className="comp-section-head">
          <h2>Schedule</h2>
          <span className="comp-att-summary">
            {slots.length} slot{slots.length === 1 ? "" : "s"}
          </span>
        </div>

        {slots.length === 0 ? (
          <p className="muted">No schedule yet. Generate one from your schools, or add slots by hand.</p>
        ) : (
          <div className="stack">
            {slots.map((slot) => (
              <div className="hosting-slot-row" key={slot.id}>
                <span className="hosting-slot-time">
                  {slot.starts_at ? formatTimeInTz(slot.starts_at, tz) : "—"}
                </span>
                <span className="kind-tag hosting">{HOSTED_SLOT_KIND_LABELS[slot.kind]}</span>
                <span className="hosting-slot-body">
                  <strong>
                    {slot.label ??
                      (slot.hosted_school_id ? schoolName.get(slot.hosted_school_id) : null) ??
                      HOSTED_SLOT_KIND_LABELS[slot.kind]}
                  </strong>
                  {slot.duration_minutes != null ? (
                    <span className="muted"> · {slot.duration_minutes} min</span>
                  ) : null}
                </span>
                {canWrite && (
                  <div className="hosting-slot-actions">
                    <details>
                      <summary>Edit</summary>
                      <form action={updateHostedSlot} className="stack">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="slotId" value={slot.id} />
                        <input type="hidden" name="tz" value={tz} />
                        <SlotFields slot={slot} schools={schools} tz={tz} />
                        <button type="submit">Save slot</button>
                      </form>
                      {/* Shift remaining — this slot + every later slot. */}
                      <form action={shiftRemainingSlots} className="row-inline hosting-shift">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="slotId" value={slot.id} />
                        <label>
                          Shift this + later slots by (min)
                          <input
                            type="number"
                            name="delta_minutes"
                            step="1"
                            placeholder="-5"
                            className="num"
                          />
                        </label>
                        <button type="submit" className="secondary">
                          Shift remaining
                        </button>
                      </form>
                      <form action={removeHostedSlot}>
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="slotId" value={slot.id} />
                        <button type="submit" className="linklike">
                          Delete slot
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {canWrite && (
          <>
            {/* Generate schedule — offered when empty; replace behind a confirm. */}
            {!hasSlots ? (
              <details className="hosting-add">
                <summary>Generate schedule</summary>
                <GenerateForm
                  programId={program.id}
                  slug={slug}
                  eventId={eventId}
                  tz={tz}
                  replace={false}
                />
              </details>
            ) : confirmReplace ? (
              <div className="confirm-box stack">
                <p>
                  Replace the current {slots.length}-slot schedule with a freshly generated one?
                  The existing slots are deleted first.
                </p>
                <GenerateForm
                  programId={program.id}
                  slug={slug}
                  eventId={eventId}
                  tz={tz}
                  replace
                />
                <p>
                  <Link href={`${eventBase}#schedule`}>Cancel</Link>
                </p>
              </div>
            ) : (
              <p className="muted">
                <Link className="linklike" href={`${eventBase}?confirm=replace#schedule`}>
                  Regenerate schedule (replaces the current one)
                </Link>
              </p>
            )}

            {/* Add a single slot by hand. */}
            <details className="hosting-add">
              <summary>Add a slot</summary>
              <form action={addHostedSlot} className="stack">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="tz" value={tz} />
                <SlotFields slot={null} schools={schools} tz={tz} />
                <button type="submit">Add slot</button>
              </form>
            </details>
          </>
        )}
      </section>

      {/* ================= DAY-OF DOCUMENTS ================= */}
      <section className="comp-section" id="documents">
        <h2>Day-of documents</h2>
        <p className="muted">Rendered live from the schools and schedule above.</p>
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
      </section>

      {/* ================= VOLUNTEER SEAM ================= */}
      <p className="muted hosting-seam">
        Need volunteers for the day? Create shifts on the{" "}
        <Link href={`${base}/comms/shifts`}>Comms → Shifts</Link> page — either standalone or
        attached to a general event you make for the invitational.
      </p>
    </section>
  );
}

// Shared editable school fieldset (add + inline edit). Free-text fields carry the
// standing no-health label once at the section level, not per field.
function SchoolFields({ school }: { school: HostedSchoolRow | null }) {
  return (
    <>
      <div className="row-inline">
        <label>
          School name
          <input
            type="text"
            name="school_name"
            defaultValue={school?.school_name ?? ""}
            required
          />
        </label>
        <label>
          Ensemble
          <input type="text" name="ensemble_name" defaultValue={school?.ensemble_name ?? ""} />
        </label>
        <label>
          Division
          <input
            type="text"
            name="division"
            placeholder="Large Mixed"
            defaultValue={school?.division ?? ""}
          />
        </label>
      </div>
      <div className="row-inline">
        <label>
          Director name
          <input type="text" name="director_name" defaultValue={school?.director_name ?? ""} />
        </label>
        <label>
          Director email
          <input type="email" name="director_email" defaultValue={school?.director_email ?? ""} />
        </label>
        <label>
          Director phone
          <input type="tel" name="director_phone" defaultValue={school?.director_phone ?? ""} />
        </label>
      </div>
      <div className="row-inline">
        <label>
          Performers
          <input
            type="number"
            name="performer_count"
            className="num"
            defaultValue={school?.performer_count ?? ""}
          />
        </label>
        <label>
          Homeroom
          <input
            type="text"
            name="homeroom"
            placeholder="Rm 214"
            defaultValue={school?.homeroom ?? ""}
          />
        </label>
        <label>
          Costume colors
          <input
            type="text"
            name="costume_colors"
            placeholder="Navy & gold"
            defaultValue={school?.costume_colors ?? ""}
          />
        </label>
      </div>
      <label>
        Arrival notes
        <textarea name="arrival_notes" rows={2} defaultValue={school?.arrival_notes ?? ""} />
      </label>
    </>
  );
}

// Shared editable slot fieldset (add + inline edit).
function SlotFields({
  slot,
  schools,
  tz,
}: {
  slot: HostedSlotRow | null;
  schools: HostedSchoolRow[];
  tz: string;
}) {
  return (
    <>
      <div className="row-inline">
        <label>
          Kind
          <select name="kind" defaultValue={slot?.kind ?? "perform"}>
            {HOSTED_SLOT_KINDS.map((k) => (
              <option key={k} value={k}>
                {HOSTED_SLOT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          School
          <select name="hosted_school_id" defaultValue={slot?.hosted_school_id ?? ""}>
            <option value="">— none (break / awards / meal) —</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.school_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duration (min)
          <input
            type="number"
            name="duration_minutes"
            className="num"
            defaultValue={slot?.duration_minutes ?? ""}
          />
        </label>
      </div>
      <div className="row-inline">
        <label>
          Start time
          <input
            type="datetime-local"
            name="starts_at"
            defaultValue={toZonedInputValue(slot?.starts_at ?? null, tz)}
          />
        </label>
        <label>
          Label (optional)
          <input
            type="text"
            name="label"
            placeholder="Awards — daytime"
            defaultValue={slot?.label ?? ""}
          />
        </label>
      </div>
    </>
  );
}

// The "Generate schedule" form (start time + per-school warm-up/perform minutes).
function GenerateForm({
  programId,
  slug,
  eventId,
  tz,
  replace,
}: {
  programId: string;
  slug: string;
  eventId: string;
  tz: string;
  replace: boolean;
}) {
  return (
    <form action={generateHostedSchedule} className="stack">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="tz" value={tz} />
      {replace && <input type="hidden" name="replace" value="1" />}
      <div className="row-inline">
        <label>
          Start time
          <input type="datetime-local" name="starts_at" required />
        </label>
        <label>
          Warm-up (min)
          <input
            type="number"
            name="warmup_minutes"
            className="num"
            defaultValue={DEFAULT_WARMUP_MINUTES}
          />
        </label>
        <label>
          Perform (min)
          <input
            type="number"
            name="perform_minutes"
            className="num"
            defaultValue={DEFAULT_PERFORM_MINUTES}
          />
        </label>
      </div>
      <p className="muted">
        Lays a warm-up then perform slot for each school in order — the next school warms up as
        the last one takes the stage. Reorder or edit any slot afterward.
      </p>
      <button type="submit">{replace ? "Replace with generated schedule" : "Generate schedule"}</button>
    </form>
  );
}
