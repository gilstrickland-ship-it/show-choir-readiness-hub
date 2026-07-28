import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { SubTabs } from "../../SubTabs";
import { rosterTabs } from "@/lib/subnav";
import { AddEnsemble } from "./AddEnsemble";
import { EnsembleRow, type EnsembleListRow } from "./EnsembleRow";

// Ensembles list + CRUD (T007). Ensembles are program-scoped; per-ensemble
// season membership is managed on the detail page.
//
// Wave 6 gave it the idioms every other list already had: "+ Add ensemble" is a
// drawer off the page head instead of a permanent form under the table, and the
// name / order / delete moved into a row-local Edit panel instead of sitting
// open in the row with Delete a tab-stop away.

// Messages the page owns — the add drawer, and a row that vanished under us.
const ERR: Record<string, string> = {
  name: "An ensemble needs a name.",
  save: "Couldn't save. Try again.",
  gone: "That ensemble is no longer in this program. Reload the page and try again.",
};

// Messages that belong to ONE row. They arrive with `?edit=<ensembleId>`, which
// is also what reopens that row's panel.
const ROW_ERR: Record<string, string> = {
  name: "An ensemble needs a name.",
  save: "Couldn't save. Try again.",
  in_use:
    "This ensemble still has members, costume sets, or competitions pointing at it. Clear those first, then delete it.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function EnsemblesPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?edit=a&edit=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();
  const { data } = await supabase
    .from("ensembles")
    .select("id, name, sort_order")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const ensembles = (data as EnsembleListRow[] | null) ?? [];

  // Member counts for the active season, per ensemble.
  const countByEnsemble = new Map<string, number>();
  if (season) {
    const { data: members } = await supabase
      .from("ensemble_members")
      .select("ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id);
    for (const m of (members as { ensemble_id: string }[] | null) ?? []) {
      countByEnsemble.set(m.ensemble_id, (countByEnsemble.get(m.ensemble_id) ?? 0) + 1);
    }
  }

  const errorCode = one("error");
  const openId = canWrite ? one("edit") : null;
  const rowError = openId ? message(ROW_ERR, errorCode) : null;
  const pageError = openId ? null : message(ERR, errorCode);
  const addOpen = canWrite && !openId && (errorCode === "name" || errorCode === "save");
  const confirmDeleteId = one("confirm") === "delete" ? openId : null;

  const placed = season
    ? Array.from(countByEnsemble.values()).reduce((a, b) => a + b, 0)
    : 0;
  const eyebrow = [
    `${ensembles.length} ensemble${ensembles.length === 1 ? "" : "s"}`,
    season ? `${placed} placement${placed === 1 ? "" : "s"} in ${season.label}` : "No active season",
  ].join(" · ");

  return (
    <section className="stack people">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Ensembles</h1>
        </div>
        {canWrite && (
          <div className="page-head-actions">
            <AddEnsemble
              programId={program.id}
              slug={slug}
              open={addOpen}
              error={addOpen ? message(ERR, errorCode) : null}
            />
          </div>
        )}
      </div>

      <SubTabs strip={rosterTabs(slug, "ensembles", canWrite)} />

      {!season && (
        <p className="muted">
          No active season, so nobody can be placed in a group yet. The groups
          themselves belong to the program and carry across seasons.
        </p>
      )}

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {pageError && <p className="alert-error">{pageError}</p>}

      <table className="members">
        <thead>
          <tr>
            <th>Ensemble</th>
            <th>Members</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {ensembles.map((e) => (
            <EnsembleRow
              key={e.id}
              programId={program.id}
              slug={slug}
              ensemble={e}
              memberCount={season ? (countByEnsemble.get(e.id) ?? 0) : null}
              seasonLabel={season?.label ?? null}
              canWrite={canWrite}
              open={openId === e.id}
              confirmDelete={confirmDeleteId === e.id}
              error={openId === e.id ? rowError : null}
            />
          ))}
          {ensembles.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 3 : 2} className="muted">
                No ensembles yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="page-foot">
        An ensemble is a group that performs together — Varsity Mixed, Prep,
        Crew. Open one to set who is in it this season.
      </p>
    </section>
  );
}
