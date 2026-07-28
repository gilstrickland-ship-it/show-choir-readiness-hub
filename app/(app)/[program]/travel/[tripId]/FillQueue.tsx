import Link from "next/link";
import { GROUP_KIND_LABEL, type TravelGroupKind } from "@/lib/travel";
import { assignStudent } from "../actions";
import type { GroupRow } from "./shared";

// The one way to load a bus or a room (spec 005 US5). Pick a group — "Fill this
// bus" on its card — and `?fill=<groupId>` makes it the active target: everyone
// who still needs that kind becomes a big tap-chip here, one tap places a rider,
// and the page re-renders from server data with the sticky bar below still up.
// There is no second model: the unassigned list is read-only status.
//
// The chip list offers only riders who still need THIS group's kind, so a tap
// can never trip the one-room-one-bus guard. Counts re-derive from the
// assignments query every render (no client state that can lie). The chip posts
// ids and nothing else: assignStudent resolves the group (and reads its kind off
// the row) and re-checks the student's eligibility server-side, because a list
// the page chose to render is not a constraint on what can be posted.

export interface FillChip {
  id: string;
  name: string;
  absent: boolean;
  needs: readonly TravelGroupKind[];
}

export function FillQueue({
  group,
  chips,
  programId,
  slug,
  tripId,
}: {
  group: GroupRow;
  chips: FillChip[];
  programId: string;
  slug: string;
  tripId: string;
}) {
  return (
    <section className="travel-fill-queue stack">
      <h2>Tap a name to add to {group.label}</h2>
      {chips.length === 0 ? (
        <p className="alert-ok">
          Nobody left to add — everyone eligible already has a{" "}
          {GROUP_KIND_LABEL[group.kind].toLowerCase()}.
        </p>
      ) : (
        <div className="travel-chip-grid">
          {chips.map((s) => (
            <form key={s.id} action={assignStudent} className="travel-chip-form">
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="tripId" value={tripId} />
              <input type="hidden" name="travelGroupId" value={group.id} />
              <input type="hidden" name="studentId" value={s.id} />
              <input type="hidden" name="fill" value={group.id} />
              <button
                type="submit"
                className={s.absent ? "travel-chip is-absent" : "travel-chip"}
                aria-label={`Add ${s.name} to ${group.label}`}
              >
                <span className="travel-chip-name">{s.name}</span>
                <span className="travel-chip-badges">
                  {s.absent && <span className="chip danger">absent</span>}
                  {s.needs.map((k) => (
                    <span key={k} className="chip">
                      needs {GROUP_KIND_LABEL[k].toLowerCase()}
                    </span>
                  ))}
                </span>
              </button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}

// The sticky target bar — pinned to the viewport bottom while a group is being
// filled, styled like the mobile tab bar. Count/capacity re-derive from server
// data every render; over-capacity warns, never blocks. "Done" is a real link
// that drops ?fill= and returns to browsing.
export function FillBar({
  group,
  count,
  over,
  tripHref,
}: {
  group: GroupRow;
  count: number;
  over: boolean;
  tripHref: string;
}) {
  return (
    <div className="travel-fill-bar">
      <span className="travel-fill-bar-label">
        Filling <strong>{group.label}</strong>
        <span className={over ? "chip danger" : "chip"}>
          {count}
          {group.capacity != null ? ` / ${group.capacity}` : ""}
          {over ? " over" : ""}
        </span>
      </span>
      <Link href={tripHref} className="travel-fill-bar-done">
        Done
      </Link>
    </div>
  );
}
