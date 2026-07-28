import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KIND_LABELS,
  isDirectKind,
  type PieceKind,
} from "@/lib/costumes";
import { SubTabs } from "../../SubTabs";
import { costumeTabs } from "@/lib/subnav";
import { AddSet } from "./AddSet";
import { SetSettings } from "./SetSettings";
import {
  AssignmentRow,
  type AssignablePiece,
  type EligibleStudent,
  type PieceAssignment,
} from "./AssignmentRow";

// Assignments — who wears what, one set at a time. Sets used to be a tab of
// their own; a set is just the grouping assignments hang off, so making,
// renaming and deleting one lives here now, next to the grid it opens (spec 005
// US13). One piece → one student per season (UNIQUE(season_id, piece_id)).
// Props and set pieces skip student assignment and go straight to checkout (§4).

interface SetRow {
  id: string;
  name: string;
  ensemble_id: string | null;
  sort_order: number;
  notes: string | null;
}

// Messages the page owns — the add drawer, which belongs to no set.
const ERR: Record<string, string> = {
  name: "A set needs a name.",
  season: "Activate a season before adding sets.",
  ensemble:
    "That ensemble isn't part of this program. Reload the page and pick one from the list.",
  save: "Couldn't save. Try again.",
};

// Messages that belong to the set-settings disclosure (`?edit=set`).
const SET_ERR: Record<string, string> = {
  name: "A set needs a name.",
  ensemble:
    "That ensemble isn't part of this program. Reload the page and pick one from the list.",
  set: "That set isn't part of this program. Reload the page and try again.",
  in_use:
    "Can't delete a set that still holds pieces. Take its pieces out first.",
  save: "Couldn't save. Try again.",
};

// Messages that belong to ONE grid row (`?edit=<pieceId>`).
const ROW_ERR: Record<string, string> = {
  assign: "Couldn't change that assignment. Reload the page and try again.",
  alteration: "Couldn't save that. Try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function AssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?set=a&set=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page or
  // smuggle an array into a query filter.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Wardrobe" role={role} allowed={COSTUMES_ROLES} />
    );
  }
  const canWrite = COSTUME_WRITE_ROLES.includes(role);

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();

  const { data: ensembleData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const ensembles = (ensembleData as { id: string; name: string }[] | null) ?? [];

  // Sets are season-scoped — this season's, in show order.
  let sets: SetRow[] = [];
  if (season) {
    const { data } = await supabase
      .from("costume_sets")
      .select("id, name, ensemble_id, sort_order, notes")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    sets = (data as SetRow[] | null) ?? [];
  }
  // With exactly one set there is nothing to choose, so the grid opens on it —
  // a program's first season has one set for a long time.
  const selectedSetId = one("set");
  const activeSet =
    sets.find((s) => s.id === selectedSetId) ?? (sets.length === 1 ? sets[0] : null);

  // A ROW-SCOPED MESSAGE THAT HAS NO ROW MUST STILL BE SAID. `?edit=<pieceId>`
  // used to silence the page banner outright, so when the addressed row was not
  // on screen — no active season, no set chosen, a different set open, the piece
  // taken out of the set — the message rendered nowhere at all and the writer
  // was left with a form that appeared to have done nothing. The grid only
  // renders when a season AND a set are in play; outside that, every code falls
  // OPEN to the page banner, which is the pattern the treasury pages already
  // use. The "is that piece in THIS set" half is the grid's own (it is the only
  // thing that has read the pieces) — see AssignmentGrid.
  const errorCode = one("error");
  const editParam = canWrite ? one("edit") : null;
  const gridRenders = !!season && !!activeSet;
  const setOpen = editParam === "set" && gridRenders;
  const openRowId = editParam === "set" || !gridRenders ? null : editParam;
  const setError = setOpen ? message(SET_ERR, errorCode) : null;
  const rowError = openRowId ? message(ROW_ERR, errorCode) : null;
  const pageError =
    setError || rowError
      ? null
      : (message(ERR, errorCode) ??
        message(SET_ERR, errorCode) ??
        message(ROW_ERR, errorCode));
  const unknownError = !!errorCode && !setError && !rowError && !pageError;
  // The add drawer reopens only for messages it owns; a set or row code that
  // fell open to the banner belongs to a control that is not in the drawer.
  const drawerError = message(ERR, errorCode);
  const drawerOpen = canWrite && (one("add") === "set" || !!drawerError);

  const eyebrow = season
    ? `${sets.length} set${sets.length === 1 ? "" : "s"} · ${season.label}`
    : "No active season";

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Assignments</h1>
        </div>
        {canWrite && season && (
          <div className="page-head-actions">
            <AddSet
              programId={program.id}
              slug={slug}
              seasonId={season.id}
              ensembles={ensembles}
              open={drawerOpen}
              error={drawerError}
            />
          </div>
        )}
      </div>

      <SubTabs strip={costumeTabs(slug, "assignments")} />

      {!season && (
        <p className="muted">
          No active season — assignments and sets both belong to a season.{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link>.
        </p>
      )}

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {one("deleted") && <p className="alert-ok">Set deleted.</p>}
      {((pageError && !(drawerOpen && drawerError)) || unknownError) && (
        <p className="alert-error">{pageError ?? "Something went wrong."}</p>
      )}

      {season && sets.length === 0 && (
        <p className="muted">
          No sets yet this season. A set is one look — the costume everyone wears
          for one part of the show.
          {canWrite ? " Add one to start assigning." : ""}
        </p>
      )}

      {season && sets.length > 1 && (
        <form method="get" className="row-inline wardrobe-filters">
          <label>
            Set
            <select name="set" defaultValue={activeSet?.id ?? ""}>
              <option value="">Choose a set…</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            Open
          </button>
        </form>
      )}

      {season && sets.length > 1 && !activeSet && (
        <p className="muted">Pick a set to see who wears what.</p>
      )}

      {season && activeSet && (
        <AssignmentGrid
          slug={slug}
          programId={program.id}
          seasonId={season.id}
          set={activeSet}
          ensembles={ensembles}
          canWrite={canWrite}
          setOpen={setOpen}
          setError={setError}
          openRowId={openRowId}
          rowError={rowError}
        />
      )}
    </section>
  );
}

