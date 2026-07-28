import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeInTz } from "@/lib/datetime";
import { TREASURY_ROLES } from "@/lib/nav";
import { oneParam } from "@/lib/flash";
import {
  lineActualsFromRows,
  seasonTotalsFromRow,
  totalForLine,
  monthKeyForDate,
  reconciledThroughMonth,
  formatMonthKey,
  UNCATEGORIZED_KEY,
  type LineActual,
  type LedgerSeasonTotals,
} from "@/lib/treasury";
import { SubTabs } from "../../SubTabs";
import { treasuryTabs } from "@/lib/subnav";
import { EventReport, type NamedRow } from "./EventReport";
import { BoardSnapshot, type SnapshotCatRow } from "./BoardSnapshot";

// Reports (T020, replanned in spec 005 Wave 12): what one competition or trip
// cost, and the board snapshot the monthly meeting is read from. Read-only; no
// writes, for any seat. A load-and-compose page — the two reports are their own
// files (EventReport, BoardSnapshot), which is also where their vocabulary and
// their "we could not read this" behaviour live.
//
// Every number here is a SQL aggregate (0019), not a sum over a fetched entry
// list. This is the page a treasurer reads to a board from, so it is the last
// place that may quietly stop at PostgREST's 1000-row cap. The per-event report
// asks for one event's aggregate instead of pulling the season and filtering it
// in memory.

interface LineRow {
  id: string;
  category_id: string;
  name: string;
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?event=a&event=b), so the
  // read goes through `oneParam` — a hand-typed URL must not 500 the page.
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
  const event = oneParam(sp, "event");

  const supabase = await createClient();

  let cats: SnapshotCatRow[] = [];
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
  // The budget's own shape fails separately again, and an empty category list
  // renders as "No budget categories yet." — a statement about the budget that
  // is false when the read is what failed.
  let structureUnavailable = false;

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
      const { data: catData, error: catError } = await supabase
        .from("budget_categories")
        .select("id, name, direction")
        .eq("program_id", program.id)
        .eq("budget_id", b.id)
        .order("direction", { ascending: true })
        .order("sort_order", { ascending: true });
      cats = (catData as SnapshotCatRow[] | null) ?? [];
      structureUnavailable = !!catError;
      if (cats.length > 0) {
        const { data: lineData, error: lineError } = await supabase
          .from("budget_lines")
          .select("id, category_id, name")
          .eq("program_id", program.id)
          .in(
            "category_id",
            cats.map((c) => c.id),
          );
        lines = (lineData as LineRow[] | null) ?? [];
        if (lineError) structureUnavailable = true;
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

  // ---- The chosen event -----------------------------------------------------
  // `?event=` is a client-supplied id and is resolved IN-PROGRAM before it is
  // used for anything: the name comes from this season's own competition and
  // trip lists, and an id that isn't on one of them never reaches the aggregate
  // (it used to be handed straight to the rpc, which then answered for an event
  // this page had already decided it would not name).
  const kind = event?.startsWith("comp:")
    ? "comp"
    : event?.startsWith("trip:")
      ? "trip"
      : null;
  const eventId = kind ? event!.slice(5) : null;
  const eventName = !eventId
    ? null
    : kind === "comp"
      ? (comps.find((c) => c.id === eventId)?.name ?? null)
      : (trips.find((t) => t.id === eventId)?.name ?? null);

  // One aggregate scoped to the chosen event — asked for only when an event is
  // chosen, and grouped by budget line so the breakdown and the totals are the
  // same numbers by construction.
  let eventByLine = new Map<string, LineActual>();
  if (season && eventId && kind && eventName) {
    const { data, error } = await supabase.rpc("ledger_line_actuals", {
      p_program_id: program.id,
      p_season_id: season.id,
      p_competition_id: kind === "comp" ? eventId : null,
      p_trip_id: kind === "trip" ? eventId : null,
    });
    eventActualsUnavailable = !!error;
    if (!error) eventByLine = lineActualsFromRows(data);
  }

  return (
    <section className="stack">
      <SubTabs strip={treasuryTabs(slug, "reports")} />
      <h1>Reports</h1>
      <p className="muted">
        Two ways to read the season&apos;s money: what one event cost, and the
        summary the board meets over. Both count the ledger as it stands —
        voided entries never count.
      </p>

      {!season && <p className="alert-error">No active season.</p>}

      {season && (
        <>
          <EventReport
            slug={slug}
            comps={comps}
            trips={trips}
            selected={event ?? ""}
            eventName={eventName}
            byLine={eventByLine}
            lineName={lineName}
            unavailable={eventActualsUnavailable}
          />

          <BoardSnapshot
            slug={slug}
            seasonId={season.id}
            asOf={asOf}
            reconciledThroughLabel={reconciledThroughLabel}
            cats={cats}
            catActual={catActual}
            totals={totals}
            actualsUnavailable={actualsUnavailable}
            structureUnavailable={structureUnavailable}
          />
        </>
      )}
    </section>
  );
}
