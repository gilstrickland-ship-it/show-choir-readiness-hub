import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import {
  ROSTER_ROLES,
  COSTUMES_ROLES,
  TREASURY_ROLES,
} from "@/lib/nav";
import {
  ATTENDANCE_WRITE_ROLES,
  COMPETITION_WRITE_ROLES,
  activeCaptions,
} from "@/lib/competitions";
import { DIGEST_WRITE_ROLES } from "@/lib/comms";
import { OPEN_ALTERATION_STATUSES } from "@/lib/costumes";
import { loadGuideState, loadJourneyPanel } from "@/lib/guide";
import { JourneyPanel } from "../JourneyPanel";
import { StartSeasonCard } from "../StartSeasonCard";
import {
  COMMITMENT_CREATE_ROLES,
  commitmentTotalsFromRow,
  formatCents,
  seasonTotalsFromRow,
} from "@/lib/treasury";
import { loadCompReadiness, type ReadinessCheck } from "@/lib/readiness";
import {
  zonedWallToUtc,
  zonedDateKey,
  formatDateInTz,
  formatTimeInTz,
  calendarDaysBetween,
} from "@/lib/datetime";

// Today (season-workflow redesign, "Today"/"Today Mobile" design refs) — the
// action-driven home replacing the passive card dashboard. Same lean-by-
// construction rule as before: every block renders ONLY when its flag is on
// AND the caller's role has read access, and the queries behind hidden blocks
// never run. Layout: countdown hero + comp-readiness checklist, "Needs you"
// inbox, and an aside (This week / Money glance / Last result) that stacks
// under the inbox on mobile (media queries in globals.css).

export const dynamic = "force-dynamic";

