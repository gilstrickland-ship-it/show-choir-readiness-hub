import type { PageFlash } from "@/lib/flash";
import { Flash } from "../../Flash";
import type { HostSection } from "./shared";
import { formatTimeInTz } from "@/lib/datetime";
import { groupItemsByDay } from "@/lib/itinerary-days";
import {
  DEFAULT_WARMUP_MINUTES,
  DEFAULT_PERFORM_MINUTES,
  type HostedSchoolRow,
  type HostedSlotRow,
} from "@/lib/hosting";
import { addHostedSlot, generateHostedSchedule } from "../actions";
import { SlotRow, SlotFields } from "./SlotRow";

// The day's schedule (spec 005 US11). The rows were already visible; what was
// not was the hierarchy between the three things a host does to them. "Generate
// schedule", "Add a slot" and each row's "Edit" were three identical unlabeled
// triangles, so the one action that builds the whole day looked exactly like the
// one that adds a single break.
//
// Generating IS the primary act here — the ladder comes from the schools list,
// which is the section above — so it is a primary button whose options open
// underneath it, and adding a slot by hand is the quiet disclosure below.
//
// The generator itself is untouched: the same deterministic warm-up/perform
// ladder (lib/hosting.generateHostSchedule) with the same fields and defaults,
// and the same "replaces everything" contract when a schedule already exists —
// which is now stated inside the panel, next to a button that names it, instead
// of behind a separate ?confirm= round-trip.

export function ScheduleSection({
  programId,
  slug,
  eventId,
  eventBase,
  tz,
  slots,
  schools,
  eventMultiDay,
  canWrite,
  open,
  confirmDeleteId,
  flash,
}: {
  programId: string;
  slug: string;
  eventId: string;
  eventBase: string;
  tz: string;
  slots: HostedSlotRow[];
  schools: HostedSchoolRow[];
  eventMultiDay: boolean;
  canWrite: boolean;
  // `?open=` addresses one slot by id, the add form ("slot"), or the generator
  // ("generate").
  open: string | null;
  confirmDeleteId: string | null;
  flash: PageFlash<HostSection>;
}) {
  const schoolName = new Map(schools.map((s) => [s.id, s.school_name]));

  // Group the schedule under day headers only when the slots themselves span
  // more than one program-tz calendar day (Wave N) — the same threshold as the
  // itinerary editor. A single-day schedule renders flat, exactly as before.
  const slotDays = groupItemsByDay(slots, tz, (s) => s.starts_at);

  // Live section state: how many slots, and the window they cover. The rows are
  // already ordered by starts_at with untimed ones last, so the first and last
  // timed rows are the ends of the day.
  const timed = slots.filter((s) => s.starts_at);
  const parts = [`${slots.length} slot${slots.length === 1 ? "" : "s"}`];
  if (slotDays.multiDay) {
    parts.push(`${slotDays.groups.length} days`);
  } else if (timed.length > 0) {
    parts.push(
      `${formatTimeInTz(timed[0].starts_at!, tz)} – ${formatTimeInTz(
        timed[timed.length - 1].starts_at!,
        tz,
      )}`,
    );
  }
  const summary = slots.length === 0 ? "Nothing scheduled yet" : parts.join(" · ");

  const renderSlot = (slot: HostedSlotRow) => (
    <SlotRow
      key={slot.id}
      programId={programId}
      slug={slug}
      eventId={eventId}
      eventBase={eventBase}
      tz={tz}
      slot={slot}
      schools={schools}
      schoolLabel={
        slot.hosted_school_id
          ? (schoolName.get(slot.hosted_school_id) ?? null)
          : null
      }
      eventMultiDay={eventMultiDay}
      canWrite={canWrite}
      open={open === slot.id || confirmDeleteId === slot.id}
      confirmDelete={confirmDeleteId === slot.id}
    />
  );

  return (
    <section className="comp-section" id="schedule">
      <div className="comp-section-head">
        <h2>Schedule</h2>
        <span className="comp-section-summary">{summary}</span>
      </div>
      <Flash flash={flash} section="schedule" />

      {slots.length === 0 ? (
        <p className="muted">
          {canWrite
            ? "No schedule yet. Generate one from your schools, then edit any slot by hand."
            : "No schedule yet."}
        </p>
      ) : slotDays.multiDay ? (
        slotDays.groups.map((g) => (
          <div className="stack" key={g.key || "untimed"}>
            <h3 className="itinerary-day-heading">{g.label}</h3>
            {g.items.map(renderSlot)}
          </div>
        ))
      ) : (
        <div className="stack">{slots.map(renderSlot)}</div>
      )}

      {canWrite && (
        <>
          <details className="stack" open={open === "generate"}>
            <summary className="button-link accent">
              {slots.length > 0
                ? "Regenerate the schedule"
                : "Generate the schedule"}
            </summary>
            <div className="stack hosting-panel">
              {slots.length > 0 && (
                <p className="alert-error">
                  This replaces the whole schedule
                  {slotDays.multiDay ? ", all days" : ""} — the current{" "}
                  {slots.length} slot{slots.length === 1 ? "" : "s"} are deleted
                  first, including anything you edited by hand.
                </p>
              )}
              <form action={generateHostedSchedule} className="stack">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="tz" value={tz} />
                {slots.length > 0 && (
                  <input type="hidden" name="replace" value="1" />
                )}
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
                  Lays a warm-up then a perform slot for each of your{" "}
                  {schools.length} school
                  {schools.length === 1 ? "" : "s"}, in the order they are listed
                  above. The longer of the two durations sets how far apart
                  schools run, so no two performances overlap. Reorder or edit
                  any slot afterward.
                </p>
                {eventMultiDay && (
                  <p className="muted">
                    Generate seeds one day at a time — set the start time for
                    each day and add the second day&apos;s slots by hand, or
                    regenerate per day as you plan.
                  </p>
                )}
                <button
                  type="submit"
                  className={slots.length > 0 ? "danger" : undefined}
                >
                  {slots.length > 0
                    ? `Replace all ${slots.length} slots`
                    : "Generate schedule"}
                </button>
              </form>
            </div>
          </details>

          <details className="stack" open={open === "slot"}>
            <summary className="comp-disclosure">
              Add a slot by hand —{" "}
              {slots.length === 0
                ? "nothing scheduled yet"
                : `${slots.length} in the schedule`}
            </summary>
            <form action={addHostedSlot} className="stack hosting-panel">
              <input type="hidden" name="programId" value={programId} />
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
  );
}
