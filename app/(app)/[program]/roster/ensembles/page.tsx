import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "../RosterTabs";
import { addEnsemble, updateEnsemble, deleteEnsemble } from "./actions";

// Ensembles list + CRUD (T007). Ensembles are program-scoped; per-ensemble
// season membership is managed on the detail page.
interface EnsembleRow {
  id: string;
  name: string;
  sort_order: number;
}

export default async function EnsemblesPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);
  const { saved, error } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase
    .from("ensembles")
    .select("id, name, sort_order")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const ensembles = (data as EnsembleRow[] | null) ?? [];

  // Member counts for the active season, per ensemble.
  const countBySeasonEnsemble = new Map<string, number>();
  if (season) {
    const { data: members } = await supabase
      .from("ensemble_members")
      .select("ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id);
    for (const m of (members as { ensemble_id: string }[] | null) ?? []) {
      countBySeasonEnsemble.set(
        m.ensemble_id,
        (countBySeasonEnsemble.get(m.ensemble_id) ?? 0) + 1,
      );
    }
  }

  return (
    <section className="stack">
      <RosterTabs slug={slug} active="ensembles" canWrite={canWrite} />
      <h1>Ensembles</h1>
      {!season && (
        <p className="muted">
          No active season — set one active in Settings to manage membership.
        </p>
      )}

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "name" && <p className="alert-error">An ensemble needs a name.</p>}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {error === "in_use" && (
        <p className="alert-error">
          Can&apos;t delete an ensemble that still has members, costume sets, or
          competitions. Remove those first.
        </p>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Sort</th>
            {season && <th>Members ({season.label})</th>}
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {ensembles.map((e) => (
            <tr key={e.id}>
              {canWrite ? (
                <>
                  <td colSpan={2}>
                    <form action={updateEnsemble} className="row-inline">
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="ensembleId" value={e.id} />
                      <input
                        type="text"
                        name="name"
                        defaultValue={e.name}
                        required
                        aria-label="Ensemble name"
                      />
                      <input
                        type="number"
                        name="sort_order"
                        defaultValue={e.sort_order}
                        aria-label="Sort order"
                        className="num"
                      />
                      <button type="submit" className="secondary">
                        Save
                      </button>
                    </form>
                  </td>
                  {season && (
                    <td>
                      <Link href={`/${slug}/roster/ensembles/${e.id}`}>
                        {countBySeasonEnsemble.get(e.id) ?? 0} — manage
                      </Link>
                    </td>
                  )}
                  <td>
                    <form action={deleteEnsemble}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="ensembleId" value={e.id} />
                      <button type="submit" className="linklike danger">
                        Delete
                      </button>
                    </form>
                  </td>
                </>
              ) : (
                <>
                  <td>{e.name}</td>
                  <td>{e.sort_order}</td>
                  {season && <td>{countBySeasonEnsemble.get(e.id) ?? 0}</td>}
                </>
              )}
            </tr>
          ))}
          {ensembles.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 4 : 3} className="muted">
                No ensembles yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h2>Add an ensemble</h2>
          <form action={addEnsemble} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" required placeholder="Varsity Mixed" />
              </label>
              <label>
                Sort order
                <input type="number" name="sort_order" defaultValue={0} className="num" />
              </label>
            </div>
            <button type="submit">Add ensemble</button>
          </form>
        </>
      )}
    </section>
  );
}
