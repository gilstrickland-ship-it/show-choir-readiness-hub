import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KIND_LABELS,
  type PieceKind,
} from "@/lib/costumes";
import { assignPieceToSet, removePieceFromSet } from "../../actions";

// What is in this set — put pieces in, take them out. Pieces are program
// inventory and belong to at most one set at a time, so this is the season
// regrouping surface (§4). Everything else about a set (its name, its ensemble,
// its place in the show) is edited where it is used, in Assignments → Set
// settings.

interface PieceRow {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
}

const ERR: Record<string, string> = {
  piece: "That piece isn't part of this program. Reload the page and try again.",
  save: "Couldn't save. Try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(ERR, code) ? ERR[code] : null;
}

export default async function CostumeSetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; setId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, setId } = await params;
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
  const error = message(one("error"));

  const supabase = await createClient();
  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name")
    .eq("id", setId)
    .eq("program_id", program.id)
    .maybeSingle();
  const set = setData as { id: string; name: string } | null;
  if (!set) notFound();

  // Pieces already in this set, plus the ones free to go in.
  const { data: inSetData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label")
    .eq("program_id", program.id)
    .eq("set_id", setId)
    .order("label", { ascending: true });
  const inSet = (inSetData as PieceRow[] | null) ?? [];

  const { data: freeData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label")
    .eq("program_id", program.id)
    .is("set_id", null)
    .neq("condition", "retire")
    .order("label", { ascending: true });
  const free = (freeData as PieceRow[] | null) ?? [];

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            <Link href={`/${slug}/costumes/assignments?set=${setId}`}>
              ← Assignments
            </Link>{" "}
            · {inSet.length} piece{inSet.length === 1 ? "" : "s"}
          </p>
          <h1 className="page-h1">{set.name}</h1>
        </div>
      </div>

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {error && <p className="alert-error">{error}</p>}

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>What it is</th>
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
                    <button
                      type="submit"
                      className="linklike danger"
                      aria-label={`Take ${p.label} out of ${set.name}`}
                    >
                      Take out
                    </button>
                  </form>
                </td>
              )}
            </tr>
          ))}
          {inSet.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 4 : 3} className="muted">
                Nothing in this set yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h2>Put a piece in</h2>
          {free.length === 0 ? (
            <p className="muted">
              Every piece is already in a set. Add pieces in{" "}
              <Link href={`/${slug}/costumes/inventory`}>Inventory</Link>, or take
              one out of another set first.
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
              <button type="submit">Put it in</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
