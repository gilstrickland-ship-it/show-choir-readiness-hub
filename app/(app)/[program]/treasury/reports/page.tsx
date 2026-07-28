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
  commitmentTotalsFromRow,
  actualForDirection,
  pickSeasonBudget,
  monthKeyForDate,
  reconciledThroughMonth,
  formatMonthKey,
  UNCATEGORIZED_KEY,
  type LineActual,
  type LedgerSeasonTotals,
  type CommitmentTotals,
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
  // Planned is what "Still available" is measured against (spec 006 §1), so the
  // snapshot needs the budget's own figures, not only the ledger's.
  planned_cents: number;
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
  // The middle layer (spec 006). Its own aggregate, so its own failure: a
  // committed figure we could not read is a blank, and the "still available"
  // line is withheld entirely rather than printed as though nothing were
  // promised — which is the exact wrong number this feature exists to stop.
  let commitmentTotals: CommitmentTotals | null = null;
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
    const [
      budgetRes,
      { data: compData },
      { data: tripData },
      lineRes,
      totalsRes,
      commitmentRes,
    ] = await Promise.all([
        // The ACTIVE budget, else the newest — the same choice the board PDF
        // makes (lib/pdf/queries loadBoardSnapshot), which matters here more
        // than anywhere: this page and that PDF are the two things a treasurer
        // hands the same meeting. `.order("status")` sorts the enum by
        // declaration order and so preferred the DRAFT (lib/treasury
        // pickSeasonBudget).
        supabase
          .from("budgets")
          .select("id, name, status")
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("created_at", { ascending: false }),
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
        // The same aggregate the ledger strip and Budget vs Actual read, and the
        // same definition the board PDF restates in TypeScript on its
        // service-role path — one source, so the handout and the screen cannot
        // put two different "still available" figures in front of one meeting.
        supabase.rpc("commitment_totals", {
          p_program_id: program.id,
          p_season_id: season.id,
        }),
      ]);

    // The budget's own row failing reads downstream as "this program has no
    // budget", and the snapshot then prints "No budget categories yet." — a
    // statement about the budget, made when it was the READ that failed.
    const b = pickSeasonBudget(
      (budgetRes.data as { id: string; name: string; status: string }[] | null) ??
        [],
    );
    if (budgetRes.error) structureUnavailable = true;
    comps = (compData as NamedRow[] | null) ?? [];
    trips = (tripData as NamedRow[] | null) ?? [];
    actualsUnavailable = !!lineRes.error;
    seasonByLine = lineRes.error ? new Map() : lineActualsFromRows(lineRes.data);
    const totalsRow = Array.isArray(totalsRes.data)
      ? totalsRes.data[0]
      : totalsRes.data;
    totals = totalsRes.error ? null : seasonTotalsFromRow(totalsRow);
    const commitmentRow = Array.isArray(commitmentRes.data)
      ? commitmentRes.data[0]
      : commitmentRes.data;
    commitmentTotals = commitmentRes.error
      ? null
      : commitmentTotalsFromRow(commitmentRow);

    if (b) {
      const { data: catData, error: catError } = await supabase
        .from("budget_categories")
        .select("id, name, direction")
        .eq("program_id", program.id)
        .eq("budget_id", b.id)
        .order("direction", { ascending: true })
        .order("sort_order", { ascending: true });
      cats = (catData as SnapshotCatRow[] | null) ?? [];
      if (catError) structureUnavailable = true;
      if (cats.length > 0) {
        const { data: lineData, error: lineError } = await supabase
          .from("budget_lines")
          .select("id, category_id, name, planned_cents")
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
  // A category's rollup is read the way the category MEANS it — an income
  // category counts money in, an expense category counts money out
  // (lib/treasury actualForDirection). That is the same split the header
  // figures use, because ledger_season_totals divides by the ENTRY's direction
  // too, so the two halves of this snapshot can be added up against each other.
  //
  // It used to be every cent booked to the line regardless of direction, filed
  // under whichever direction its category happened to be. A refund booked
  // against an expense line therefore INCREASED that category's total and, in
  // the PDF, the season's total expenses — so the Net printed on the handout and
  // the Net on this page could disagree at the same board meeting.
  //
  // Uncategorized comes back as its own bucket from the aggregate and is
  // reported separately below (it belongs to no category, in either direction).
  const catDirection = new Map(cats.map((c) => [c.id, c.direction]));
  const catActual = new Map<string, number>();
  for (const [lineId, actual] of seasonByLine) {
    if (lineId === UNCATEGORIZED_KEY) continue;
    const catId = lineCat.get(lineId);
    if (!catId) continue;
    const direction = catDirection.get(catId);
    if (!direction) continue;
    catActual.set(
      catId,
      (catActual.get(catId) ?? 0) + actualForDirection(actual, direction),
    );
  }
  // What the season PLANNED to spend — the first of the four numbers. Only the
  // expense side has a "still available", because only spending authority can be
  // committed against (spec §2, decision D4). Null when the budget's own lines
  // could not be read: a planned total of $0 would make every committed dollar
  // read as an overrun.
  const plannedExpense = structureUnavailable
    ? null
    : lines.reduce(
        (sum, l) =>
          catDirection.get(l.category_id) === "expense"
            ? sum + l.planned_cents
            : sum,
        0,
      );

  const asOf = formatDateTimeInTz(new Date(), program.timezone);

  // "Reconciled through" (Wave L): the latest contiguous month whose books were
  // checked against the bank statement. The month list is void-free by
  // construction (the aggregate excludes voided rows).
  const monthsWithEntries = totals?.months ?? [];
  let reconciledThroughLabel: string | null = null;
  // A failed reconciliation read used to collapse into an empty key list, which
  // reads as "No months reconciled yet." — the money control's own status line,
  // stated wrongly, while the downloadable PDF printed the truth from the same
  // table. Blank, and say why.
  let reconciledUnavailable = false;
  if (season && monthsWithEntries.length > 0) {
    const { data: recRows, error: recError } = await supabase
      .from("ledger_reconciliations")
      .select("month")
      .eq("program_id", program.id);
    if (recError) {
      reconciledUnavailable = true;
    } else {
      const reconciledKeys = ((recRows as { month: string }[] | null) ?? [])
        .map((r) => monthKeyForDate(r.month))
        .filter((k): k is string => k !== null);
      const through = reconciledThroughMonth(monthsWithEntries, reconciledKeys);
      reconciledThroughLabel = through ? formatMonthKey(through) : null;
    }
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
            reconciledUnavailable={reconciledUnavailable}
            cats={cats}
            catActual={catActual}
            totals={totals}
            plannedExpense={plannedExpense}
            commitments={commitmentTotals}
            actualsUnavailable={actualsUnavailable}
            structureUnavailable={structureUnavailable}
          />
        </>
      )}
    </section>
  );
}
