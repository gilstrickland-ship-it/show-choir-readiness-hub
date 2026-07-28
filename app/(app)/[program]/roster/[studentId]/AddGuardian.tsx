import { addGuardian } from "../actions";

// Adding a guardian is a drawer off the Guardians heading (spec 005 T137a), the
// same affordance People, Money, Wardrobe and Comms use for "+ Add": the section
// stays a list of the family you already have, and the form that adds to it
// opens over that list instead of parking a permanent four-input block under it.

export function AddGuardian({
  programId,
  slug,
  studentId,
  open,
  error,
}: {
  programId: string;
  slug: string;
  studentId: string;
  // A rejected create reopens the drawer with its message inside, so the typing
  // is still on screen next to the reason (the Wave-1 drawer contract).
  open: boolean;
  error: string | null;
}) {
  return (
    <details className="drawer" open={open}>
      <summary className="button-link accent">+ Add guardian</summary>
      <div className="drawer-panel" id="add-guardian">
        <h3 className="drawer-title">Add a guardian</h3>
        {error && <p className="alert-error">{error}</p>}
        <form action={addGuardian} className="stack">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="studentId" value={studentId} />
          <label>
            Name
            <input type="text" name="name" required />
          </label>
          <label>
            Email
            <input type="email" name="email" />
          </label>
          <p className="muted">
            The email is how this family gets their links and every announcement.
            A guardian without one can still be on the list, but nothing reaches
            them.
          </p>
          <label>
            Phone
            <input type="tel" name="phone" />
          </label>
          <label>
            Relationship
            <input
              type="text"
              name="relationship"
              placeholder="Mother, Father, …"
            />
          </label>
          <button type="submit">Add guardian</button>
        </form>
      </div>
    </details>
  );
}
