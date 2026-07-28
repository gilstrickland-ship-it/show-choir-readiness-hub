import Link from "next/link";
import { MEMBER_ROLES, MEMBER_ROLE_LABELS } from "@/lib/roster/ensembles";
import { addMember } from "../actions";

// "+ Add member" as a drawer off the page head, the same affordance every other
// list uses. The empty states stay on the page rather than inside the drawer:
// "there is nobody left to add" is something you need to see without opening
// anything.

export function AddMember({
  programId,
  slug,
  ensembleId,
  seasonId,
  addable,
  open,
  error,
}: {
  programId: string;
  slug: string;
  ensembleId: string;
  seasonId: string;
  addable: { id: string; first_name: string; last_name: string }[];
  // A rejected add reopens the drawer with its message inside (the Wave-1
  // drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add member</summary>
      <div className="drawer-panel" id="add-member">
        <h2 className="drawer-title">Add a member</h2>
        {error && <p className="alert-error">{error}</p>}
        {addable.length === 0 ? (
          <p className="muted">
            Every active student is already in this ensemble. Add more students on
            the <Link href={`/${slug}/roster`}>roster</Link> first.
          </p>
        ) : (
          <form action={addMember} className="stack">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="ensembleId" value={ensembleId} />
            <input type="hidden" name="seasonId" value={seasonId} />
            <label>
              Student
              <select name="studentId" required>
                {addable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name}, {s.first_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What they do here
              <select name="role" defaultValue="performer">
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {MEMBER_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Voice part
              <input
                type="text"
                name="voice_part"
                placeholder="Soprano 1, Tenor, …"
              />
            </label>
            <p className="muted">
              A student can be in more than one ensemble in the same season.
            </p>
            <button type="submit">Add to ensemble</button>
          </form>
        )}
      </div>
    </details>
  );
}
