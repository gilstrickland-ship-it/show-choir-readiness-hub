import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import { competitionEnsembleMap } from "@/lib/competitions";
import { zonedWallToUtc, zonedDateKey } from "@/lib/datetime";
import {
  COSTUME_WRITE_ROLES,
  OPEN_ALTERATION_STATUSES,
  type PieceKind,
  type AlterationStatus,
} from "@/lib/costumes";
import { SubTabs } from "../SubTabs";
import { costumeTabs } from "@/lib/subnav";
import { AltQueue, type QueueItem } from "./AltQueue";

// Wardrobe landing — the Alterations queue, which is the tab this seat works
// every week. Urgency banner counts down to the next competition; the queue is
// urgency-sorted (soonest ensemble comp first) with Start/Done and a row-local
// note panel; glance cards hand off to Assignments / Checkout / Condition
// flags. Read-only for board_member; writers get the controls.

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

// Messages that belong to ONE queue row. They arrive with `?edit=<assignmentId>`,
// which is also what reopens that row's note panel.
const ROW_ERR: Record<string, string> = {
  alteration: "Couldn't save that. Try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
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
  // Next hands back an ARRAY for a duplicated param (?edit=a&edit=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
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
  const errorCode = one("error");
  const openId = canWrite ? one("edit") : null;
  const rowError = message(ROW_ERR, errorCode);

  const tz = program.timezone;
  const now = new Date();
  const todayKey = zonedDateKey(now, tz);

  const supabase = await createClient();

  let items: QueueItem[] = [];
  const nextCompDate = new Map<string, string>(); // ensemble_id → soonest comp date
  let nextComp: { name: string; date: string } | null = null;

  if (season) {
    // Each ensemble's next competition date (this season), plus the program-wide
    // next competition for the urgency banner. A competition can include several
    // ensembles (Feature 004) — participation comes from the competition_ensembles
    // junction, so each participating ensemble inherits that comp's date.
    const { data: compData } = await supabase
      .from("competitions")
      .select("id, name, date")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .gte("date", todayKey)
      .order("date", { ascending: true });
    const upcomingComps =
      (compData as { id: string; name: string; date: string | null }[] | null) ?? [];
    const datedComps = upcomingComps.filter(
      (c): c is { id: string; name: string; date: string } => c.date != null,
    );
    if (datedComps[0]) nextComp = { name: datedComps[0].name, date: datedComps[0].date };

    const compEnsembles = await competitionEnsembleMap(
      supabase,
      program.id,
      datedComps.map((c) => c.id),
    );
    // datedComps is date-ascending, so the first date seen per ensemble is soonest.
    for (const c of datedComps) {
      for (const eid of compEnsembles.get(c.id) ?? []) {
        if (!nextCompDate.has(eid)) nextCompDate.set(eid, c.date);
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
  const openRowExists = openId != null && items.some((i) => i.id === openId);

  // Days until the next competition (banner).
  let daysToComp: number | null = null;
  if (nextComp) {
    const target = zonedWallToUtc(`${nextComp.date}T00:00`, tz);
    if (target && !Number.isNaN(target.getTime())) {
      daysToComp = countdownDays(target, now);
    }
  }

  // ---- Glance-card counts (cheap) -------------------------------------------
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
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Wardrobe</h1>
        </div>
      </div>

      <SubTabs strip={costumeTabs(slug, "alterations")} />

      {!season && <p className="muted">No active season — nothing to alter yet.</p>}
      {one("saved") && <p className="alert-ok">Saved.</p>}
      {/* A row's refusal renders inside that row's panel. It only surfaces here
          when the row it belongs to has left the queue (a status moved on) —
          otherwise the message would vanish with the row. */}
      {rowError && !openRowExists && <p className="alert-error">{rowError}</p>}

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
        <AltQueue
          programId={program.id}
          slug={slug}
          items={items}
          canWrite={canWrite}
          openId={openId}
          error={rowError}
        />
      )}

      {/* Glance cards: each one delegates to the tab that owns that job. */}
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
