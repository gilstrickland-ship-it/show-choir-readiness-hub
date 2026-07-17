import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import { COSTUME_WRITE_ROLES, NO_HEALTH_LABEL } from "@/lib/costumes";
import { CostumeTabs } from "../CostumeTabs";
import { addSet, updateSet, deleteSet } from "../actions";

// Costume sets (T009) — season-scoped groupings ("Opener", "Ballad"). Name,
// sort_order, notes, and an optional ensemble (the ensemble drives the
// assignment grid + checkout eligibility). Pieces are attached to a set on its
// detail page (set_id re-pointing, §4).

interface SetRow {
  id: string;
  ensemble_id: string | null;
  name: string;
  sort_order: number;
  notes: string | null;
}

export default async function CostumeSetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) notFound();
  const canWrite = COSTUME_WRITE_ROLES.includes(role);
  const { saved, error } = await searchParams;

  const supabase = await createClient();

  const { data: ensembleData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const ensembles = (ensembleData as { id: string; name: string }[] | null) ?? [];
  const ensembleName = new Map(ensembles.map((e) => [e.id, e.name]));

  // Sets are season-scoped — show the active season's sets. Piece counts per set.
  let sets: SetRow[] = [];
  const pieceCount = new Map<string, number>();
  if (season) {
    const { data: setData } = await supabase
      .from("costume_sets")
      .select("id, ensemble_id, name, sort_order, notes")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    sets = (setData as SetRow[] | null) ?? [];

    if (sets.length > 0) {
      const { data: pieceData } = await supabase
        .from("costume_pieces")
        .select("set_id")
        .eq("program_id", program.id)
        .in("set_id", sets.map((s) => s.id));
      for (const p of (pieceData as { set_id: string | null }[] | null) ?? []) {
        if (p.set_id) pieceCount.set(p.set_id, (pieceCount.get(p.set_id) ?? 0) + 1);
      }
    }
  }

  return (
    <section className="stack">
      <CostumeTabs slug={slug} active="sets" />
      <h1>Sets</h1>
      {!season && (
        <p className="muted">
          No active season — sets are season-scoped. Set a season active in
          Settings to build this season&apos;s sets.
        </p>
      )}
      {season && <p className="muted">Season: {season.label}</p>}

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "set" && <p className="alert-error">A set needs a name.</p>}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {error === "in_use" && (
        <p className="alert-error">
          Can&apos;t delete a set that still groups pieces. Detach its pieces first.
        </p>
      )}

      {season && (
        <table className="members">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sort</th>
              <th>Ensemble</th>
              <th>Pieces</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.id}>
                {canWrite ? (
                  <>
                    <td colSpan={3}>
                      <form action={updateSet} className="row-inline">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="setId" value={s.id} />
                        <input
                          type="text"
                          name="name"
                          defaultValue={s.name}
                          required
                          aria-label="Set name"
                        />
                        <input
                          type="number"
                          name="sort_order"
                          defaultValue={s.sort_order}
                          aria-label="Sort order"
                          className="num"
                        />
                        <select
                          name="ensemble_id"
                          defaultValue={s.ensemble_id ?? ""}
                          aria-label="Ensemble"
                        >
                          <option value="">(no ensemble)</option>
                          {ensembles.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          name="notes"
                          defaultValue={s.notes ?? ""}
                          placeholder="Notes"
                          aria-label="Notes"
                        />
                        <button type="submit" className="secondary">
                          Save
                        </button>
                      </form>
                    </td>
                    <td>
                      <Link href={`/${slug}/costumes/sets/${s.id}`}>
                        {pieceCount.get(s.id) ?? 0} — pieces
                      </Link>
                    </td>
                    <td>
                      <form action={deleteSet}>
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="setId" value={s.id} />
                        <button type="submit" className="linklike danger">
                          Delete
                        </button>
                      </form>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{s.name}</td>
                    <td>{s.sort_order}</td>
                    <td>{s.ensemble_id ? (ensembleName.get(s.ensemble_id) ?? "—") : "—"}</td>
                    <td>{pieceCount.get(s.id) ?? 0}</td>
                  </>
                )}
              </tr>
            ))}
            {sets.length === 0 && (
              <tr>
                <td colSpan={canWrite ? 5 : 4} className="muted">
                  No sets yet this season.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {season && canWrite && (
        <>
          <h2>Add a set</h2>
          <form action={addSet} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" required placeholder="Opener, Ballad" />
              </label>
              <label>
                Sort order
                <input type="number" name="sort_order" defaultValue={0} className="num" />
              </label>
              <label>
                Ensemble
                <select name="ensemble_id" defaultValue="">
                  <option value="">(no ensemble)</option>
                  {ensembles.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Notes
                <input type="text" name="notes" />
              </label>
            </div>
            <p className="muted">{NO_HEALTH_LABEL}</p>
            <button type="submit">Add set</button>
          </form>
        </>
      )}
    </section>
  );
}
