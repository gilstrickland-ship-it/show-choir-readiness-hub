import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KIND_LABELS,
  ALTERATION_STATUSES,
  ALTERATION_STATUS_LABELS,
  isDirectKind,
  relevantSizeValue,
  sizeMismatch,
  type PieceKind,
  type AlterationStatus,
} from "@/lib/costumes";
import { CostumeTabs } from "../CostumeTabs";
import { assignPiece, unassignPiece } from "./actions";
import { setAlterationStatus } from "../alterations/actions";

// Assignment grid (T010) — per set, the set's ensemble members × the set's
// pieces. One piece → one student per season (UNIQUE(season_id, piece_id)).
// Student sizes are surfaced inline; a piece/size mismatch renders a warning
// chip and never blocks. Props/set pieces skip assignment (checkout-direct).

interface SetRow {
  id: string;
  name: string;
  ensemble_id: string | null;
}

interface PieceRow {
  id: string;
  kind: PieceKind;
  label: string;
  size_label: string | null;
}

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  sizes: Record<string, unknown> | null;
  status: string;
}

interface AssignmentRow {
  id: string;
  piece_id: string;
  student_id: string;
  alteration_status: AlterationStatus;
}

export default async function AssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ set?: string; saved?: string; error?: string }>;
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
  const { set: selectedSetId, saved, error } = await searchParams;

  const supabase = await createClient();

  // Set picker — active season's sets.
  let sets: SetRow[] = [];
  if (season) {
    const { data } = await supabase
      .from("costume_sets")
      .select("id, name, ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    sets = (data as SetRow[] | null) ?? [];
  }
  const activeSet = sets.find((s) => s.id === selectedSetId) ?? null;

  return (
    <section className="stack">
      <CostumeTabs slug={slug} active="assignments" />
      <h1>Assignments</h1>
      {!season && (
        <p className="muted">
          No active season — assignments are season-scoped.{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link>.
        </p>
      )}

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "assign" && (
        <p className="alert-error">Couldn&apos;t update the assignment. Try again.</p>
      )}
      {error === "alteration" && (
        <p className="alert-error">Couldn&apos;t update the alteration. Try again.</p>
      )}

      {season && sets.length === 0 && (
        <p className="muted">
          No costume sets yet. Create one on the{" "}
          <Link href={`/${slug}/costumes/sets`}>Sets page</Link>.
        </p>
      )}

      {season && sets.length > 0 && (
        <form method="get" className="row-inline">
          <label>
            Set
            <select name="set" defaultValue={selectedSetId ?? ""}>
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

      {season && activeSet && (
        <AssignmentGrid
          slug={slug}
          programId={program.id}
          seasonId={season.id}
          set={activeSet}
          canWrite={canWrite}
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
  canWrite,
}: {
  slug: string;
  programId: string;
  seasonId: string;
  set: SetRow;
  canWrite: boolean;
}) {
  const supabase = await createClient();

  // Pieces in this set: assignable (students) vs direct (props/set pieces).
  const { data: pieceData } = await supabase
    .from("costume_pieces")
    .select("id, kind, label, size_label")
    .eq("program_id", programId)
    .eq("set_id", set.id)
    .order("label", { ascending: true });
  const allPieces = (pieceData as PieceRow[] | null) ?? [];
  const assignable = allPieces.filter((p) => !isDirectKind(p.kind));
  const direct = allPieces.filter((p) => isDirectKind(p.kind));

  // Eligible students: the set's ensemble members for this season.
  let students: StudentRow[] = [];
  if (set.ensemble_id) {
    const { data: memberData } = await supabase
      .from("ensemble_members")
      .select("students(id, first_name, last_name, sizes, status)")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .eq("ensemble_id", set.ensemble_id);
    students = ((memberData as { students: StudentRow | null }[] | null) ?? [])
      .map((m) => m.students)
      .filter((s): s is StudentRow => s != null);
    students.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
    );
  }
  const studentById = new Map(students.map((s) => [s.id, s]));

  // Current assignments for these pieces this season.
  const assignmentByPiece = new Map<string, AssignmentRow>();
  if (assignable.length > 0) {
    const { data: aData } = await supabase
      .from("costume_assignments")
      .select("id, piece_id, student_id, alteration_status")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .in("piece_id", assignable.map((p) => p.id));
    for (const a of (aData as AssignmentRow[] | null) ?? []) {
      assignmentByPiece.set(a.piece_id, a);
    }
  }

  const back = `/${slug}/costumes/assignments?set=${set.id}`;

  const studentLabel = (kind: PieceKind, s: StudentRow) => {
    const size = relevantSizeValue(kind, s.sizes);
    return `${s.last_name}, ${s.first_name}${size ? ` — ${size}` : ""}`;
  };

  return (
    <>
      <p className="muted">
        Set: <strong>{set.name}</strong>
        {!set.ensemble_id && " — no ensemble linked; assign one on the set to list students."}
      </p>

      <table className="members">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Size</th>
            <th>Assigned student</th>
            {canWrite && <th>Assign</th>}
            <th>Alteration</th>
          </tr>
        </thead>
        <tbody>
          {assignable.map((p) => {
            const a = assignmentByPiece.get(p.id);
            const student = a ? studentById.get(a.student_id) ?? null : null;
            const studentSize = student ? relevantSizeValue(p.kind, student.sizes) : null;
            const mismatch = student
              ? sizeMismatch(p.size_label, p.kind, student.sizes)
              : false;
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/${slug}/costumes/pieces/${p.id}`}>{p.label}</Link>{" "}
                  <span className="muted">{PIECE_KIND_LABELS[p.kind]}</span>
                </td>
                <td>{p.size_label ?? "—"}</td>
                <td>
                  {student ? (
                    <>
                      {student.last_name}, {student.first_name}
                      {studentSize && <span className="muted"> ({studentSize})</span>}
                      {mismatch && (
                        <span className="chip danger" title="Piece size differs from student size">
                          size mismatch
                        </span>
                      )}
                      {a && student.status === "inactive" && (
                        <span className="muted"> (inactive)</span>
                      )}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {canWrite && (
                  <td>
                    {students.length === 0 ? (
                      <span className="muted">no students</span>
                    ) : (
                      <div className="row-inline">
                        <form action={assignPiece} className="row-inline">
                          <input type="hidden" name="programId" value={programId} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="setId" value={set.id} />
                          <input type="hidden" name="seasonId" value={seasonId} />
                          <input type="hidden" name="pieceId" value={p.id} />
                          <select
                            name="studentId"
                            defaultValue={a?.student_id ?? ""}
                            aria-label={`Assign ${p.label}`}
                            required
                          >
                            <option value="" disabled>
                              Choose…
                            </option>
                            {students.map((s) => (
                              <option key={s.id} value={s.id}>
                                {studentLabel(p.kind, s)}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="secondary">
                            {a ? "Reassign" : "Assign"}
                          </button>
                        </form>
                        {a && (
                          <form action={unassignPiece}>
                            <input type="hidden" name="programId" value={programId} />
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="setId" value={set.id} />
                            <input type="hidden" name="assignmentId" value={a.id} />
                            <button type="submit" className="linklike danger">
                              Unassign
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                )}
                <td>
                  {a ? (
                    canWrite ? (
                      <form action={setAlterationStatus} className="row-inline">
                        <input type="hidden" name="programId" value={programId} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <input type="hidden" name="back" value={back} />
                        <select
                          name="status"
                          defaultValue={a.alteration_status}
                          aria-label="Alteration status"
                        >
                          {ALTERATION_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {ALTERATION_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="secondary">
                          Set
                        </button>
                      </form>
                    ) : (
                      ALTERATION_STATUS_LABELS[a.alteration_status]
                    )
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {assignable.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 5 : 4} className="muted">
                No assignable pieces in this set. Attach costume pieces on the{" "}
                <Link href={`/${slug}/costumes/sets/${set.id}`}>set page</Link>.
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
