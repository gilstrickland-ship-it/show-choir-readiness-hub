import { GROUP_KIND_LABEL } from "@/lib/travel";
import { addChaperone, removeChaperone } from "../actions";
import type { ChaperoneRow, GroupRow } from "./shared";

// Who is riding along, in one place (spec 005 US6). Chaperones belong to a bus
// or a room, so this section lists every group with the adults on it — visible,
// no opening required — and the ratio line beside it. Only the mutations (add,
// remove) sit behind a labeled disclosure, whose summary names the group and its
// current count.
//
// The ratio is informational, never a warning: programs' policies vary (common
// guidance is around 1:10 for day trips), so this states the number rather than
// judging it.

export function ChaperoneSection({
  groups,
  chaperonesByGroup,
  riderCount,
  guardians,
  guardianName,
  canWrite,
  programId,
  slug,
  tripId,
  error,
}: {
  groups: GroupRow[];
  chaperonesByGroup: Map<string, ChaperoneRow[]>;
  riderCount: Map<string, number>;
  guardians: { id: string; name: string; student: { last_name: string } | null }[];
  guardianName: Map<string, string>;
  canWrite: boolean;
  programId: string;
  slug: string;
  tripId: string;
  error: string | null;
}) {
  const total = groups.reduce(
    (n, g) => n + (chaperonesByGroup.get(g.id)?.length ?? 0),
    0,
  );
  const nameOf = (c: ChaperoneRow): string =>
    c.guardian_id
      ? (guardianName.get(c.guardian_id) ?? c.guardian?.name ?? "?")
      : (c.name_override ?? "?");

  return (
    <section id="chaperones" className="travel-section stack">
      <div className="travel-section-head">
        <h2>Chaperones</h2>
        <span className="travel-section-summary">
          {total === 0
            ? "None assigned yet"
            : `${total} assigned${
                groups.length > 0 ? ` across ${groups.length} groups` : ""
              }`}
        </span>
      </div>
      {error && <p className="alert-error">{error}</p>}

      {groups.length === 0 ? (
        <p className="muted">
          A chaperone rides with a bus or a room — add one of those first.
        </p>
      ) : (
        groups.map((g) => {
          const chaps = chaperonesByGroup.get(g.id) ?? [];
          const riders = riderCount.get(g.id) ?? 0;
          const perAdult = chaps.length > 0 ? Math.ceil(riders / chaps.length) : 0;
          return (
            <div key={g.id} className="travel-chaperone-row stack">
              <div className="travel-group-head">
                <strong>
                  {g.label}{" "}
                  <span className="muted">
                    {GROUP_KIND_LABEL[g.kind].toLowerCase()}
                  </span>
                </strong>
                {riders > 0 && (
                  <span className="travel-section-summary">
                    {chaps.length > 0
                      ? `1 chaperone per ${perAdult} student${
                          perAdult === 1 ? "" : "s"
                        }`
                      : "No chaperone assigned yet"}
                  </span>
                )}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {chaps.length > 0
                  ? chaps.map(nameOf).join(" · ")
                  : "Nobody yet"}
              </p>

              {canWrite && (
                <details>
                  <summary className="travel-disclosure">
                    Change who&apos;s on {g.label} · {chaps.length} assigned
                  </summary>
                  <div className="stack" style={{ marginTop: "0.5rem" }}>
                    {chaps.map((c) => (
                      <div key={c.id} className="travel-member-row">
                        <span>{nameOf(c)}</span>
                        <form action={removeChaperone}>
                          <input
                            type="hidden"
                            name="programId"
                            value={programId}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="tripId" value={tripId} />
                          <input type="hidden" name="chaperoneId" value={c.id} />
                          <button
                            type="submit"
                            className="linklike danger"
                            aria-label={`Remove ${nameOf(c)} from ${g.label}`}
                          >
                            remove
                          </button>
                        </form>
                      </div>
                    ))}
                    <form
                      action={addChaperone}
                      className="stack"
                      style={{ gap: "0.35rem" }}
                    >
                      <input type="hidden" name="programId" value={programId} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="tripId" value={tripId} />
                      <input type="hidden" name="travelGroupId" value={g.id} />
                      <select
                        name="guardian_id"
                        defaultValue=""
                        aria-label={`Chaperone for ${g.label} — pick a guardian`}
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
                        aria-label={`Chaperone for ${g.label} — or type a one-off helper's name`}
                      />
                      <button type="submit" className="secondary">
                        Add chaperone
                      </button>
                    </form>
                  </div>
                </details>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
