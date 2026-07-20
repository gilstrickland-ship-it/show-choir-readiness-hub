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

// Today (season-workflow redesign, "Today"/"Today Mobile" design refs) — the
// action-driven home replacing the passive card dashboard. Same lean-by-
// construction rule as before: every block renders ONLY when its flag is on
// AND the caller's role has read access, and the queries behind hidden blocks
// never run. Layout: countdown hero + comp-readiness checklist, "Needs you"
// inbox, and an aside (This week / Money glance / Last result) that stacks
// under the inbox on mobile (media queries in globals.css).

export const dynamic = "force-dynamic";

// Whole days from `now` to `target` (target in the future). Negative clamps to
// zero — a comp that started is "now", not "-2 days".
function countdownDays(target: Date, now: Date): number {
  const ms = target.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

// Weekday abbreviation ("TUE") in the program's timezone.
function weekdayAbbr(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(d)
    .toUpperCase();
}

type Tone = "ok" | "warn" | "alert";

interface ReadinessCheck {
  ok: boolean;
  tone: Tone;
  label: string;
  href: string;
  action: string;
}

interface InboxItem {
  count: number;
  tone: "accent" | "warn" | "alert";
  title: string;
  desc: string;
  href: string;
  action: string;
  primary?: boolean;
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

  // Per-block gates (flag on AND role has read access).
  const show = {
    comp: flags.competitions,
    costumes: flags.costumes && COSTUMES_ROLES.includes(role),
    shifts: flags.shifts && SHIFT_WRITE_ROLES.includes(role),
    treasury: flags.treasury && TREASURY_ROLES.includes(role),
    roster: ROSTER_ROLES.includes(role),
    absence: flags.competitions && ATTENDANCE_WRITE_ROLES.includes(role),
    digest: flags.digest && DIGEST_WRITE_ROLES.includes(role),
    results: flags.competitions,
    events: flags.events,
    packet: flags.competitions && flags.packet_parse,
  };

  // ---- Next competition (+ itinerary, attendance, comp shifts, packet) ------
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
  let compOpenSlots = 0;
  let packetStatus: string | null = null;
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

      // Volunteer shifts attached to this comp: open = needed − confirmed.
      if (show.shifts) {
        const { data: shiftRows } = await supabase
          .from("shifts")
          .select("id, needed_count")
          .eq("program_id", program.id)
          .eq("competition_id", c.id);
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
            compOpenSlots += Math.max(0, s.needed_count - (filled.get(s.id) ?? 0));
          }
        }
      }

      // Latest host-packet parse for this comp.
      if (show.packet) {
        const { data: parseRow } = await supabase
          .from("packet_parses")
          .select("status")
          .eq("program_id", program.id)
          .eq("competition_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        packetStatus = (parseRow as { status: string } | null)?.status ?? null;
      }
    }
  }

  // Countdown target: the earliest itinerary time if present, else the comp date
  // at midnight in the program's timezone.
  let daysOut: number | null = null;
  if (nextComp) {
    const target = nextComp.firstStart
      ? new Date(nextComp.firstStart)
      : nextComp.date
        ? zonedWallToUtc(`${nextComp.date}T00:00`, tz)
        : null;
    if (target && !Number.isNaN(target.getTime())) {
      daysOut = countdownDays(target, now);
    }
  }

  // ---- Comp readiness checklist ----------------------------------------------
  const readiness: ReadinessCheck[] = [];
  if (nextComp) {
    const compBase = `${base}/competitions/${nextComp.id}`;
    readiness.push({
      ok: nextComp.itinPublished === true,
      tone: nextComp.itinPublished ? "ok" : "warn",
      label:
        nextComp.itinPublished === null
          ? "No itinerary yet"
          : nextComp.itinPublished
            ? "Itinerary published"
            : "Itinerary still a draft",
      href: `${compBase}/itinerary`,
      action: nextComp.itinPublished ? "View" : "Fix",
    });
    const attendanceSeeded = nextComp.expected + nextComp.absent > 0;
    readiness.push({
      ok: attendanceSeeded,
      tone: attendanceSeeded ? "ok" : "warn",
      label: attendanceSeeded
        ? `Attendance · ${nextComp.expected} expected, ${nextComp.absent} absent`
        : "Attendance not seeded yet",
      href: `${compBase}/attendance`,
      action: "Edit",
    });
    if (show.shifts) {
      readiness.push({
        ok: compOpenSlots === 0,
        tone: compOpenSlots === 0 ? "ok" : "warn",
        label:
          compOpenSlots === 0
            ? "Volunteer shifts covered"
            : `Volunteer shifts · ${compOpenSlots} slot${compOpenSlots === 1 ? "" : "s"} open`,
        href: `${base}/comms/shifts`,
        action: compOpenSlots === 0 ? "View" : "Fill shifts",
      });
    }
    readiness.push({
      // Meals = attendance expected + partial (same rule as loadMealData);
      // only absent students are excluded.
      ok: nextComp.expected > 0,
      tone: nextComp.expected > 0 ? "ok" : "warn",
      label:
        nextComp.expected > 0
          ? `Meal count · ${nextComp.expected} meals needed (expected + partial)`
          : "Meal count · no attendance yet",
      href: `${compBase}/meals`,
      action: "View",
    });
    if (show.packet) {
      const packet: Record<string, { tone: Tone; label: string }> = {
        accepted: { tone: "ok", label: "Host packet · parse accepted" },
        review: { tone: "warn", label: "Host packet · ready to review" },
        queued: { tone: "warn", label: "Host packet · parse queued" },
        running: { tone: "warn", label: "Host packet · parse running" },
        failed: { tone: "alert", label: "Host packet · parse failed" },
      };
      const p = packetStatus ? packet[packetStatus] : null;
      readiness.push({
        ok: packetStatus === "accepted",
        tone: p?.tone ?? "warn",
        label: p?.label ?? "No host packet uploaded",
        href: `${compBase}/packet`,
        action: "Review",
      });
    }
  }
  const readinessDone = readiness.filter((c) => c.ok).length;

  // ---- Needs-you inbox --------------------------------------------------------
  const inbox: InboxItem[] = [];

  if (show.digest) {
    const { count } = await supabase
      .from("digests")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("status", "draft");
    const n = count ?? 0;
    if (n > 0) {
      inbox.push({
        count: n,
        tone: "accent",
        title: `Weekly digest draft${n === 1 ? " is" : "s"} waiting`,
        desc: "Nothing sends to parents until you approve.",
        href: `${base}/comms/digest`,
        action: "Review & send",
        primary: true,
      });
    }
  }

  if (show.absence) {
    const { count } = await supabase
      .from("absence_requests")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("status", "pending");
    const n = count ?? 0;
    if (n > 0) {
      inbox.push({
        count: n,
        tone: "alert",
        title: `Absence request${n === 1 ? "" : "s"} pending`,
        desc: "Submitted by families via their links.",
        href: `${base}/competitions/absences`,
        action: "Review",
      });
    }
  }

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
      .limit(3);
    const n = count ?? 0;
    if (n > 0) {
      const names = ((alts as
        | {
            piece: { label: string } | null;
            student: { first_name: string; last_name: string } | null;
          }[]
        | null) ?? []).map((a) => {
        const student = a.student
          ? ` (${a.student.first_name} ${a.student.last_name.charAt(0)}.)`
          : "";
        return `${a.piece?.label ?? "Piece"}${student}`;
      });
      const extra = n - names.length;
      inbox.push({
        count: n,
        tone: "warn",
        title: nextComp
          ? `Alterations open before ${nextComp.name}`
          : "Alterations open",
        desc: `${names.join(", ")}${extra > 0 ? ` + ${extra} more` : ""}`,
        href: `${base}/costumes/alterations`,
        action: "Open queue",
      });
    }
  }

  if (show.roster) {
    const { count } = await supabase
      .from("guardians")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .neq("email_status", "ok");
    const n = count ?? 0;
    if (n > 0) {
      inbox.push({
        count: n,
        tone: "warn",
        title: "Guardian emails bouncing",
        desc: `${n} guardian address${n === 1 ? " is" : "es are"} missing every announcement.`,
        href: `${base}/roster/email-issues`,
        action: "Fix addresses",
      });
    }
  }

  // ---- This week (next 7 days of events) --------------------------------------
  let week: { day: string; title: string; time: string }[] = [];
  if (show.events && seasonId) {
    const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const { data: eventRows } = await supabase
      .from("events")
      .select("title, starts_at")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizon)
      .order("starts_at", { ascending: true })
      .limit(5);
    week = ((eventRows as { title: string; starts_at: string | null }[] | null) ?? [])
      .filter((e) => e.starts_at)
      .map((e) => ({
        day: weekdayAbbr(e.starts_at as string, tz),
        title: e.title,
        time: formatTimeInTz(e.starts_at, tz),
      }));
  }

  // ---- Money glance -------------------------------------------------------------
  let balanceCents: number | null = null;
  let uncatCount = 0;
  let uncatCents = 0;
  if (show.treasury && seasonId) {
    const { data: ledger } = await supabase
      .from("ledger_entries")
      .select("direction, amount_cents, voided_at, budget_line_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId);
    const rows = (ledger as LedgerAmountRow[] | null) ?? [];
    balanceCents = sumActuals(rows).netCents;
    for (const r of rows) {
      if (!r.voided_at && r.budget_line_id == null) {
        uncatCount += 1;
        uncatCents += r.amount_cents;
      }
    }
  }

  // ---- Last result ---------------------------------------------------------------
  let lastResult: { name: string; placement: string | null; score: string | null; captions: string[] } | null = null;
  if (show.results && seasonId) {
    const { data: resRows } = await supabase
      .from("competition_results")
      .select("placement, score, captions, competition:competitions(name, date, season_id)")
      .eq("program_id", program.id)
      .order("created_at", { ascending: false })
      .limit(6);
    const r = ((resRows as
      | {
          placement: string | null;
          score: number | null;
          captions: Record<string, unknown> | null;
          competition: { name: string; season_id: string } | null;
        }[]
      | null) ?? []).find((row) => row.competition?.season_id === seasonId);
    if (r) {
      lastResult = {
        name: r.competition?.name ?? "Competition",
        placement: r.placement,
        score: r.score != null ? String(r.score) : null,
        captions: activeCaptions(r.captions),
      };
    }
  }

  const historyHref = flags.archive ? `${base}/history` : `${base}/competitions`;

  return (
    <section className="today">
      <div className="today-topline">
        <h1 className="eyebrow">Today · {formatDateInTz(now, tz)}</h1>
        <p className="muted">
          Everything below is what actually needs you. The rest can wait.
        </p>
      </div>

      {!season && (
        <p className="alert-error">
          No active season yet.{" "}
          <Link href={`${base}/settings/rollover`}>Start a season</Link> to begin.
        </p>
      )}

      {show.comp && (
        <section className="today-hero" aria-label="Next competition">
          {nextComp ? (
            <>
              <div className="today-hero-main">
                <p className="today-kicker">
                  Next competition
                  {nextComp.date
                    ? ` · ${formatDateInTz(`${nextComp.date}T12:00:00Z`, tz)}`
                    : ""}
                </p>
                <div className="today-count-row">
                  <span className="today-count">{daysOut ?? "—"}</span>
                  <span className="today-count-unit">
                    day{daysOut === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="today-comp-name">
                  <Link href={`${base}/competitions/${nextComp.id}`}>
                    {nextComp.name}
                  </Link>
                </div>
                <p className="today-hero-meta">
                  {nextComp.firstStart
                    ? `Call ${formatTimeInTz(nextComp.firstStart, tz)}`
                    : "No call time yet"}
                  {nextComp.host_school ? ` · ${nextComp.host_school}` : ""}
                </p>
                <div className="today-hero-actions">
                  <Link
                    href={`${base}/competitions/${nextComp.id}`}
                    className="button-link accent"
                  >
                    Open comp week
                  </Link>
                  <Link href={`${base}/competitions`} className="button-link secondary">
                    See full season
                  </Link>
                </div>
              </div>
              <div className="today-hero-aside">
                <div className="readiness-head">
                  <p className="today-kicker">Comp readiness</p>
                  <span className="readiness-score">
                    {readinessDone} / {readiness.length}
                  </span>
                </div>
                {readiness.map((c, i) => (
                  <div className={`readiness-row ${c.ok ? "" : c.tone}`} key={i}>
                    <span className={`status-dot ${c.tone}`} aria-hidden="true" />
                    <span className="readiness-label">{c.label}</span>
                    <Link href={c.href}>{c.action}</Link>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="today-hero-main today-hero-empty">
              <p className="today-kicker">Next competition</p>
              <p className="muted">
                No upcoming competition on the calendar.{" "}
                <Link href={`${base}/competitions`}>Add one</Link>.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="today-body">
        <div className="inbox" aria-label="Needs you">
          <h2>Needs you</h2>
          {inbox.length === 0 ? (
            <div className="all-clear">
              All clear — nothing is waiting on you today.
            </div>
          ) : (
            <div className="inbox-rows">
              {inbox.map((item, i) => (
                <div className="inbox-row" key={i}>
                  <span className={`inbox-count ${item.tone}`}>{item.count}</span>
                  <div className="inbox-copy">
                    <div className="inbox-title">{item.title}</div>
                    <div className="inbox-desc">{item.desc}</div>
                  </div>
                  <Link
                    href={item.href}
                    className={`button-link${item.primary ? "" : " secondary"}`}
                  >
                    {item.action}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="today-aside">
          {show.events && (
            <div className="aside-card">
              <h3>This week</h3>
              {week.length === 0 ? (
                <p className="muted">Nothing scheduled in the next 7 days.</p>
              ) : (
                week.map((e, i) => (
                  <div className="week-row" key={i}>
                    <span className="week-day">{e.day}</span>
                    <span className="week-title">{e.title}</span>
                    <span className="week-time">{e.time}</span>
                  </div>
                ))
              )}
              <Link className="aside-more" href={`${base}/events`}>
                Full calendar →
              </Link>
            </div>
          )}

          {show.treasury && balanceCents != null && (
            <div className="aside-card">
              <h3>Money glance</h3>
              <div className="aside-metric">{formatCents(balanceCents)}</div>
              <div className="aside-note">
                In minus out this season · voids excluded
              </div>
              {uncatCount > 0 && (
                <div>
                  <span className="chip warn">
                    {uncatCount} uncategorized · {formatCents(uncatCents)}
                  </span>
                </div>
              )}
              <Link className="aside-more" href={`${base}/treasury`}>
                Open ledger →
              </Link>
            </div>
          )}

          {lastResult && (
            <div className="aside-card accent-top">
              <h3>Last result</h3>
              <div className="aside-metric accent">
                {lastResult.placement ?? "Recorded"}
              </div>
              <div className="aside-note">
                {lastResult.name}
                {lastResult.score ? ` · Score ${lastResult.score}` : ""}
                {lastResult.captions.length > 0
                  ? ` · ${lastResult.captions.join(", ")}`
                  : ""}
              </div>
              <Link className="aside-more" href={historyHref}>
                Trophy case →
              </Link>
            </div>
          )}
        </aside>
      </section>
    </section>
  );
}
