import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import {
  COSTUME_WRITE_ROLES,
  PIECE_KIND_LABELS,
  NO_HEALTH_LABEL,
  type PieceKind,
} from "@/lib/costumes";
import { CostumeTabs } from "../CostumeTabs";
import { formatDateInTz } from "@/lib/datetime";
import { seedCheckout, toggleCheckout } from "./actions";

// Per-competition checkout (T011). A phone-first tap-to-toggle grid for the
// hallway: each row flips checked_out ↔ checked_in with actor + timestamp.
// Students marked absent for the competition render greyed and are skipped
// (§4). Rows are seeded idempotently on open (writers) via seedCheckout.

interface CompetitionRow {
  id: string;
  name: string;
  date: string | null;
  ensemble_id: string | null;
  season_id: string;
}

interface SetEmbed {
  name: string | null;
  sort_order: number | null;
}
interface PieceEmbed {
  label: string;
  kind: PieceKind;
  set: SetEmbed | null;
}
interface CheckoutRaw {
  id: string;
  checked_out_at: string | null;
  checked_in_at: string | null;
  assignment_id: string | null;
  piece_id: string | null;
  assignment: {
    student: { id: string; first_name: string; last_name: string } | null;
    piece: PieceEmbed | null;
  } | null;
  piece: PieceEmbed | null;
}

type CheckoutState = "pending" | "out" | "in";

interface GridRow {
  id: string;
  state: CheckoutState;
  studentId: string | null;
  primary: string; // student name (assignment) or piece label (direct)
  secondary: string; // piece label + kind
  sortKey: string;
  isDirect: boolean;
}

function stateOf(out: string | null, inn: string | null): CheckoutState {
  if (out != null && inn == null) return "out";
  if (inn != null) return "in";
  return "pending";
}

