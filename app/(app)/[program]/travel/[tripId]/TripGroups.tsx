import Link from "next/link";
import {
  GROUP_KIND_LABEL,
  GROUP_KIND_LABEL_PLURAL,
  type TravelGroupKind,
} from "@/lib/travel";
import { createGroup, updateGroup, deleteGroup, unassignStudent } from "../actions";
import { studentName, type AssignmentRow, type GroupRow } from "./shared";

// One titled section per group kind — Buses, then Rooms (spec 005 US6). The
// section head carries its live summary, every card shows its capacity meter,
// and the only assignment affordance is "Fill this bus/room" (US5): tapping it
// makes the card the active target and the tap-chip queue at the top of the page
// takes over. Removing a rider stays inline, where the rider is.
//
// Mutations that are not the day job (rename, capacity, delete) sit in one
// labeled disclosure per card whose summary names the card and its count.
//
// Every form here posts ids only. The card's kind used to ride along so a failed
// save could come back into the right section; the actions resolve the group and
// read its kind off the row instead, which is the same routing without trusting
// a client-posted copy of a stored value.

export function GroupSection({
  kind,
  groups,
  membersByGroup,
  absent,
  canWrite,
  programId,
  slug,
  tripId,
  tripHref,
  fillGroupId,
  confirmDeleteGroupId,
  error,
  conflict,
}: {
  kind: TravelGroupKind;
  groups: GroupRow[];
  membersByGroup: Map<string, AssignmentRow[]>;
  absent: Set<string>;
  canWrite: boolean;
  programId: string;
  slug: string;
  tripId: string;
  tripHref: string;
  fillGroupId: string | null;
  confirmDeleteGroupId: string | null;
  error: string | null;
  conflict: string | null;
}) {
  const one = GROUP_KIND_LABEL[kind].toLowerCase();
  const anchor = kind === "room" ? "rooms" : "buses";
  const placed = groups.reduce(
    (n, g) => n + (membersByGroup.get(g.id)?.length ?? 0),
    0,
  );
  const summary =
    groups.length === 0
      ? `No ${GROUP_KIND_LABEL_PLURAL[kind].toLowerCase()} yet`
      : `${groups.length} ${
          groups.length === 1
            ? one
            : GROUP_KIND_LABEL_PLURAL[kind].toLowerCase()
        } · ${placed} placed`;

  return (
    <section id={anchor} className="travel-section stack">
      <div className="travel-section-head">
        <h2>{GROUP_KIND_LABEL_PLURAL[kind]}</h2>
        <span className="travel-section-summary">{summary}</span>
      </div>
      {conflict && <p className="alert-error">{conflict}</p>}
      {error && <p className="alert-error">{error}</p>}

      <div className="travel-group-grid">
        {groups.map((g) => {
          const members = (membersByGroup.get(g.id) ?? [])
            .slice()
            .sort((a, b) =>
              studentName(a.student ?? { first_name: "", last_name: "" })
                .localeCompare(
                  studentName(b.student ?? { first_name: "", last_name: "" }),
                ),
            );
          const count = members.length;
          const over = g.capacity != null && count > g.capacity;
          const isFillTarget = fillGroupId === g.id;
          const meter = `${count}${g.capacity != null ? ` / ${g.capacity}` : ""}${
            over ? " over" : ""
          }`;
          return (
            <div
              key={g.id}
              className={`travel-group-card stack${
                isFillTarget ? " is-target" : ""
              }${over ? " is-over" : ""}`}
            >
              <div className="travel-group-head">
                <strong>{g.label}</strong>
                <span className={over ? "chip danger" : "chip"}>{meter}</span>
              </div>
              {g.notes && <p className="muted">{g.notes}</p>}

              {/* The one assignment affordance (US5). Tapping it switches the
                  tap-chip queue and the sticky bar to this card; when it is
                  already the target, "Done" drops ?fill=. */}
              {canWrite &&
                (isFillTarget ? (
                  <Link
                    href={tripHref}
                    className="travel-fill-toggle is-active"
                  >
                    Filling this {one} — Done
                  </Link>
                ) : (
                  <Link
                    href={`${tripHref}?fill=${g.id}`}
                    className="travel-fill-toggle"
                  >
                    Fill this {one}
                  </Link>
                ))}

              <ul className="travel-member-list">
                {members.map((a) => (
                  <li
                    key={a.id}
                    className={
                      absent.has(a.student_id)
                        ? "travel-member-row is-absent"
                        : "travel-member-row"
                    }
                  >
                    {/* Name and badge are siblings, not nested: the "absent"
                        dim applies to the name alone, so the danger chip keeps
                        its full contrast. */}
                    <span className="travel-member-who">
                      <span className="travel-member-name">
                        {a.student ? studentName(a.student) : "?"}
                      </span>
                      {absent.has(a.student_id) && (
                        <span className="chip danger">absent</span>
                      )}
                    </span>
                    {canWrite && (
                      <form action={unassignStudent}>
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="tripId" value={tripId} />
                        <input type="hidden" name="assignmentId" value={a.id} />
                        {/* Taking someone off mid-fill keeps the fill target up
                            instead of ending the flow. */}
                        {fillGroupId && (
                          <input type="hidden" name="fill" value={fillGroupId} />
                        )}
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
                {members.length === 0 && <li className="muted">Empty</li>}
              </ul>

              {canWrite && (
                <details open={confirmDeleteGroupId === g.id}>
                  <summary className="travel-disclosure">
                    Edit or delete {g.label} · {meter}
                  </summary>
                  <form
                    action={updateGroup}
                    className="stack"
                    style={{ gap: "0.35rem", marginTop: "0.5rem" }}
                  >
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="groupId" value={g.id} />
                    <label>
                      Name
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
                  {confirmDeleteGroupId === g.id ? (
                    <div
                      className="confirm-box stack"
                      style={{ marginTop: "0.5rem" }}
                    >
                      <p>
                        Delete {g.label}? Its rider assignments and chaperones
                        are removed too.
                      </p>
                      <form action={deleteGroup} className="row-inline">
                        <input
                          type="hidden"
                          name="programId"
                          value={programId}
                        />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="tripId" value={tripId} />
                        <input type="hidden" name="groupId" value={g.id} />
                        <button type="submit" className="danger">
                          Confirm delete
                        </button>
                        <Link href={tripHref}>Cancel</Link>
                      </form>
                    </div>
                  ) : (
                    <p style={{ marginTop: "0.5rem" }}>
                      <Link
                        className="linklike danger"
                        href={`${tripHref}?confirm=deletegroup&groupId=${g.id}`}
                      >
                        Delete this {one} (and its assignments)
                      </Link>
                    </p>
                  )}
                </details>
              )}
            </div>
          );
        })}
      </div>

      {canWrite && (
        <form action={createGroup} className="row-inline">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="kind" value={kind} />
          <label>
            Add {one}
            <input
              type="text"
              name="label"
              required
              placeholder={kind === "room" ? "Room 214" : "Bus 1"}
            />
          </label>
          <label>
            Capacity
            <input type="number" name="capacity" className="num" min={0} />
          </label>
          <button type="submit" className="secondary">
            Add
          </button>
        </form>
      )}
    </section>
  );
}
