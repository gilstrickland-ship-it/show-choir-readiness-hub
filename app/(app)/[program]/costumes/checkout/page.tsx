import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import { COSTUME_WRITE_ROLES, PIECE_KIND_LABELS, type PieceKind } from "@/lib/costumes";
import { formatDateInTz } from "@/lib/datetime";
import { SubTabs } from "../../SubTabs";
import { costumeTabs } from "@/lib/subnav";
import { CheckoutList, type CheckoutRow, type CheckoutState } from "./CheckoutList";
import { seedCheckout } from "./actions";

// Per-competition checkout — comp day. Rows are seeded idempotently when a
// writer opens a competition, then flipped one tap at a time.
//
// The quick-change sheet hangs off this tab (spec 005 US13): it is the sheet you
// print on the way out the door, not a place you go to do something, so it lives
// where comp day starts rather than as a sixth tab nobody opened in September.

interface CompetitionRow {
  id: string;
  name: string;
  date: string | null;
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

const ERR: Record<string, string> = {
  toggle: "Couldn't update that row. Try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(ERR, code) ? ERR[code] : null;
}

function stateOf(out: string | null, inn: string | null): CheckoutState {
  if (out != null && inn == null) return "out";
  if (inn != null) return "in";
  return "pending";
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param, so every read goes through
  // `one()` — a hand-typed URL must not 500 the page or smuggle an array into a
  // query filter.
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
  const competitionId = one("competition");
  const error = message(one("error"));

  const supabase = await createClient();

  // Competition selector — active season's competitions.
  let competitions: CompetitionRow[] = [];
  if (season) {
    const { data } = await supabase
      .from("competitions")
      .select("id, name, date, season_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("date", { ascending: true });
    competitions = (data as CompetitionRow[] | null) ?? [];
  }
  const activeComp = competitions.find((c) => c.id === competitionId) ?? null;

  const quickChangeHref = activeComp
    ? `/${slug}/costumes/quick-change?competition=${activeComp.id}`
    : `/${slug}/costumes/quick-change`;

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            {season ? season.label : "No active season"} · comp day
          </p>
          <h1 className="page-h1">Checkout</h1>
        </div>
      </div>

      <SubTabs strip={costumeTabs(slug, "checkout")} />

      {!season && (
        <p className="muted">No active season — no competitions to check out for.</p>
      )}

      {one("seeded") && <p className="alert-ok">Checkout list synced with the roster.</p>}
      {error && <p className="alert-error">{error}</p>}

      {season && competitions.length === 0 && (
        <p className="muted">
          No competitions this season yet. Add one under Competitions first.
        </p>
      )}

      {season && competitions.length > 0 && (
        <form
          method={canWrite ? undefined : "get"}
          action={canWrite ? seedCheckout : undefined}
          className="row-inline wardrobe-filters"
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

      <p className="muted">
        <Link href={quickChangeHref}>Quick change sheet →</Link> — what each
        student takes off and puts on between numbers. Print it for the wings.
      </p>

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

  const rows: CheckoutRow[] = raw.map((r) => {
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
        {competition.name} — {rows.length} item{rows.length === 1 ? "" : "s"} ·{" "}
        {counts.out} out · {counts.in} back · {counts.pending} not out yet
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

      {rows.length === 0 ? (
        <p className="muted">
          Nothing to hand out yet.
          {canWrite
            ? " Press “Re-sync roster” to build the list from this competition's assignments."
            : ""}
        </p>
      ) : (
        <CheckoutList
          programId={programId}
          slug={slug}
          competitionId={competition.id}
          rows={rows}
          absent={absent}
          canWrite={canWrite}
        />
      )}
    </>
  );
}