async function AssignmentGrid({
  slug,
  programId,
  seasonId,
  set,
  ensembles,
  canWrite,
  setOpen,
  setError,
  openRowId,
  rowError,
}: {
  slug: string;
  programId: string;
  seasonId: string;
  set: SetRow;
  ensembles: { id: string; name: string }[];
  canWrite: boolean;
  setOpen: boolean;
  setError: string | null;
  openRowId: string | null;
  rowError: string | null;
}) {
  const supabase = await createClient();

  // Pieces in this set: assignable (students) vs direct (props/set pieces).
  const { data: pieceData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label")
    .eq("program_id", programId)
    .eq("set_id", set.id)
    .order("label", { ascending: true });
  const allPieces =
    (pieceData as (AssignablePiece & { kind: PieceKind })[] | null) ?? [];
  const assignable = allPieces.filter((p) => !isDirectKind(p.kind));
  const direct = allPieces.filter((p) => isDirectKind(p.kind));

  // Eligible students: the set's ensemble members for this season.
  let students: EligibleStudent[] = [];
  if (set.ensemble_id) {
    const { data: memberData } = await supabase
      .from("ensemble_members")
      .select("students(id, first_name, last_name, sizes, status)")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .eq("ensemble_id", set.ensemble_id);
    students = ((memberData as { students: EligibleStudent | null }[] | null) ?? [])
      .map((m) => m.students)
      .filter((s): s is EligibleStudent => s != null);
    students.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
    );
  }
  const studentById = new Map(students.map((s) => [s.id, s]));

  // Current assignments for these pieces this season.
  const assignmentByPiece = new Map<string, PieceAssignment>();
  if (assignable.length > 0) {
    const { data: aData } = await supabase
      .from("costume_assignments")
      .select("id, piece_id, student_id, alteration_status")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .in("piece_id", assignable.map((p) => p.id));
    for (const a of (aData as (PieceAssignment & { piece_id: string })[] | null) ??
      []) {
      assignmentByPiece.set(a.piece_id, a);
    }
  }

  // The last half of the fail-open (see the page's error block): the page knows
  // a grid is rendering, only this component knows WHICH pieces are in it. A
  // message addressed at a piece that is not one of them would render nowhere,
  // so it goes up top instead of disappearing.
  const rowOnScreen = !!openRowId && assignable.some((p) => p.id === openRowId);
  const orphanRowError = rowError && !rowOnScreen ? rowError : null;

  const ensembleName = set.ensemble_id
    ? (ensembles.find((e) => e.id === set.ensemble_id)?.name ?? "—")
    : null;

  return (
    <>
      {orphanRowError && <p className="alert-error">{orphanRowError}</p>}

      {canWrite && (
        <SetSettings
          programId={programId}
          slug={slug}
          set={set}
          ensembles={ensembles}
          pieceCount={allPieces.length}
          open={setOpen}
          error={setError}
        />
      )}

      {/* A READER GETS THE SET'S FACTS TOO. Ensemble, show order and piece count
          live in the Set settings summary — which only writers see — so when
          sets moved onto this page a board member was left with a name and
          nothing else about the set they were reading. The board's seat is
          read-only BY DESIGN, not blind (§2): it sees everything and changes
          nothing, which is the transparency that protects the program. */}
      {canWrite ? (
        <p className="muted">
          <strong>{set.name}</strong>
          {set.ensemble_id
            ? ""
            : " — no ensemble on this set yet, so there are no students to assign. Pick one in Set settings."}
        </p>
      ) : (
        <p className="muted">
          <strong>{set.name}</strong> · {ensembleName ?? "no ensemble yet"} ·{" "}
          {allPieces.length} piece{allPieces.length === 1 ? "" : "s"} · #
          {set.sort_order} in the show
          {set.notes ? ` · ${set.notes}` : ""}
        </p>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Size</th>
            <th>Who wears it</th>
            <th>Alteration</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {assignable.map((p) => {
            const a = assignmentByPiece.get(p.id) ?? null;
            return (
              <AssignmentRow
                key={p.id}
                programId={programId}
                slug={slug}
                seasonId={seasonId}
                setId={set.id}
                piece={p}
                assignment={a}
                student={a ? studentById.get(a.student_id) ?? null : null}
                students={students}
                canWrite={canWrite}
                open={openRowId === p.id}
                error={openRowId === p.id ? rowError : null}
              />
            );
          })}
          {assignable.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 5 : 4} className="muted">
                No costume pieces in this set yet. Put some in on the{" "}
                <Link href={`/${slug}/costumes/sets/${set.id}`}>set&apos;s page</Link>.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {direct.length > 0 && (
        <>
          <h2>Props &amp; set pieces</h2>
          <p className="muted">
            These skip student assignment — they flow through checkout directly.
          </p>
          <ul>
            {direct.map((p) => (
              <li key={p.id}>
                <Link href={`/${slug}/costumes/pieces/${p.id}`}>{p.label}</Link>{" "}
                <span className="muted">{PIECE_KIND_LABELS[p.kind]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