const STATE_LABEL: Record<CheckoutState, string> = {
  pending: "Not out",
  out: "Checked out",
  in: "Checked in",
};

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    competition?: string;
    seeded?: string;
    error?: string;
  }>;
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
  const { competition: competitionId, seeded, error } = await searchParams;

  const supabase = await createClient();

  // Competition selector — active season's competitions.
  let competitions: CompetitionRow[] = [];
  if (season) {
    const { data } = await supabase
      .from("competitions")
      .select("id, name, date, ensemble_id, season_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("date", { ascending: true });
    competitions = (data as CompetitionRow[] | null) ?? [];
  }
  const activeComp = competitions.find((c) => c.id === competitionId) ?? null;

  return (
    <section className="stack">
      <CostumeTabs slug={slug} active="checkout" />
      <h1>Checkout</h1>
      {!season && (
        <p className="muted">No active season — no competitions to check out for.</p>
      )}

      {seeded && <p className="alert-ok">Checkout list synced with the roster.</p>}
      {error === "toggle" && (
        <p className="alert-error">Couldn&apos;t update that row. Try again.</p>
      )}

      {season && competitions.length === 0 && (
        <p className="muted">
          No competitions this season yet. Add one under Competitions first.
        </p>
      )}

      {season && competitions.length > 0 && (
        <form
          method={canWrite ? undefined : "get"}
          action={canWrite ? seedCheckout : undefined}
          className="row-inline"
        >
          {canWrite && <input type="hidden" name="programId" value={program.id} />}
          {canWrite && <input type="hidden" name="slug" value={slug} />}
          <label>
            Competition
            <select
              name={canWrite ? "competitionId" : "competition"}
              defaultValue={competitionId ?? ""}
            >
              <option value="">Choose a competition…</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.date ? ` — ${formatDateInTz(`${c.date}T12:00:00Z`, program.timezone)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            {canWrite ? "Open & sync" : "Open"}
          </button>
        </form>
      )}

      {season && activeComp && (
        <CheckoutGrid
          slug={slug}
          programId={program.id}
          competition={activeComp}
          canWrite={canWrite}
        />
      )}
    </section>
  );
}

async function CheckoutGrid({
  slug,
  programId,
  competition,
  canWrite,
}: {
  slug: string;
  programId: string;
  competition: CompetitionRow;
  canWrite: boolean;
}) {
  const supabase = await createClient();

  const { data: checkoutData } = await supabase
    .from("costume_checkouts")
    .select(
      "id, checked_out_at, checked_in_at, assignment_id, piece_id, " +
        "assignment:costume_assignments(student:students(id, first_name, last_name), piece:costume_pieces(label, kind, set:costume_sets(name, sort_order))), " +
        "piece:costume_pieces(label, kind, set:costume_sets(name, sort_order))",
    )
    .eq("program_id", programId)
    .eq("competition_id", competition.id);
  const raw = (checkoutData as CheckoutRaw[] | null) ?? [];

  // Absent students render greyed / skipped (§4).
  const absent = new Set<string>();
  const { data: attData } = await supabase
    .from("attendance")
    .select("student_id, status")
    .eq("program_id", programId)
    .eq("competition_id", competition.id)
    .eq("status", "absent");
  for (const a of (attData as { student_id: string; status: string }[] | null) ?? []) {
    absent.add(a.student_id);
  }

  const rows: GridRow[] = raw.map((r) => {
    const isDirect = r.assignment_id == null;
    const piece = isDirect ? r.piece : r.assignment?.piece ?? null;
    const student = isDirect ? null : r.assignment?.student ?? null;
    const setName = piece?.set?.name ?? "";
    const setSort = piece?.set?.sort_order ?? 0;
    const primary = isDirect
      ? piece?.label ?? "Piece"
      : student
        ? `${student.last_name}, ${student.first_name}`
        : "(unassigned)";
    const secondary = piece
      ? `${piece.label} · ${PIECE_KIND_LABELS[piece.kind]}${setName ? ` · ${setName}` : ""}`
      : "";
    return {
      id: r.id,
      state: stateOf(r.checked_out_at, r.checked_in_at),
      studentId: student?.id ?? null,
      primary,
      secondary,
      sortKey: `${String(setSort).padStart(6, "0")}|${isDirect ? "1" : "0"}|${primary.toLowerCase()}`,
      isDirect,
    };
  });
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.state] += 1;
      return acc;
    },
    { pending: 0, out: 0, in: 0 } as Record<CheckoutState, number>,
  );

  return (
    <>
      <p className="muted">
        {competition.name}
        {competition.date ? ` · ${competition.date}` : ""} — {rows.length} items ·{" "}
        {counts.out} out · {counts.in} in · {counts.pending} not out
      </p>

      {canWrite && (
        <form action={seedCheckout}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={competition.id} />
          <button type="submit" className="secondary">
            Re-sync roster
          </button>
        </form>
      )}

      {rows.length === 0 && (
        <p className="muted">
          No checkout rows yet.
          {canWrite
            ? " Click “Re-sync roster” to seed from this competition's assignments."
            : ""}
        </p>
      )}

      <ul className="stack" style={{ width: "100%", listStyle: "none", padding: 0 }}>
        {rows.map((r) => {
          const isAbsent = r.studentId != null && absent.has(r.studentId);
          return (
            <li
              key={r.id}
              style={{
                width: "100%",
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.5rem 0.25rem",
                borderBottom: "1px solid var(--border)",
                opacity: isAbsent ? 0.45 : 1,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{r.primary}</div>
                <div className="muted">{r.secondary}</div>
              </div>
              {isAbsent ? (
                <span className="badge">absent — skipped</span>
              ) : canWrite ? (
                <form action={toggleCheckout}>
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="competitionId" value={competition.id} />
                  <input type="hidden" name="checkoutId" value={r.id} />
                  <button
                    type="submit"
                    className={r.state === "out" ? "secondary" : undefined}
                    style={{ minHeight: "3rem", minWidth: "8rem", fontSize: "1rem" }}
                  >
                    {r.state === "out" ? "Check in" : "Check out"}
                    <br />
                    <span className="muted" style={{ fontSize: "0.75rem" }}>
                      now: {STATE_LABEL[r.state]}
                    </span>
                  </button>
                </form>
              ) : (
                <span className="badge">{STATE_LABEL[r.state]}</span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="muted">{NO_HEALTH_LABEL}</p>
    </>
  );
}
