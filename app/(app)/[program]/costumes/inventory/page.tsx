import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  parsePieceKind,
  parsePieceCondition,
  pieceSearchTerm,
} from "@/lib/costumes";
import { SubTabs } from "../../SubTabs";
import { costumeTabs } from "@/lib/subnav";
import { AddPiece } from "./AddPiece";
import { InventoryFilters } from "./InventoryFilters";
import { PieceRow, type PieceListRow } from "./PieceRow";

// Inventory — everything the program owns. Program-level, so pieces persist
// across seasons: this is the data the departing costume parent currently takes
// with them, and its persistence IS the continuity feature (§4). Props and set
// pieces are kinds in the same list, not a second screen.

// Messages the page owns — the add drawer and the filter row, neither of which
// belongs to a particular piece.
const ERR: Record<string, string> = {
  piece: "A piece needs a name and a kind.",
  set: "That set isn't part of this program. Reload the page and pick one from the list.",
  save: "Couldn't save. Try again.",
};

// Messages that belong to ONE row. They arrive with `?edit=<pieceId>`, which is
// also what reopens that row's panel.
const ROW_ERR: Record<string, string> = {
  piece: "A piece needs a name and a kind.",
  set: "That set isn't part of this program. Reload the page and pick one from the list.",
  save: "Couldn't save. Try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function CostumesInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?kind=a&kind=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page or
  // smuggle an array into a query filter.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
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

  const search = pieceSearchTerm(one("q"));
  const kindFilter = parsePieceKind(one("kind"));
  const conditionFilter = parsePieceCondition(one("condition"));

  const supabase = await createClient();

  // Sets for the filter + both edit surfaces, and for naming each piece's set.
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const sets = (setData as { id: string; name: string }[] | null) ?? [];
  const setName = new Map(sets.map((s) => [s.id, s.name]));

  // "none" is the pieces that aren't in a set yet — a real answer, and one the
  // old blank-valued option silently dropped on the floor.
  const setParam = one("set");
  const setFilter =
    setParam === "none" ? "none" : setParam && setName.has(setParam) ? setParam : "all";

  let query = supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label, color, condition, storage_location, set_id")
    .eq("program_id", program.id)
    .order("label", { ascending: true });

  if (kindFilter) query = query.eq("kind", kindFilter);
  if (conditionFilter) query = query.eq("condition", conditionFilter);
  if (setFilter === "none") query = query.is("set_id", null);
  else if (setFilter !== "all") query = query.eq("set_id", setFilter);
  if (search) {
    query = query.or(
      `label.ilike.%${search}%,color.ilike.%${search}%,storage_location.ilike.%${search}%`,
    );
  }

  const { data: pieceData } = await query;
  const pieces = (pieceData as PieceListRow[] | null) ?? [];

  const inSet = pieces.filter((p) => p.set_id != null).length;
  const eyebrow = `${pieces.length} piece${pieces.length === 1 ? "" : "s"} · ${inSet} in a set`;

  // A row's panel reopens on `?edit=<pieceId>` carrying its own message; without
  // an `edit` the code belongs to the page (the add drawer).
  const errorCode = one("error");
  const openId = canWrite ? one("edit") : null;
  const rowError = openId ? message(ROW_ERR, errorCode) : null;
  const pageError = openId ? null : message(ERR, errorCode);
  const unknownError = !!errorCode && !rowError && !pageError;
  // A create that came back rejected reopens the drawer with its message inside.
  const drawerOpen = canWrite && (one("add") === "piece" || !!pageError);

  // Open (or close) ONE row's Edit panel without losing the filters. `?edit=` is
  // the same param a refused save comes back on, so the link and the redirect
  // land in exactly the same place.
  const columns = canWrite ? 8 : 7;
  const rowHref = (pieceId: string | null): string => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value !== "string") continue;
      if (key === "edit" || key === "error" || key === "saved" || key === "add") {
        continue;
      }
      qs.set(key, value);
    }
    if (pieceId) qs.set("edit", pieceId);
    const query = qs.toString();
    return `/${slug}/costumes/inventory${query ? `?${query}` : ""}${
      pieceId ? `#piece-${pieceId}` : ""
    }`;
  };

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Inventory</h1>
        </div>
        {canWrite && (
          <div className="page-head-actions">
            <AddPiece
              programId={program.id}
              slug={slug}
              sets={sets}
              open={drawerOpen}
              error={pageError}
            />
          </div>
        )}
      </div>

      <SubTabs strip={costumeTabs(slug, "inventory")} />

      <p className="muted">
        Everything the program owns, kept from year to year. Props and set pieces
        live here too — put them in a set and they ride through checkout like any
        costume.
      </p>

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {((pageError && !drawerOpen) || unknownError) && (
        <p className="alert-error">{pageError ?? "Something went wrong."}</p>
      )}

      <InventoryFilters
        slug={slug}
        sets={sets}
        q={one("q") ?? ""}
        kind={kindFilter ?? "all"}
        set={setFilter}
        condition={conditionFilter ?? "all"}
      />

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>What it is</th>
            <th>Size</th>
            <th>Colour</th>
            <th>Condition</th>
            <th>Where it lives</th>
            <th>Set</th>
            {canWrite && <th className="table-action"></th>}
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => (
            <PieceRow
              key={p.id}
              programId={program.id}
              slug={slug}
              piece={p}
              setName={p.set_id ? setName.get(p.set_id) ?? null : null}
              sets={sets}
              canWrite={canWrite}
              open={openId === p.id}
              error={openId === p.id ? rowError : null}
              rowHref={rowHref}
              columns={columns}
            />
          ))}
          {pieces.length === 0 && (
            <tr>
              <td colSpan={columns} className="muted">
                Nothing matches those filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
