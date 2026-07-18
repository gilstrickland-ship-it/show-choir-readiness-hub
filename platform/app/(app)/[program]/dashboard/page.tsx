import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import {
  ROSTER_ROLES,
  COSTUMES_ROLES,
  TREASURY_ROLES,
} from "@/lib/nav";
import { ATTENDANCE_WRITE_ROLES, activeCaptions } from "@/lib/competitions";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { DIGEST_WRITE_ROLES } from "@/lib/comms";
import { OPEN_ALTERATION_STATUSES } from "@/lib/costumes";
import { formatCents, sumActuals, type LedgerAmountRow } from "@/lib/treasury";
import {
  zonedWallToUtc,
  formatDateInTz,
  formatTimeInTz,
} from "@/lib/datetime";

// Dashboard (T027) — the season overview. Each card links to its module and is
// rendered ONLY when its flag is on AND the caller's role has read access; the
// queries behind hidden cards never run (lean by construction). Counts use
// head:true where only a number is needed.

export const dynamic = "force-dynamic";

// Whole days + hours from `now` to `target` (target in the future). Negative
// clamps to zero — a comp that started is "now", not "-2 days".
function countdown(target: Date, now: Date): { days: number; hours: number } {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return { days: 0, hours: 0 };
  return {
    days: Math.floor(ms / 86_400_000),
    hours: Math.floor((ms % 86_400_000) / 3_600_000),
  };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);
  const supabase = await createClient();
  const now = new Date();
  const tz = program.timezone;

  const seasonId = season?.id ?? null;
  const base = `/${slug}`;

  // Per-card gates (flag on AND role has read access).
  const show = {
    comp: flags.competitions,
    costumes: flags.costumes && COSTUMES_ROLES.includes(role),
    shifts: flags.shifts && SHIFT_WRITE_ROLES.includes(role),
    treasury: flags.treasury && TREASURY_ROLES.includes(role),
    roster: ROSTER_ROLES.includes(role),
    absence: flags.competitions && ATTENDANCE_WRITE_ROLES.includes(role),
    digest: flags.digest && DIGEST_WRITE_ROLES.includes(role),
    results: flags.competitions,
  };

  const todayKey = formatDateInTz(now, tz); // for display only

  // ---- Next competition (+ itinerary status + attendance) -------------------
  interface NextComp {
    id: string;
    name: string;
    date: string | null;
    host_school: string | null;
    itinPublished: boolean | null;
    firstStart: string | null;
    expected: number;
    absent: number;
  }
  let nextComp: NextComp | null = null;
  if (show.comp && seasonId) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: compRow } = await supabase
      .from("competitions")
      .select("id, name, date, host_school")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .gte("date", todayStr)
      .in("status", ["planned", "confirmed"])
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    const c = compRow as
      | { id: string; name: string; date: string | null; host_school: string | null }
      | null;
    if (c) {
      const { data: itin } = await supabase
        .from("itineraries")
        .select("id, status")
        .eq("program_id", program.id)
        .eq("competition_id", c.id)
        .maybeSingle();
      const itinRow = itin as { id: string; status: string } | null;
      let firstStart: string | null = null;
      if (itinRow) {
        const { data: firstItem } = await supabase
          .from("itinerary_items")
          .select("starts_at")
          .eq("itinerary_id", itinRow.id)
          .not("starts_at", "is", null)
          .order("starts_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstStart = (firstItem as { starts_at: string | null } | null)?.starts_at ?? null;
      }
      const [{ count: expected }, { count: absent }] = await Promise.all([
        supabase
          .from("attendance")
          .select("id", { count: "exact", head: true })
          .eq("program_id", program.id)
          .eq("competition_id", c.id)
          .in("status", ["expected", "partial"]),
        supabase
          .from("attendance")
          .select("id", { count: "exact", head: true })
          .eq("program_id", program.id)
          .eq("competition_id", c.id)
          .eq("status", "absent"),
      ]);
      nextComp = {
        ...c,
        itinPublished: itinRow ? itinRow.status === "published" : null,
        firstStart,
        expected: expected ?? 0,
        absent: absent ?? 0,
      };
    }
  }

  // Countdown target: the earliest itinerary time if present, else the comp date
  // at midnight in the program's timezone.
  let countdownParts: { days: number; hours: number } | null = null;
  if (nextComp) {
    const target = nextComp.firstStart
      ? new Date(nextComp.firstStart)
      : nextComp.date
        ? zonedWallToUtc(`${nextComp.date}T00:00`, tz)
        : null;
    if (target && !Number.isNaN(target.getTime())) {
      countdownParts = countdown(target, now);
    }
  }

  // ---- Alterations queue ----------------------------------------------------
  let altCount = 0;
  let altTop: { label: string; student: string; status: string }[] = [];
  if (show.costumes && seasonId) {
    const { data: alts, count } = await supabase
      .from("costume_assignments")
      .select(
        "id, alteration_status, piece:costume_pieces(label), student:students(first_name, last_name)",
        { count: "exact" },
      )
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .in("alteration_status", OPEN_ALTERATION_STATUSES as unknown as string[])
      .limit(5);
    altCount = count ?? 0;
    altTop = ((alts as
      | {
          alteration_status: string;
          piece: { label: string } | null;
          student: { first_name: string; last_name: string } | null;
        }[]
      | null) ?? []).map((a) => ({
      label: a.piece?.label ?? "Piece",
      student: a.student ? `${a.student.first_name} ${a.student.last_name}` : "—",
      status: a.alteration_status,
    }));
  }

  // ---- Open shifts (next 14 days) -------------------------------------------
  let openShiftCount = 0;
  let openSlots = 0;
  if (show.shifts && seasonId) {
    const horizon = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    const { data: shiftRows } = await supabase
      .from("shifts")
      .select("id, needed_count, starts_at")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizon);
    const shifts = (shiftRows as { id: string; needed_count: number }[] | null) ?? [];
    if (shifts.length > 0) {
      const { data: signupRows } = await supabase
        .from("shift_signups")
        .select("shift_id")
        .eq("program_id", program.id)
        .eq("status", "confirmed")
        .in("shift_id", shifts.map((s) => s.id));
      const filled = new Map<string, number>();
      for (const su of (signupRows as { shift_id: string }[] | null) ?? []) {
        filled.set(su.shift_id, (filled.get(su.shift_id) ?? 0) + 1);
      }
      for (const s of shifts) {
        const open = s.needed_count - (filled.get(s.id) ?? 0);
        if (open > 0) {
          openShiftCount += 1;
          openSlots += open;
        }
      }
    }
  }

  // ---- Treasury balance -----------------------------------------------------
  let balanceCents: number | null = null;
  if (show.treasury && seasonId) {
    const { data: ledger } = await supabase
      .from("ledger_entries")
      .select("direction, amount_cents, voided_at, budget_line_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId);
    balanceCents = sumActuals((ledger as LedgerAmountRow[] | null) ?? []).netCents;
  }

  // ---- Bounced guardian emails ----------------------------------------------
  let bounceCount = 0;
  if (show.roster) {
    const { count } = await supabase
      .from("guardians")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .neq("email_status", "ok");
    bounceCount = count ?? 0;
  }

  // ---- Pending absence requests ---------------------------------------------
  let pendingAbsences = 0;
  if (show.absence) {
    const { count } = await supabase
      .from("absence_requests")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("status", "pending");
    pendingAbsences = count ?? 0;
  }

  // ---- Digest awaiting approval ---------------------------------------------
  let digestDraftCount = 0;
  if (show.digest) {
    const { count } = await supabase
      .from("digests")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("status", "draft");
    digestDraftCount = count ?? 0;
  }

  // ---- Recent results strip -------------------------------------------------
  let results: { name: string; placement: string | null; score: string | null; captions: string[] }[] = [];
  if (show.results && seasonId) {
    const { data: resRows } = await supabase
      .from("competition_results")
      .select("placement, score, captions, competition:competitions(name, date, season_id)")
      .eq("program_id", program.id)
      .order("created_at", { ascending: false })
      .limit(6);
    results = ((resRows as
      | {
          placement: string | null;
          score: number | null;
          captions: Record<string, unknown> | null;
          competition: { name: string; season_id: string } | null;
        }[]
      | null) ?? [])
      .filter((r) => r.competition?.season_id === seasonId)
      .map((r) => ({
        name: r.competition?.name ?? "Competition",
        placement: r.placement,
        score: r.score != null ? String(r.score) : null,
        captions: activeCaptions(r.captions),
      }));
  }

  const historyHref = flags.archive ? `${base}/history` : `${base}/competitions`;

  return (
    <section className="stack">
      <h1>Dashboard</h1>
      <p className="muted">
        {program.name}
        {season ? ` · ${season.label}` : " · no active season"} · {todayKey}
      </p>

      {!season && (
        <p className="alert-error">
          No active season yet.{" "}
          <Link href={`${base}/settings/rollover`}>Start a season</Link> to begin.
        </p>
      )}

      {show.digest && digestDraftCount > 0 && (
        <p className="alert-error">
          {digestDraftCount} weekly digest{digestDraftCount === 1 ? "" : "s"}{" "}
          awaiting your review. Nothing sends to parents until you approve.{" "}
          <Link href={`${base}/comms/digest`}>Review now</Link>.
        </p>
      )}

      <div className="card-grid">
        {/* Next competition */}
        {show.comp && (
          <div className="card">
            <h2>Next competition</h2>
            {nextComp ? (
              <>
                <div className="metric">
                  {countdownParts
                    ? `${countdownParts.days}d ${countdownParts.hours}h`
                    : "—"}
                </div>
                <div>
                  <Link href={`${base}/competitions/${nextComp.id}`}>
                    {nextComp.name}
                  </Link>
                </div>
                <div className="muted">
                  {formatDateInTz(
                    nextComp.firstStart ??
                      (nextComp.date ? `${nextComp.date}T12:00:00Z` : null),
                    tz,
                  )}
                  {nextComp.firstStart
                    ? ` · call ${formatTimeInTz(nextComp.firstStart, tz)}`
                    : ""}
                </div>
                <div>
                  <span
                    className={`chip ${nextComp.itinPublished ? "" : "danger"}`}
                  >
                    {nextComp.itinPublished === null
                      ? "No itinerary"
                      : nextComp.itinPublished
                        ? "Itinerary published"
                        : "Itinerary draft"}
                  </span>
                </div>
                <div className="muted">
                  {nextComp.expected} expected · {nextComp.absent} absent
                </div>
              </>
            ) : (
              <p className="muted">
                No upcoming competition.{" "}
                <Link href={`${base}/competitions`}>Add one</Link>.
              </p>
            )}
          </div>
        )}

        {/* Alterations queue */}
        {show.costumes && (
          <div className={`card ${altCount > 0 ? "attention" : ""}`}>
            <h2>Alterations queue</h2>
            <div className="metric">{altCount}</div>
            {altTop.length > 0 ? (
              <ul className="muted" style={{ margin: 0, paddingLeft: "1rem" }}>
                {altTop.map((a, i) => (
                  <li key={i}>
                    {a.label} — {a.student} ({a.status.replace("_", " ")})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing open. Nicely done.</p>
            )}
            <Link href={`${base}/costumes/alterations`}>Open alterations</Link>
          </div>
        )}

        {/* Open shifts */}
        {show.shifts && (
          <div className="card">
            <h2>Open shifts (14 days)</h2>
            <div className="metric">{openSlots}</div>
            <div className="muted">
              {openShiftCount} shift{openShiftCount === 1 ? "" : "s"} needing
              volunteers
            </div>
            <Link href={`${base}/comms/shifts`}>Manage shifts</Link>
          </div>
        )}

        {/* Treasury balance */}
        {show.treasury && (
          <div className="card">
            <h2>Treasury balance</h2>
            <div className="metric">
              {balanceCents != null ? formatCents(balanceCents) : "—"}
            </div>
            <div className="muted">In minus out, this season (voids excluded).</div>
            <Link href={`${base}/treasury`}>Open ledger</Link>
          </div>
        )}

        {/* Bounced emails */}
        {show.roster && (
          <div className={`card ${bounceCount > 0 ? "attention" : ""}`}>
            <h2>Email health</h2>
            <div className="metric">{bounceCount}</div>
            <div className="muted">
              {bounceCount === 0
                ? "All guardian emails delivering."
                : `guardian email${bounceCount === 1 ? "" : "s"} bounced or unsubscribed`}
            </div>
            {bounceCount > 0 && (
              <Link href={`${base}/roster/email-issues`}>Fix addresses</Link>
            )}
          </div>
        )}

        {/* Pending absence requests */}
        {show.absence && (
          <div className={`card ${pendingAbsences > 0 ? "attention" : ""}`}>
            <h2>Absence requests</h2>
            <div className="metric">{pendingAbsences}</div>
            <div className="muted">
              {pendingAbsences === 0
                ? "No requests waiting."
                : `pending parent request${pendingAbsences === 1 ? "" : "s"} to review`}
            </div>
            {pendingAbsences > 0 && (
              <Link href={`${base}/competitions/absences`}>Review queue</Link>
            )}
          </div>
        )}
      </div>

      {/* Recent results strip */}
      {show.results && results.length > 0 && (
        <div className="stack" style={{ width: "100%" }}>
          <h2>Recent results</h2>
          <div className="card-grid">
            {results.map((r, i) => (
              <div className="card" key={i}>
                <h2>{r.name}</h2>
                <div className="metric" style={{ fontSize: "1.1rem" }}>
                  {r.placement ?? "Recorded"}
                </div>
                {r.score && <div className="muted">Score {r.score}</div>}
                {r.captions.length > 0 && (
                  <div>
                    {r.captions.map((c) => (
                      <span className="chip" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Link href={historyHref}>See the trophy case</Link>
        </div>
      )}
    </section>
  );
}
