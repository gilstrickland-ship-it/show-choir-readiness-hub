import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import { zonedWallToUtc, zonedDateKey } from "@/lib/datetime";
import {
  COSTUME_WRITE_ROLES,
  OPEN_ALTERATION_STATUSES,
  ALTERATION_STATUS_LABELS,
  PIECE_KIND_LABELS,
  NO_HEALTH_LABEL,
  type PieceKind,
  type AlterationStatus,
} from "@/lib/costumes";
import { CostumeTabs } from "./CostumeTabs";
import { setAlterationStatus, updateAlterationNotes } from "./alterations/actions";

// Wardrobe landing (season-workflow redesign, "Wardrobe" design ref) — the
// Alterations queue is the landing content (Inventory moved to /costumes/
// inventory). Urgency banner counts down to the next competition; the queue is
// urgency-sorted (soonest ensemble comp first) with the existing Start/Done
// status transitions; summary cards glance at Assignments / Checkout / Condition
// flags. Read-only for board_member; writers get the Start/Done + notes controls.

interface RawAssignment {
  id: string;
  alteration_status: AlterationStatus;
  alteration_notes: string | null;
  student: { first_name: string; last_name: string } | null;
  piece: {
    label: string;
    kind: PieceKind;
    size_label: string | null;
    storage_location: string | null;
    set: { name: string; ensemble_id: string | null } | null;
  } | null;
}

interface QueueItem {
  id: string;
  status: AlterationStatus;
  notes: string | null;
  studentName: string;
  pieceLabel: string;
  pieceKind: PieceKind;
  location: string | null;
  size: string | null;
  ensembleId: string | null;
  sortDate: string; // YYYY-MM-DD urgency key ("9999-…" when no upcoming comp)
}

