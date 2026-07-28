import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeInTz } from "@/lib/datetime";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  formatCents,
  lineActualsFromRows,
  seasonTotalsFromRow,
  totalForLine,
  monthKeyForDate,
  reconciledThroughMonth,
  formatMonthKey,
  UNCATEGORIZED_KEY,
  CATEGORY_DIRECTION_LABELS,
  type CategoryDirection,
  type LineActual,
  type LedgerSeasonTotals,
} from "@/lib/treasury";
import { TreasuryTabs } from "../TreasuryTabs";

// Reports (T020): per-event cost report (competition or trip → income/expense/
// net + line breakdown) and a read-only board-snapshot data page (totals,
// category rollups, uncategorized note, as-of stamp) that links to the P5 PDF
// at /api/pdf/board-snapshot?season=... . Read-only; no writes.
//
// Every number here is a SQL aggregate (0019), not a sum over a fetched entry
// list. This is the page a treasurer reads to a board from, so it is the last
// place that may quietly stop at PostgREST's 1000-row cap. The per-event report
// asks for one event's aggregate instead of pulling the season and filtering it
// in memory.

interface CatRow {
  id: string;
  name: string;
  direction: CategoryDirection;
}
interface LineRow {
  id: string;
  category_id: string;
  name: string;
}
interface NamedRow {
  id: string;
  name: string;
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?event=a&event=b), so the
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Money" role={role} allowed={TREASURY_ROLES} />
    );
  }
  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };
  const event = one("event");

  const supabase = await createClient();

  let cats: CatRow[] = [];
  let lines: LineRow[] = [];
  let comps: NamedRow[] = [];
  let trips: NamedRow[] = [];
  let seasonByLine = new Map<string, LineActual>();
  let totals: LedgerSeasonTotals | null = null;
  // The per-line aggregate can fail on its own, and it used to fail SILENTLY:
  // its error collapsed into an empty map while the only banner keyed on the
  // OTHER rpc, so a board snapshot could print $0.00 actuals for every category
  // beside real budgeted figures — the exact shape of number a board acts on.
  let actualsUnavailable = false;
  let eventActualsUnavailable = false;

  if (season) {
    const [{ data: budget }, { data: compData }, { data: tripData }, lineRes, totalsRes] =
      await Promise.all([
        supabase
          .from("budgets")
          .select("id, name")
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("status", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("competitions")
          .select("id, name")
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("date", { ascending: false }),
        supabase
          .from("trips")
          .select("id, name")
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("starts_on", { ascending: false }),
        supabase.rpc("ledger_line_actuals", {
          p_program_id: program.id,
          p_season_id: season.id,
        }),
        supabase.rpc("ledger_season_totals", {
          p_program_id: program.id,
          p_season_id: season.id,
        }),
      ]);

    const b = budget as { id: string; name: string } | null;
    comps = (compData as NamedRow[] | null) ?? [];
    trips = (tripData as NamedRow[] | null) ?? [];
    actualsUnavailable = !!lineRes.error;
    seasonByLine = lineRes.error ? new Map() : lineActualsFromRows(lineRes.data);
    const totalsRow = Array.isArray(totalsRes.data)
      ? totalsRes.data[0]
      : totalsRes.data;
    totals = totalsRes.error ? null : seasonTotalsFromRow(totalsRow);

    if (b) {
      const { data: catData } = await supabase
        .from("budget_categories")
        .select("id, name, direction")
        .eq("program_id", program.id)
        .eq("budget_id", b.id)
        .order("direction", { ascending: true })
        .order("sort_order", { ascending: true });
      cats = (catData as CatRow[] | null) ?? [];
      if (cats.length > 0) {
        const { data: lineData } = await supabase
          .from("budget_lines")
          .select("id, category_id, name")
          .eq("program_id", program.id)
          .in(
            "category_id",
            cats.map((c) => c.id),
          );
        lines = (lineData as LineRow[] | null) ?? [];
      }
    }
  }

  const lineName = new Map(lines.map((l) => [l.id, l.name]));
  const lineCat = new Map(lines.map((l) => [l.id, l.category_id]));

  // ---- Board snapshot rollups ----------------------------------------------
  // Category rollup = every cent booked to that category's lines, both
  // directions, which is what the board reads as "what this category cost/
  // brought in". Uncategorized comes back as its own bucket from the aggregate.
  const catActual = new Map<string, number>();
  for (const [lineId, actual] of seasonByLine) {
    if (lineId === UNCATEGORIZED_KEY) continue;
    const catId = lineCat.get(lineId);
    if (!catId) continue;
    catActual.set(catId, (catActual.get(catId) ?? 0) + totalForLine(actual));
  }
  const uncategorizedCount = totals?.uncategorizedCount ?? 0;
  const uncategorizedTotal = totals?.uncategorizedCents ?? 0;
  const asOf = formatDateTimeInTz(new Date(), program.timezone);

  // "Reconciled through" (Wave L): the latest contiguous month whose books were
  // checked against the bank statement. The month list is void-free by
  // construction (the aggregate excludes voided rows).
  const monthsWithEntries = totals?.months ?? [];
  let reconciledThroughLabel: string | null = null;
  if (season && monthsWithEntries.length > 0) {
    const { data: recRows } = await supabase
      .from("ledger_reconciliations")
      .select("month")
      .eq("program_id", program.id);
    const reconciledKeys = ((recRows as { month: string }[] | null) ?? [])
      .map((r) => monthKeyForDate(r.month))
      .filter((k): k is string => k !== null);
    const through = reconciledThroughMonth(monthsWithEntries, reconciledKeys);
    reconciledThroughLabel = through ? formatMonthKey(through) : null;
  }

  // ---- Per-event cost report ------------------------------------------------
  const kind = event?.startsWith("comp:")
    ? "comp"
    : event?.startsWith("trip:")
      ? "trip"
      : null;
  const eventId = kind ? event!.slice(5) : null;
  const eventName = kind
    ? kind === "comp"
      ? (comps.find((c) => c.id === eventId)?.name ?? null)
      : (trips.find((t) => t.id === eventId)?.name ?? null)
    : null;

  // One aggregate scoped to the chosen event — asked for only when an event is
  // chosen, and grouped by budget line so the breakdown and the totals are the
  // same numbers by construction.
  let eventByLine = new Map<string, LineActual>();
  if (season && eventId && kind) {
    const { data, error } = await supabase.rpc("ledger_line_actuals", {
      p_program_id: program.id,
      p_season_id: season.id,
      p_competition_id: kind === "comp" ? eventId : null,
      p_trip_id: kind === "trip" ? eventId : null,
    });
    eventActualsUnavailable = !!error;
    if (!error) eventByLine = lineActualsFromRows(data);
  }
  const eventTotals = { inCents: 0, outCents: 0, netCents: 0 };
  for (const actual of eventByLine.values()) {
    eventTotals.inCents += actual.inCents;
    eventTotals.outCents += actual.outCents;
  }
  eventTotals.netCents = eventTotals.inCents - eventTotals.outCents;

  return (
    <section className="stack">
      <TreasuryTabs slug={slug} active="reports" />
      <h1>Reports</h1>

      {!season && <p className="alert-error">No active season.</p>}

      {season && (
        <>
          {/* Per-event cost report */}
          <div className="stack">
            <h2>Per-event cost report</h2>
            <p className="muted">
              What a competition or trip actually cost — income, expense, and net
              for every entry tagged to it.
            </p>
            <form method="get" className="row-inline">
              <label>
                Event
                <select name="event" defaultValue={event ?? ""}>
                  <option value="">Choose a competition or trip…</option>
                  {comps.length > 0 && (
                    <optgroup label="Competitions">
                      {comps.map((c) => (
                        <option key={c.id} value={`comp:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {trips.length > 0 && (
                    <optgroup label="Trips">
                      {trips.map((t) => (
                        <option key={t.id} value={`trip:${t.id}`}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <button type="submit" className="secondary">
                Run
              </button>
            </form>

            {eventId && eventName && eventActualsUnavailable && (
              <p className="alert-error">
                What this event cost could not be read just now. Nothing is shown
                rather than zeros — reload to try again.
              </p>
            )}

            {eventId && eventName && !eventActualsUnavailable && (
              <div className="stack">
                <dl className="detail-list">
                  <dt>Event</dt>
                  <dd>{eventName}</dd>
                  <dt>Income</dt>
                  <dd className="num">{formatCents(eventTotals.inCents)}</dd>
                  <dt>Expense</dt>
                  <dd className="num">{formatCents(eventTotals.outCents)}</dd>
                  <dt>Net</dt>
                  <dd className="num">
                    <strong>{formatCents(eventTotals.netCents)}</strong>
                  </dd>
                </dl>
                <table className="members">
                  <thead>
                    <tr>
                      <th>Budget line</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...eventByLine.entries()].map(([lid, actual]) => (
                      <tr key={lid || "uncat"}>
                        <td>
                          {lid ? (
                            (lineName.get(lid) ?? "—")
                          ) : (
                            <span className="muted">uncategorized</span>
                          )}
                        </td>
                        <td className="num">{formatCents(totalForLine(actual))}</td>
                      </tr>
                    ))}
                    {eventByLine.size === 0 && (
                      <tr>
                        <td colSpan={2} className="muted">
                          No entries tagged to this event.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Board snapshot data */}
          <div className="stack">
            <h2>Board snapshot</h2>
            <p className="muted">
              The monthly-meeting summary. Full financial transparency to the
              board is a fiduciary norm — and the treasurer&apos;s protection.
              As of {asOf}.
            </p>
            <p className="muted">
              {reconciledThroughLabel
                ? `Reconciled through ${reconciledThroughLabel}.`
                : "No months reconciled yet."}
            </p>

            {/* Two aggregates feed this section and either can fail alone. The
                banner used to key on the totals rpc only, so a failed per-line
                read printed $0.00 in every category rollup with nothing saying
                so. It names whichever one is missing now. */}
            {(!totals || actualsUnavailable) && (
              <p className="alert-error">
                {!totals && actualsUnavailable
                  ? "The season totals and the category rollups could not be read just now, so the figures below are blank rather than wrong."
                  : !totals
                    ? "The season totals could not be read just now, so the header figures below are blank rather than wrong."
                    : "The category rollups could not be read just now, so the Actual column below is blank rather than wrong."}{" "}
                Reload to try again — do not present this page to the board until
                it shows numbers.
              </p>
            )}

            <dl className="detail-list">
              <dt>Income (actual)</dt>
              <dd className="num">
                {totals ? formatCents(totals.inCents) : "—"}
              </dd>
              <dt>Expense (actual)</dt>
              <dd className="num">
                {totals ? formatCents(totals.outCents) : "—"}
              </dd>
              <dt>Net</dt>
              <dd className="num">
                <strong>{totals ? formatCents(totals.netCents) : "—"}</strong>
              </dd>
            </dl>

            <h3>Category rollups</h3>
            <table className="members">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Direction</th>
                  <th className="num">Actual</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{CATEGORY_DIRECTION_LABELS[c.direction]}</td>
                    <td className="num">
                      {actualsUnavailable
                        ? "—"
                        : formatCents(catActual.get(c.id) ?? 0)}
                    </td>
                  </tr>
                ))}
                {cats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No budget categories yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {uncategorizedCount > 0 ? (
              <p className="alert-error">
                {uncategorizedCount} uncategorized{" "}
                {uncategorizedCount === 1 ? "entry" : "entries"} totaling{" "}
                {formatCents(uncategorizedTotal)} are not reflected in the
                category rollups above.{" "}
                <Link href={`/${slug}/treasury?uncategorized=1`}>Clear them</Link>.
              </p>
            ) : (
              <p className="muted">All entries are categorized.</p>
            )}

            <p>
              <a
                href={`/api/pdf/board-snapshot?season=${season.id}`}
                className="secondary"
              >
                Download board snapshot (PDF)
              </a>
            </p>
          </div>
        </>
      )}
    </section>
  );
}
