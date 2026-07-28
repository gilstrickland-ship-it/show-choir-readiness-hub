import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KINDS,
  PIECE_CONDITIONS,
  PIECE_KIND_LABELS,
  PIECE_CONDITION_LABELS,
  NO_HEALTH_LABEL,
  type PieceKind,
  type PieceCondition,
} from "@/lib/costumes";
import { updatePiece, retirePiece } from "../../actions";

// One piece, all of it. Program inventory — no season on the piece itself;
// set_id is the current-season grouping and can be re-pointed here. Retiring
// keeps the record (inventory is never deleted, §4). The inventory row's Edit
// panel handles the five fields that change constantly; this page is where the
// rest of them live.

interface PieceDetail {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
  color: string | null;
  condition: PieceCondition;
  storage_location: string | null;
  set_id: string | null;
  notes: string | null;
}

const ERR: Record<string, string> = {
  piece: "A piece needs a name and a kind.",
  set: "That set isn't part of this program. Reload the page and pick one from the list.",
  save: "Couldn't save. Try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(ERR, code) ? ERR[code] : null;
}

export default async function PieceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; pieceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, pieceId } = await params;
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
  const { data: pieceData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label, color, condition, storage_location, set_id, notes")
    .eq("id", pieceId)
    .eq("program_id", program.id)
    .maybeSingle();
  const piece = pieceData as PieceDetail | null;
  if (!piece) notFound();

  const { data: setData } = await supabase
    .from("costume_sets")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const sets = (setData as { id: string; name: string }[] | null) ?? [];
  const retired = piece.condition === "retire";

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            <Link href={`/${slug}/costumes/inventory`}>← Inventory</Link> ·{" "}
            {PIECE_KIND_LABELS[piece.kind]}
            {retired ? " · retired" : ""}
          </p>
          <h1 className="page-h1">{piece.label}</h1>
        </div>
      </div>

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {error && <p className="alert-error">{error}</p>}

      {canWrite ? (
        <form action={updatePiece} className="stack">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pieceId" value={piece.id} />
          <div className="row-inline">
            <label>
              What it is
              <select name="kind" defaultValue={piece.kind}>
                {PIECE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PIECE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input type="text" name="label" defaultValue={piece.label} required />
            </label>
            <label>
              Size
              <input type="text" name="size_label" defaultValue={piece.size_label ?? ""} />
            </label>
            <label>
              Colour
              <input type="text" name="color" defaultValue={piece.color ?? ""} />
            </label>
            <label>
              Condition
              <select name="condition" defaultValue={piece.condition}>
                {PIECE_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {PIECE_CONDITION_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Where it lives
              <input
                type="text"
                name="storage_location"
                defaultValue={piece.storage_location ?? ""}
              />
            </label>
            <label>
              Set
              <select name="set_id" defaultValue={piece.set_id ?? ""}>
                <option value="">Not in a set</option>
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
            <input type="text" name="notes" defaultValue={piece.notes ?? ""} />
          </label>
          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit">Save changes</button>
        </form>
      ) : (
        <dl className="detail-list">
          <dt>What it is</dt>
          <dd>{PIECE_KIND_LABELS[piece.kind]}</dd>
          <dt>Size</dt>
          <dd>{piece.size_label ?? "—"}</dd>
          <dt>Colour</dt>
          <dd>{piece.color ?? "—"}</dd>
          <dt>Condition</dt>
          <dd>{PIECE_CONDITION_LABELS[piece.condition]}</dd>
          <dt>Where it lives</dt>
          <dd>{piece.storage_location ?? "—"}</dd>
          <dt>Notes</dt>
          <dd>{piece.notes ?? "—"}</dd>
        </dl>
      )}

      {canWrite && !retired && (
        <form action={retirePiece}>
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pieceId" value={piece.id} />
          <input type="hidden" name="back" value="detail" />
          <button type="submit" className="secondary danger">
            Retire piece
          </button>
        </form>
      )}
    </section>
  );
}
