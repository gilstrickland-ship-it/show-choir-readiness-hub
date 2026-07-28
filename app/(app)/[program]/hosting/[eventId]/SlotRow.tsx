import Link from "next/link";
import { formatTimeInTz, toZonedInputValue } from "@/lib/datetime";
import {
  HOSTED_SLOT_KINDS,
  HOSTED_SLOT_KIND_LABELS,
  type HostedSchoolRow,
  type HostedSlotRow,
} from "@/lib/hosting";
import {
  updateHostedSlot,
  removeHostedSlot,
  shiftRemainingSlots,
} from "../actions";

// One schedule row — shared by the flat and day-grouped layouts, so the day
// headers wrap identical rows. `.hosting-slot-actions` is `flex-basis: 100%`,
// which is what keeps this panel a full-width line UNDER the row rather than a
// column of it: the Wave-4/6 lesson about panels that open inside a horizontal
// scroller applies to any narrow last cell, and a schedule row on a 375px phone
// is exactly that.
export function SlotRow({
  programId,
  slug,
  eventId,
  eventBase,
  tz,
  slot,
  schools,
  schoolLabel,
  eventMultiDay,
  canWrite,
  open,
  confirmDelete,
}: {
  programId: string;
  slug: string;
  eventId: string;
  eventBase: string;
  tz: string;
  slot: HostedSlotRow;
  schools: HostedSchoolRow[];
  schoolLabel: string | null;
  eventMultiDay: boolean;
  canWrite: boolean;
  open: boolean;
  confirmDelete: boolean;
}) {
  const title =
    slot.label ?? schoolLabel ?? HOSTED_SLOT_KIND_LABELS[slot.kind];

  return (
    <div className="hosting-slot-row">
      <span className="hosting-slot-time">
        {slot.starts_at ? formatTimeInTz(slot.starts_at, tz) : "—"}
      </span>
      <span className="kind-tag hosting">
        {HOSTED_SLOT_KIND_LABELS[slot.kind]}
      </span>
      <span className="hosting-slot-body">
        <strong>{title}</strong>
        {slot.duration_minutes != null && (
          <span className="muted"> · {slot.duration_minutes} min</span>
        )}
      </span>
      {canWrite && (
        <div className="hosting-slot-actions">
          <details open={open}>
            <summary className="comp-disclosure" aria-label={`Edit ${title}`}>
              Edit
            </summary>
            <div className="stack hosting-panel">
              <form action={updateHostedSlot} className="stack">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="slotId" value={slot.id} />
                <input type="hidden" name="tz" value={tz} />
                <SlotFields slot={slot} schools={schools} tz={tz} />
                <button type="submit" className="secondary">
                  Save slot
                </button>
              </form>

              {/* Running behind: move this slot and every later slot that day. */}
              <form action={shiftRemainingSlots} className="stack">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="slotId" value={slot.id} />
                <input type="hidden" name="tz" value={tz} />
                <div className="row-inline hosting-shift">
                  <label>
                    Running behind? Shift this and later slots by (min)
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
                </div>
                <p className="muted">
                  {eventMultiDay
                    ? "Moves this slot and every later slot that day — the next day stays put."
                    : "Moves this slot and every later slot. A negative number pulls them earlier."}
                </p>
              </form>

              {confirmDelete ? (
                <div className="confirm-box stack">
                  <p>Delete this slot? It comes off the schedule.</p>
                  <div className="row-inline">
                    <form action={removeHostedSlot}>
                      <input type="hidden" name="programId" value={programId} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="slotId" value={slot.id} />
                      <button type="submit" className="danger">
                        Confirm delete
                      </button>
                    </form>
                    <Link href={`${eventBase}?open=${slot.id}#schedule`}>
                      Keep it
                    </Link>
                  </div>
                </div>
              ) : (
                <p>
                  <Link
                    className="linklike danger"
                    href={`${eventBase}?confirm=deleteslot&open=${slot.id}#schedule`}
                  >
                    Delete this slot…
                  </Link>
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// The editable slot fieldset, shared by add and edit. Both forms post every
// field they show, so an emptied one clears.
export function SlotFields({
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
          <select
            name="hosted_school_id"
            defaultValue={slot?.hosted_school_id ?? ""}
          >
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
