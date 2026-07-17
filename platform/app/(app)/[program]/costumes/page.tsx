import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KINDS,
  PIECE_CONDITIONS,
  PIECE_KIND_LABELS,
  NO_HEALTH_LABEL,
  type PieceKind,
  type PieceCondition,
} from "@/lib/costumes";
import { CostumeTabs } from "./CostumeTabs";
import { addPiece, retirePiece } from "./actions";

// Inventory — the costumes landing page (T009). Program-level piece inventory
// (persists across seasons), filterable by kind / set / condition. Props and set
// pieces are just kinds here — one inventory, no extra screens (§4).

interface PieceRow {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
  color: string | null;
  condition: PieceCondition;
  storage_location: string | null;
  set_id: string | null;
}

interface SetOption {
  id: string;
  name: string;
}

export default async function CostumesInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    kind?: string;
    set?: string;
    condition?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) notFound();
  const canWrite = COSTUME_WRITE_ROLES.includes(role);
  const { kind, set, condition, saved, error } = await searchParams;

  const kindFilter = (PIECE_KINDS as readonly string[]).includes(kind ?? "")
    ? (kind as PieceKind)
    : "all";
  const conditionFilter = (PIECE_CONDITIONS as readonly string[]).includes(
    condition ?? "",
  )
    ? (condition as PieceCondition)
    : "all";

  const supabase = await createClient();

  // Sets for the filter dropdown + resolving each piece's current set name.
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const sets = (setData as SetOption[] | null) ?? [];
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  const setFilter = set && setName.has(set) ? set : "all";

  let query = supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label, color, condition, storage_location, set_id")
    .eq("program_id", program.id)
    .order("label", { ascending: true });

  if (kindFilter !== "all") query = query.eq("kind", kindFilter);
  if (conditionFilter !== "all") query = query.eq("condition", conditionFilter);
  if (setFilter !== "all") query = query.eq("set_id", setFilter);

  const { data: pieceData } = await query;
  const pieces = (pieceData as PieceRow[] | null) ?? [];

  return (
    <section className="stack">
      <CostumeTabs slug={slug} active="inventory" />
      <h1>Inventory</h1>
      <p className="muted">
        Program inventory — pieces persist across seasons. Props and set pieces
        live here too; group them into sets and they flow through checkout like
        any costume.
      </p>

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "piece" && (
        <p className="alert-error">A piece needs a kind and a label.</p>
      )}

      <form method="get" className="row-inline">
        <label>
          Kind
          <select name="kind" defaultValue={kindFilter}>
            <option value="all">All kinds</option>
            {PIECE_KINDS.map((k) => (
              <option key={k} value={k}>
                {PIECE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Set
          <select name="set" defaultValue={setFilter}>
            <option value="all">All sets</option>
            <option value="">(no set)</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Condition
          <select name="condition" defaultValue={conditionFilter}>
            <option value="all">All conditions</option>
            {PIECE_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>

      <table className="members">
        <thead>
          <tr>
            <th>Label</th>
            <th>Kind</th>
            <th>Size</th>
            <th>Color</th>
            <th>Condition</th>
            <th>Storage</th>
            <th>Set</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => (
            <tr key={p.id}>
              <td>
                {canWrite ? (
                  <Link href={`/${slug}/costumes/pieces/${p.id}`}>{p.label}</Link>
                ) : (
                  p.label
                )}
              </td>
              <td>{PIECE_KIND_LABELS[p.kind]}</td>
              <td>{p.size_label ?? "—"}</td>
              <td>{p.color ?? "—"}</td>
              <td>
                {p.condition === "retire" ? (
                  <span className="muted">retired</span>
                ) : (
                  p.condition
                )}
              </td>
              <td>{p.storage_location ?? "—"}</td>
              <td>{p.set_id ? (setName.get(p.set_id) ?? "—") : <span className="muted">—</span>}</td>
              {canWrite && (
                <td>
                  {p.condition !== "retire" && (
                    <form action={retirePiece}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="pieceId" value={p.id} />
                      <button type="submit" className="linklike danger">
                        Retire
                      </button>
                    </form>
                  )}
                </td>
              )}
            </tr>
          ))}
          {pieces.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 8 : 7} className="muted">
                No pieces match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h2>Add a piece</h2>
          <form action={addPiece} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <div className="row-inline">
              <label>
                Kind
                <select name="kind" required defaultValue="dress">
                  {PIECE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PIECE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Label
                <input type="text" name="label" required placeholder="Dress #14, Riser 3" />
              </label>
              <label>
                Size label
                <input type="text" name="size_label" placeholder="M, 10, 32W" />
              </label>
              <label>
                Color
                <input type="text" name="color" />
              </label>
              <label>
                Condition
                <select name="condition" defaultValue="good">
                  {PIECE_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Storage location
                <input type="text" name="storage_location" placeholder="Bin 3, Rack A" />
              </label>
              <label>
                Set
                <select name="set_id" defaultValue="">
                  <option value="">(no set)</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ width: "100%" }}>
              Notes
              <input type="text" name="notes" />
            </label>
            <p className="muted">{NO_HEALTH_LABEL}</p>
            <button type="submit">Add piece</button>
          </form>
        </>
      )}
    </section>
  );
}