// Weekday abbreviation ("TUE") in the program's timezone.
function weekdayAbbr(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(d)
    .toUpperCase();
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
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const sp = await searchParams;
  const { program, role, season, flags, membership, isSupport } =
    await getTenantContext(slug);
  const supabase = await createClient();
  const now = new Date();
  const tz = program.timezone;

  const seasonId = season?.id ?? null;
  const base = `/${slug}`;

  // Per-block gates (flag on AND role has read access). The comp-readiness
  // block's own shift/packet sub-gates live inside loadCompReadiness.
  //
  // A gate here is a promise about a DESTINATION, so it has to be the gate the
  // destination actually enforces (spec 005 T160). /comms/digest 404s on the
  // `comms` flag, not on `digest` — a program with the weekly digest overridden
  // on and the comms surface off got an inbox row whose "Review & send" was a
  // 404. Both flags, the same pair lib/readiness already requires for the
  // shifts check and lib/guide for the announcement step.
  const show = {
    comp: flags.competitions,
    costumes: flags.costumes && COSTUMES_ROLES.includes(role),
    treasury: flags.treasury && TREASURY_ROLES.includes(role),
    roster: ROSTER_ROLES.includes(role),
    absence: flags.competitions && ATTENDANCE_WRITE_ROLES.includes(role),
    digest: flags.comms && flags.digest && DIGEST_WRITE_ROLES.includes(role),
    results: flags.competitions,
    events: flags.events,
  };
  // Who may CREATE a competition — the empty hero offers a way to add one, and
  // adding is Season's job since Wave 1 (US1/P6), so a reader is offered
  // nothing rather than a drawer with no section in it.
  const canAddComp = flags.competitions && COMPETITION_WRITE_ROLES.includes(role);

  // ---- Next competition + comp-week readiness (shared helper) ---------------
  interface NextComp {
    id: string;
    name: string;
    date: string | null;
    host_school: string | null;
    firstStart: string | null;
  }
  let nextComp: NextComp | null = null;
  let readiness: ReadinessCheck[] = [];
  let readinessDone = 0;
  let readinessTotal = 0;
  if (show.comp && seasonId) {
    // TODAY IS THE PROGRAM'S TODAY. `competitions.date` is a plain calendar day,
    // so the key it is compared against has to be the day it IS in the program's
    // timezone — not in UTC. In Central, every evening after 6pm a UTC key reads
    // as tomorrow, which walked the program's own competition off its home page
    // on the evening before it (Wave 14 fixed this on the parent routes).
    const todayStr = zonedDateKey(now, tz);
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
      const compReadiness = await loadCompReadiness(supabase, {
        programId: program.id,
        comp: c,
        flags,
        role,
        base,
      });
      nextComp = { ...c, firstStart: compReadiness.firstStart };
      readiness = compReadiness.checks;
      readinessDone = compReadiness.done;
      readinessTotal = compReadiness.total;
    }
  }

  // ---- First-use guide journey panel (spec 003 §2) ---------------------------
  // The role-shaped journey panel ABSORBS the Wave-D setup guide: the director/
  // admin journey's first four steps are the old setup milestones (its heading
  // "Set up your program" + step-1 link "Start your season" preserve the
  // onboarding e2e contract). loadJourneyPanel is lean-by-construction: it runs
  // ZERO queries when dismissed, and for task journeys checks only the terminal
  // verifier first — an established program that reached the last milestone pays
  // for one head-count and nothing more. A "full" task panel `takes over` the
  // Today body exactly as the old setup guide did; a "pill" or re-opened panel
  // sits above the normal Today content. Support views (no membership row) never
  // see the panel.
  const forceOpen = sp.guide === "open";
  const guidePanel =
    flags.guide && !isSupport && membership.user_id
      ? await loadJourneyPanel(supabase, {
          role,
          flags,
          programId: program.id,
          seasonId,
          slug,
          guideState: await loadGuideState(supabase, program.id, membership.user_id),
          forceOpen,
        })
      : null;
  const takeover = guidePanel?.takeover ?? false;

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
      daysOut = calendarDaysBetween(now, target, tz);
    }
  }

  // ---- Comp-week hallway shortcuts (mobile only) ------------------------------
  // In the last week before a competition the phone-first hallway jobs — taking
  // attendance, checking out costumes, quick-change lists — are what a director
  // reaches for. Surface them as big tap targets on Today, but only within 7
  // days and only for the flag+role gates the page already computed. CSS hides
  // this row on desktop, where the full nav is one click away anyway.
  const compWeekShortcuts =
    nextComp && daysOut !== null && daysOut <= 7
      ? [
          show.comp && {
            href: `${base}/competitions/${nextComp.id}/attendance`,
            label: "Attendance",
          },
          show.costumes && {
            href: `${base}/costumes/checkout`,
            label: "Costume checkout",
          },
          show.costumes && {
            href: `${base}/costumes/quick-change`,
            label: "Quick change",
          },
        ].filter(Boolean as unknown as (v: unknown) => v is { href: string; label: string })
      : [];

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
        // The queue IS the Wardrobe landing; /costumes/alterations was a route
        // that only redirected here, and it went with Wave W.
        href: `${base}/costumes`,
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

  // Open commitments whose need-by has already passed (spec 006 R7). An open
  // purchase order from a date that has gone by is money held out of the budget
  // for something that may never happen, and it is a NAMED audit finding — a
  // prior year's open POs are the first thing an auditor lists.
  //
  // NOTHING HERE CLOSES ANYTHING. Closing releases the remainder back to a
  // budget line, and a balance that re-inflates on its own hides under-delivery;
  // an explicit release is the moment the director learns what the number meant.
  //
  // The seat gate is the seats that can DO something: a treasurer closes it, and
  // a director or admin is who chases the vendor or restates the amount. A board
  // member reads the same count on the board snapshot instead.
  if (
    flags.treasury &&
    COMMITMENT_CREATE_ROLES.includes(role) &&
    !isSupport &&
    seasonId
  ) {
    // The same SQL aggregate the commitments page and the board snapshot read
    // (0021), so the three cannot disagree about how many are overdue. A failed
    // read leaves the row out entirely rather than claiming "0 overdue".
    const { data, error } = await supabase.rpc("commitment_totals", {
      p_program_id: program.id,
      p_season_id: seasonId,
    });
    const totals = error
      ? null
      : commitmentTotalsFromRow(Array.isArray(data) ? data[0] : data);
    const n = totals?.staleCount ?? 0;
    if (n > 0) {
      inbox.push({
        count: n,
        tone: "warn",
        title: `Commitment${n === 1 ? "" : "s"} past the date ${n === 1 ? "it was" : "they were"} needed`,
        desc: "Still holding money out of the budget. Close each one to release what is left, or restate it.",
        href: `${base}/treasury/commitments`,
        action: "Review",
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
    // One SQL aggregate (0019), not a sum over a fetched row list: PostgREST
    // caps a response at 1000 rows, so the old fetch quietly turned "Balance"
    // into "balance of the first thousand entries" on a busy season. A failed
    // read leaves this null, and the card renders "—" rather than "$0.00".
    const { data, error } = await supabase.rpc("ledger_season_totals", {
      p_program_id: program.id,
      p_season_id: seasonId,
    });
    const totals = error
      ? null
      : seasonTotalsFromRow(Array.isArray(data) ? data[0] : data);
    if (totals) {
      balanceCents = totals.netCents;
      uncatCount = totals.uncategorizedCount;
      uncatCents = totals.uncategorizedCents;
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

      {guidePanel && (
        <JourneyPanel model={guidePanel} programId={program.id} />
      )}

      {!takeover && (
        <>
      {!season && (
        <StartSeasonCard
          slug={slug}
          programId={program.id}
          role={role}
          timezone={tz}
          from="dashboard"
          error={typeof sp.seasonError === "string" ? sp.seasonError : null}
        />
      )}

      {sp.seasonStarted && season && (
        <p className="alert-ok">{season.label} is now your active season.</p>
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
                  <Link href={`${base}/season`} className="button-link secondary">
                    See full season
                  </Link>
                </div>
              </div>
              <div className="today-hero-aside">
                <div className="readiness-head">
                  <p className="today-kicker">Comp readiness</p>
                  <span className="readiness-score">
                    {readinessDone} / {readinessTotal}
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
                {canAddComp && (
                  <>
                    <Link href={`${base}/season?add=comp`}>Add one</Link> on
                    Season.
                  </>
                )}
              </p>
            </div>
          )}
        </section>
      )}

      {compWeekShortcuts.length > 0 && (
        <nav className="comp-week-shortcuts" aria-label="Comp week shortcuts">
          <p className="comp-week-title">Comp week — quick access</p>
          <div className="comp-week-row">
            {compWeekShortcuts.map((s) => (
              <Link key={s.href} href={s.href} className="comp-week-tap">
                {s.label}
              </Link>
            ))}
          </div>
        </nav>
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
                Money in minus money out this season (corrected entries excluded)
              </div>
              {uncatCount > 0 && (
                <div>
                  <span className="chip warn">
                    {uncatCount} {uncatCount === 1 ? "entry needs" : "entries need"} a
                    category · {formatCents(uncatCents)}
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
        </>
      )}
    </section>
  );
}
