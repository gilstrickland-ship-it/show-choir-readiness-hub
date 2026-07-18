import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KIND_LABELS,
  type PieceKind,
} from "@/lib/costumes";
import { assignPieceToSet, removePieceFromSet } from "../../actions";

// Set detail (T009) — attach pieces to this set (set_id re-pointing) and detach
// them. Pieces are program inventory; a piece belongs to at most one set at a
// time. This is the season-regrouping surface (§4).

interface PieceRow {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
  set_id: string | null;
}

export default async function CostumeSetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; setId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug, setId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) notFound();
  const canWrite = COSTUME_WRITE_ROLES.includes(role);
  const { saved, error } = await searchParams;

  const supabase = await createClient();
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name, ensemble_id")
    .eq("id", setId)
    .eq("program_id", program.id)
    .maybeSingle();
  const set = setData as { id: string; name: string; ensemble_id: string | null } | null;
  if (!set) notFound();

  // Pieces already in this set, plus unassigned pieces available to attach.
  const { data: inSetData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label, set_id")
    .eq("program_id", program.id)
    .eq("set_id", setId)
    .order("label", { ascending: true });
  const inSet = (inSetData as PieceRow[] | null) ?? [];

  const { data: freeData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label, set_id")
    .eq("program_id", program.id)
    .is("set_id", null)
    .neq("condition", "retire")
    .order("label", { ascending: true });
  const free = (freeData as PieceRow[] | null) ?? [];

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/costumes/sets`}>← Sets</Link>
      </p>
      <h1>{set.name} — pieces</h1>

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "piece" && <p className="alert-error">Couldn&apos;t update the piece. Try again.</p>}

      <table className="members">
        <thead>
          <tr>
            <th>Label</th>
            <th>Kind</th>
            <th>Size</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {inSet.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/${slug}/costumes/pieces/${p.id}`}>{p.label}</Link>
              </td>
              <td>{PIECE_KIND_LABELS[p.kind]}</td>
              <td>{p.size_label ?? "—"}</td>
              {canWrite && (
                <td>
                  <form action={removePieceFromSet}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="setId" value={setId} />
                    <input type="hidden" name="pieceId" value={p.id} />
                    <button type="submit" className="linklike danger">
                      Remove
                    </button>
                  </form>
                </td>
              )}
            </tr>
          ))}
          {inSet.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 4 : 3} className="muted">
                No pieces in this set yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h2>Attach a piece</h2>
          {free.length === 0 ? (
            <p className="muted">
              No unassigned pieces available. Add pieces in Inventory, or detach
              one from another set first.
            </p>
          ) : (
            <form action={assignPieceToSet} className="stack">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="setId" value={setId} />
              <label>
                Piece
                <select name="pieceId" required>
                  {free.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({PIECE_KIND_LABELS[p.kind]}
                      {p.size_label ? `, ${p.size_label}` : ""})
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">Attach to set</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
