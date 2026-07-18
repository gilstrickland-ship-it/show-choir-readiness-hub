import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  OPEN_ALTERATION_STATUSES,
  ALTERATION_STATUS_LABELS,
  PIECE_KIND_LABELS,
  NO_HEALTH_LABEL,
  nextAlterationStatus,
  type PieceKind,
  type AlterationStatus,
} from "@/lib/costumes";
import { CostumeTabs } from "../CostumeTabs";
import { setAlterationStatus, updateAlterationNotes } from "./actions";

// Alterations queue (T010) — the costume parent's working screen. Every open
// alteration (needed / in_progress), grouped by ensemble and ordered by that
// ensemble's next competition date (soonest first). Quick advance + notes edit;
// reaching 'done' stamps fitted_at and drops the row from the queue.

interface RawAssignment {
  id: string;
  alteration_status: AlterationStatus;
  alteration_notes: string | null;
  student: { first_name: string; last_name: string } | null;
  piece: {
    label: string;
    kind: PieceKind;
    set: { id: string; name: string; ensemble_id: string | null } | null;
  } | null;
}

interface QueueItem {
  id: string;
  status: AlterationStatus;
  notes: string | null;
  studentName: string;
  pieceLabel: string;
  pieceKind: PieceKind;
  setName: string;
  ensembleId: string | null;
}

const NO_ENSEMBLE = "__none__";

export default async function AlterationsPage({
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

  let items: QueueItem[] = [];
  const ensembleName = new Map<string, string>();
  const nextCompDate = new Map<string, string>();

  if (season) {
    const { data } = await supabase
      .from("costume_assignments")
      .select(
        "id, alteration_status, alteration_notes, student:students(first_name, last_name), piece:costume_pieces(label, kind, set:costume_sets(id, name, ensemble_id))",
      )
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .in("alteration_status", OPEN_ALTERATION_STATUSES as unknown as string[]);

    items = ((data as RawAssignment[] | null) ?? []).map((a) => ({
      id: a.id,
      status: a.alteration_status,
      notes: a.alteration_notes,
      studentName: a.student
        ? `${a.student.last_name}, ${a.student.first_name}`
        : "—",
      pieceLabel: a.piece?.label ?? "—",
      pieceKind: (a.piece?.kind ?? "accessory") as PieceKind,
      setName: a.piece?.set?.name ?? "—",
      ensembleId: a.piece?.set?.ensemble_id ?? null,
    }));

    // Ensemble names + each ensemble's next competition date (this season).
    const { data: ensembleData } = await supabase
      .from("ensembles")
      .select("id, name")
      .eq("program_id", program.id);
    for (const e of (ensembleData as { id: string; name: string }[] | null) ?? []) {
      ensembleName.set(e.id, e.name);
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: compData } = await supabase
      .from("competitions")
      .select("ensemble_id, date")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .gte("date", today)
      .order("date", { ascending: true });
    for (const c of (compData as { ensemble_id: string | null; date: string | null }[] | null) ??
      []) {
      if (c.ensemble_id && c.date && !nextCompDate.has(c.ensemble_id)) {
        nextCompDate.set(c.ensemble_id, c.date);
      }
    }
  }

  // Group by ensemble, ordered by next competition date (soonest first; groups
  // without an upcoming competition sort last).
  const groups = new Map<string, QueueItem[]>();
  for (const it of items) {
    const key = it.ensembleId ?? NO_ENSEMBLE;
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const da = a === NO_ENSEMBLE ? null : nextCompDate.get(a) ?? null;
    const db = b === NO_ENSEMBLE ? null : nextCompDate.get(b) ?? null;
    if (da && db) return da.localeCompare(db);
    if (da) return -1;
    if (db) return 1;
    return 0;
  });

  return (
    <section className="stack">
      <CostumeTabs slug={slug} active="alterations" />
      <h1>Alterations</h1>
      {!season && (
        <p className="muted">No active season — nothing to alter yet.</p>
      )}

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "alteration" && (
        <p className="alert-error">Couldn&apos;t update the alteration. Try again.</p>
      )}

      {season && items.length === 0 && (
        <p className="muted">No open alterations. Everything is fitted.</p>
      )}

      {season && items.length > 0 && canWrite && (
        <p className="muted">{NO_HEALTH_LABEL}</p>
      )}

      {orderedKeys.map((key) => {
        const list = groups.get(key) ?? [];
        list.sort(
          (a, b) =>
            OPEN_ALTERATION_STATUSES.indexOf(a.status) -
              OPEN_ALTERATION_STATUSES.indexOf(b.status) ||
            a.pieceLabel.localeCompare(b.pieceLabel),
        );
        const name =
          key === NO_ENSEMBLE ? "No ensemble" : ensembleName.get(key) ?? "Ensemble";
        const date = key === NO_ENSEMBLE ? null : nextCompDate.get(key) ?? null;
        return (
          <div key={key} className="stack" style={{ width: "100%" }}>
            <h2>
              {name}{" "}
              <span className="muted">
                {date ? `— next competition ${date}` : "— no upcoming competition"}
              </span>
            </h2>
            <table className="members">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Piece</th>
                  <th>Set</th>
                  <th>Status</th>
                  <th>Notes</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id}>
                    <td>{it.studentName}</td>
                    <td>
                      {it.pieceLabel}{" "}
                      <span className="muted">{PIECE_KIND_LABELS[it.pieceKind]}</span>
                    </td>
                    <td>{it.setName}</td>
                    <td>
                      <span className="badge">{ALTERATION_STATUS_LABELS[it.status]}</span>
                    </td>
                    <td>
                      {canWrite ? (
                        <form action={updateAlterationNotes} className="row-inline">
                          <input type="hidden" name="programId" value={program.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="assignmentId" value={it.id} />
                          <input
                            type="text"
                            name="alteration_notes"
                            defaultValue={it.notes ?? ""}
                            aria-label="Alteration notes"
                            placeholder="Hem, take in waist…"
                          />
                          <button type="submit" className="secondary">
                            Save
                          </button>
                        </form>
                      ) : (
                        it.notes ?? "—"
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <form action={setAlterationStatus}>
                          <input type="hidden" name="programId" value={program.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="assignmentId" value={it.id} />
                          <input type="hidden" name="status" value={nextAlterationStatus(it.status)} />
                          <button type="submit">
                            {it.status === "needed" ? "Start" : "Mark fitted"}
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