// Whole days from `now` to `target` (future). Past clamps to 0.
function countdownDays(target: Date, now: Date): number {
  const ms = target.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

export default async function WardrobePage({
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

  const tz = program.timezone;
  const now = new Date();
  const todayKey = zonedDateKey(now, tz);

  const supabase = await createClient();

  let items: QueueItem[] = [];
  const nextCompDate = new Map<string, string>(); // ensemble_id → soonest comp date
  let nextComp: { name: string; date: string } | null = null;

  if (season) {
    // Each ensemble's next competition date (this season), plus the program-wide
    // next competition for the urgency banner.
    const { data: compData } = await supabase
      .from("competitions")
      .select("name, date, ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .gte("date", todayKey)
      .order("date", { ascending: true });
    for (const c of (compData as
      | { name: string; date: string | null; ensemble_id: string | null }[]
      | null) ?? []) {
      if (!c.date) continue;
      if (!nextComp) nextComp = { name: c.name, date: c.date };
      if (c.ensemble_id && !nextCompDate.has(c.ensemble_id)) {
        nextCompDate.set(c.ensemble_id, c.date);
      }
    }

    const { data } = await supabase
      .from("costume_assignments")
      .select(
        "id, alteration_status, alteration_notes, student:students(first_name, last_name), piece:costume_pieces(label, kind, size_label, storage_location, set:costume_sets(name, ensemble_id))",
      )
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .in("alteration_status", OPEN_ALTERATION_STATUSES as unknown as string[]);

    items = ((data as RawAssignment[] | null) ?? []).map((a) => {
      const ensembleId = a.piece?.set?.ensemble_id ?? null;
      const compDate = ensembleId ? nextCompDate.get(ensembleId) ?? null : null;
      return {
        id: a.id,
        status: a.alteration_status,
        notes: a.alteration_notes,
        studentName: a.student
          ? `${a.student.last_name}, ${a.student.first_name}`
          : "—",
        pieceLabel: a.piece?.label ?? "—",
        pieceKind: (a.piece?.kind ?? "accessory") as PieceKind,
        location: a.piece?.storage_location ?? null,
        size: a.piece?.size_label ?? null,
        ensembleId,
        sortDate: compDate ?? "9999-12-31",
      };
    });

    // Urgency order: soonest ensemble competition first, then needed before
    // in-progress, then piece label.
    items.sort(
      (a, b) =>
        a.sortDate.localeCompare(b.sortDate) ||
        OPEN_ALTERATION_STATUSES.indexOf(a.status) -
          OPEN_ALTERATION_STATUSES.indexOf(b.status) ||
        a.pieceLabel.localeCompare(b.pieceLabel),
    );
  }

  const openCount = items.length;

  // Days until the next competition (banner).
  let daysToComp: number | null = null;
  if (nextComp) {
    const target = zonedWallToUtc(`${nextComp.date}T00:00`, tz);
    if (target && !Number.isNaN(target.getTime())) {
      daysToComp = countdownDays(target, now);
    }
  }

  // ---- Summary-card counts (cheap) ------------------------------------------
  const [
    piecesCountRes,
    setsCountRes,
    flaggedCountRes,
    studentsCountRes,
    checkoutOutRes,
    assignedRes,
  ] = await Promise.all([
    supabase
      .from("costume_pieces")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id),
    supabase
      .from("costume_sets")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id),
    supabase
      .from("costume_pieces")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("condition", "fair"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .neq("status", "graduated"),
    supabase
      .from("costume_checkouts")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .not("checked_out_at", "is", null)
      .is("checked_in_at", null),
    season
      ? supabase
          .from("costume_assignments")
          .select("student_id")
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .not("student_id", "is", null)
      : Promise.resolve({ data: [] as { student_id: string }[] }),
  ]);

  const piecesCount = piecesCountRes.count ?? 0;
  const setsCount = setsCountRes.count ?? 0;
  const flaggedCount = flaggedCountRes.count ?? 0;
  const studentsCount = studentsCountRes.count ?? 0;
  const outCount = checkoutOutRes.count ?? 0;
  const assignedStudents = new Set(
    ((assignedRes.data as { student_id: string | null }[] | null) ?? [])
      .map((r) => r.student_id)
      .filter((id): id is string => id != null),
  ).size;

  const eyebrow = [
    `${piecesCount} piece${piecesCount === 1 ? "" : "s"}`,
    `${setsCount} set${setsCount === 1 ? "" : "s"}`,
    `${assignedStudents} assigned this season`,
  ].join(" · ");

  return (
    <section className="stack wardrobe">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Wardrobe</h1>
        </div>
      </div>

      <CostumeTabs slug={slug} active="alterations" />

      {!season && <p className="muted">No active season — nothing to alter yet.</p>}
      {saved && <p className="alert-ok">Saved.</p>}
      {error === "alteration" && (
        <p className="alert-error">Couldn&apos;t update the alteration. Try again.</p>
      )}

      {nextComp && openCount > 0 && (
        <div className="wardrobe-urgency">
          <span className="wardrobe-urgency-num">{daysToComp ?? 0}</span>
          <span className="wardrobe-urgency-text">
            <strong>
              day{daysToComp === 1 ? "" : "s"} until {nextComp.name}
            </strong>{" "}
            — {openCount} alteration{openCount === 1 ? "" : "s"} still open. Sorted by
            urgency below.
          </span>
        </div>
      )}

      {season && openCount === 0 && (
        <p className="muted">No open alterations. Everything is fitted.</p>
      )}

      {openCount > 0 && (
        <>
          {canWrite && <p className="muted">{NO_HEALTH_LABEL}</p>}
          <div className="alt-queue">
            {items.map((it) => {
              const meta = [it.location, it.size].filter(Boolean).join(" · ");
              return (
                <div key={it.id} className="alt-row">
                  <span className={`alt-pill ${it.status}`}>
                    {ALTERATION_STATUS_LABELS[it.status]}
                  </span>
                  <div className="alt-body">
                    <strong>{it.pieceLabel}</strong>{" "}
                    <span className="alt-kind">{PIECE_KIND_LABELS[it.pieceKind]}</span>
                    {" — "}
                    {it.studentName}
                    {it.notes && <span className="muted"> · {it.notes}</span>}
                  </div>
                  {meta && <span className="alt-meta">{meta}</span>}
                  {canWrite && (
                    <div className="alt-actions">
                      {it.status === "needed" && (
                        <form action={setAlterationStatus}>
                          <input type="hidden" name="programId" value={program.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="assignmentId" value={it.id} />
                          <input type="hidden" name="status" value="in_progress" />
                          <button type="submit" className="secondary">
                            Start
                          </button>
                        </form>
                      )}
                      <form action={setAlterationStatus}>
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="assignmentId" value={it.id} />
                        <input type="hidden" name="status" value="done" />
                        <button type="submit">Done</button>
                      </form>
                    </div>
                  )}
                  {canWrite && (
                    <form action={updateAlterationNotes} className="alt-notes">
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
                        Save note
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Summary cards */}
      <div className="wardrobe-cards">
        <div className="wardrobe-card">
          <h3>Assignments</h3>
          <div className="wardrobe-card-num">
            {assignedStudents} / {studentsCount}
          </div>
          <div className="wardrobe-card-sub">students with a costume assigned</div>
          <Link href={`/${slug}/costumes/assignments`}>Open assignments →</Link>
        </div>
        <div className="wardrobe-card">
          <h3>Checkout</h3>
          <div className="wardrobe-card-num">{outCount} out</div>
          <div className="wardrobe-card-sub">pieces currently checked out</div>
          <Link href={`/${slug}/costumes/checkout`}>Checkout board →</Link>
        </div>
        <div className="wardrobe-card">
          <h3>Condition flags</h3>
          <div className="wardrobe-card-num">{flaggedCount} fair</div>
          <div className="wardrobe-card-sub">pieces marked fair — review or retire</div>
          <Link href={`/${slug}/costumes/inventory?condition=fair`}>
            Filter inventory →
          </Link>
        </div>
      </div>
    </section>
  );
}
