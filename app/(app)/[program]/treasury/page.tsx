import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  TREASURY_WRITE_ROLES,
  LEDGER_DIRECTIONS,
  formatCents,
  ledgerSearchTerm,
  seasonTotalsFromRow,
  ledgerPageRange,
  ledgerPageRangeUnknownTotal,
  parsePageParam,
  monthKeyForDate,
  pickSeasonBudget,
  LEDGER_PAGE_SIZE,
  type LedgerDirection,
  type LedgerSeasonTotals,
} from "@/lib/treasury";
import { zonedDateKey } from "@/lib/datetime";
import { SubTabs } from "../SubTabs";
import { Flash } from "../Flash";
import { readFlash, oneParam, type PageFlash } from "@/lib/flash";
import {
  LEDGER_FLASH_MAPS,
  entryAnchor,
  type LedgerSection,
} from "./flash";
import { treasuryTabs } from "@/lib/subnav";
import { IntroStrip, HelpDot } from "../IntroStrip";
import { loadGuideState } from "@/lib/guide";
import { AddEntry, type EntryPrefill } from "./AddEntry";
import { LedgerFilters } from "./LedgerFilters";
import { LedgerTable, type EntryRow } from "./LedgerTable";
import { Reconciliation } from "./Reconciliation";
import type { CatOpt, LineOpt, NamedOpt, TagOptions } from "./shared";

// The running ledger (T019) — the treasury landing, and after spec 005 US8 a
// load-and-compose page: the season metric strip and the Uncategorized nudge
// live here, and the four surfaces that hold controls are their own files
// (AddEntry, LedgerFilters, LedgerTable, Reconciliation).
//
// NOTHING ON THIS PAGE IS SUMMED FROM A FETCHED ROW LIST ANY MORE. PostgREST
// caps a response at `max_rows` (1000), so the old season-wide fetches meant
// that past a thousand entries the Balance, the In/Out totals, the
// Uncategorized count and the reconciliation month list were all computed from
// an arbitrary prefix — a treasurer could read a wrong balance to the board with
// nothing on screen indicating truncation. Totals now come from the 0019 SQL
// aggregates (one row each, no cap), and the LIST is explicitly paginated and
// says which slice of how many it is showing.

const ENTRY_COLUMNS =
  "id, entry_date, direction, amount_cents, budget_line_id, competition_id, trip_id, memo, counterparty, receipt_path, voided_at, void_reason";

// The filter chain, described once and applied to BOTH the count query and the
// page query, so "showing 1–100 of 412" can never be describing a different set
// of rows than the table underneath it.
type FilterOp =
  | { kind: "eq"; column: string; value: string }
  | { kind: "isNull"; column: string }
  | { kind: "gte"; column: string; value: string }
  | { kind: "lte"; column: string; value: string }
  | { kind: "or"; filters: string };

interface LedgerFilterSpec {
  seasonId: string | null;
  includeVoided: boolean;
  uncategorizedOnly: boolean;
  direction: LedgerDirection | "all";
  from: string;
  to: string;
  line: string;
  competition: string;
  trip: string;
  search: string | null;
}

function ledgerFilterOps(f: LedgerFilterSpec): FilterOp[] {
  const ops: FilterOp[] = [];
  if (f.seasonId) ops.push({ kind: "eq", column: "season_id", value: f.seasonId });
  if (!f.includeVoided) ops.push({ kind: "isNull", column: "voided_at" });
  if (f.uncategorizedOnly) ops.push({ kind: "isNull", column: "budget_line_id" });
  if (f.direction !== "all") {
    ops.push({ kind: "eq", column: "direction", value: f.direction });
  }
  if (f.from) ops.push({ kind: "gte", column: "entry_date", value: f.from });
  if (f.to) ops.push({ kind: "lte", column: "entry_date", value: f.to });
  if (f.line) ops.push({ kind: "eq", column: "budget_line_id", value: f.line });
  if (f.competition) {
    ops.push({ kind: "eq", column: "competition_id", value: f.competition });
  }
  if (f.trip) ops.push({ kind: "eq", column: "trip_id", value: f.trip });
  // Who and what — the two free-text columns the four decisions write.
  if (f.search) {
    ops.push({
      kind: "or",
      filters: `counterparty.ilike.%${f.search}%,memo.ilike.%${f.search}%`,
    });
  }
  return ops;
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?direction=in&direction=out),
  // so every read goes through `one()` — a hand-typed URL must not 500 the page
  // or smuggle an array into a query filter.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags, membership, isSupport } =
    await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) {
    return (
      <Restricted
        slug={slug}
        surface="Money"
        role={role}
        allowed={TREASURY_ROLES}
      />
    );
  }
  const canWrite = TREASURY_WRITE_ROLES.includes(role);

  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);

  const supabase = await createClient();

  // First-use intro strip (spec 003 §3) — flag on, real member (not a support
  // view). Read the member's collapsed state once; the strip decides its own
  // visibility from that + ?help=1.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(supabase, program.id, membership.user_id)
      : {};

  // Option sources: budget lines (grouped by category) for the current season's
  // budget, plus season competitions and trips for tagging + filtering.
  let cats: CatOpt[] = [];
  let lines: LineOpt[] = [];
  let comps: NamedOpt[] = [];
  let trips: NamedOpt[] = [];

  if (season) {
    // Which budget's lines the entry form offers. The ACTIVE one, else the
    // newest — `.order("status")` sorts the enum by declaration order and so
    // offered the DRAFT's lines to code an entry against, while the reports
    // read the active budget (lib/treasury pickSeasonBudget).
    const { data: budgetRows } = await supabase
      .from("budgets")
      .select("id, status")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("created_at", { ascending: false });

    const budgetId =
      pickSeasonBudget(
        (budgetRows as { id: string; status: string }[] | null) ?? [],
      )?.id ?? null;

    const [catRes, compRes, tripRes] = await Promise.all([
      budgetId
        ? supabase
            .from("budget_categories")
            .select("id, name, direction")
            .eq("program_id", program.id)
            .eq("budget_id", budgetId)
            .order("direction", { ascending: true })
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [] as CatOpt[] }),
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
    ]);

    cats = (catRes.data as CatOpt[] | null) ?? [];
    comps = (compRes.data as NamedOpt[] | null) ?? [];
    trips = (tripRes.data as NamedOpt[] | null) ?? [];

    if (cats.length > 0) {
      const { data: lineData } = await supabase
        .from("budget_lines")
        .select("id, name, category_id")
        .eq("program_id", program.id)
        .in(
          "category_id",
          cats.map((c) => c.id),
        )
        .order("sort_order", { ascending: true });
      lines = (lineData as LineOpt[] | null) ?? [];
    }
  }

  const options: TagOptions = { cats, lines, comps, trips };

  // ---- Filters --------------------------------------------------------------
  const includeVoided = one("voided") === "1";
  const uncategorizedOnly = one("uncategorized") === "1";
  const search = ledgerSearchTerm(one("q"));
  const rawDirection = one("direction") ?? "";
  const dirFilter = (LEDGER_DIRECTIONS as readonly string[]).includes(
    rawDirection,
  )
    ? (rawDirection as LedgerDirection)
    : "all";
  const from = one("from") ?? "";
  const to = one("to") ?? "";
  const lineFilter = one("line") ?? "";
  const compFilter = one("competition") ?? "";
  const tripFilter = one("trip") ?? "";

  const filterSpec: LedgerFilterSpec = {
    seasonId: season?.id ?? null,
    includeVoided,
    uncategorizedOnly,
    direction: dirFilter,
    from,
    to,
    line: lineFilter,
    competition: compFilter,
    trip: tripFilter,
    search,
  };

  // ---- The list: count first, then exactly one page -------------------------
  const ops = ledgerFilterOps(filterSpec);

  let countQuery = supabase
    .from("ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("program_id", program.id);
  for (const op of ops) {
    if (op.kind === "eq") countQuery = countQuery.eq(op.column, op.value);
    else if (op.kind === "isNull") countQuery = countQuery.is(op.column, null);
    else if (op.kind === "gte") countQuery = countQuery.gte(op.column, op.value);
    else if (op.kind === "lte") countQuery = countQuery.lte(op.column, op.value);
    else countQuery = countQuery.or(op.filters);
  }
  // A DROPPED COUNT ERROR USED TO TRUNCATE THE LEDGER IN SILENCE. `count` comes
  // back null on failure, ledgerPageRange(0, …) then reports "0 entries" and the
  // pager renders nothing at all — so a treasurer saw exactly one page and no
  // indication that anything followed it. The count is now allowed to be
  // UNKNOWN, which is a different thing from zero.
  const { count: matchCount, error: countError } = await countQuery;
  const requestedPage = parsePageParam(one("page"));
  const countedRange = countError
    ? null
    : ledgerPageRange(matchCount ?? 0, requestedPage);
  const listFrom = countedRange
    ? countedRange.from
    : (requestedPage - 1) * LEDGER_PAGE_SIZE;

  let listQuery = supabase
    .from("ledger_entries")
    .select(ENTRY_COLUMNS)
    .eq("program_id", program.id);
  for (const op of ops) {
    if (op.kind === "eq") listQuery = listQuery.eq(op.column, op.value);
    else if (op.kind === "isNull") listQuery = listQuery.is(op.column, null);
    else if (op.kind === "gte") listQuery = listQuery.gte(op.column, op.value);
    else if (op.kind === "lte") listQuery = listQuery.lte(op.column, op.value);
    else listQuery = listQuery.or(op.filters);
  }
  const { data: entryData } = await listQuery
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    // The unique tiebreaker. Two entries sharing a date AND a created_at (a
    // bulk insert, or the void + replacement a filing writes) have no defined
    // order without it, and an ambiguous ORDER BY across .range() calls can hand
    // the same row back on two pages while another is never shown at all. The
    // board-snapshot pager already learned this.
    .order("id", { ascending: false })
    .range(listFrom, listFrom + LEDGER_PAGE_SIZE - 1);
  const entries = (entryData as EntryRow[] | null) ?? [];
  const range = countedRange ?? ledgerPageRangeUnknownTotal(requestedPage, entries.length);

  // Running balance for the rows on THIS page — computed in SQL over the whole
  // season, so it is the season balance as of each entry rather than a total
  // that restarts at zero on page 2 or shifts when a filter is applied.
  //
  // A MISSING BALANCE IS NOT ZERO. This map used to be read with `?? 0`, so a
  // failed rpc printed a full column of $0.00 next to a metric strip that was
  // still correct — the same "a zero balance is a number a treasurer would read
  // aloud to a board" rule the totals already follow. The map is now the only
  // authority: an id it does not carry renders "—".
  const balanceById = new Map<string, number>();
  let balanceError = false;
  if (season && entries.length > 0) {
    const { data: balRows, error: balErr } = await supabase.rpc(
      "ledger_running_balance",
      {
        p_program_id: program.id,
        p_season_id: season.id,
        p_entry_ids: entries.filter((e) => !e.voided_at).map((e) => e.id),
      },
    );
    balanceError = !!balErr;
    for (const r of (balRows as
      | { entry_id: string; balance_cents: number }[]
      | null) ?? []) {
      balanceById.set(r.entry_id, Number(r.balance_cents));
    }
  }
  // With no active season there is no season balance to be "as of" — the column
  // would be a blank claim on every row, so it does not appear at all.
  const showBalance = !!season;
  const balancesUnavailable =
    showBalance &&
    (balanceError ||
      entries.some((e) => !e.voided_at && !balanceById.has(e.id)));

  // ---- Season metric strip + uncategorized nudge ----------------------------
  // One SQL aggregate drives Balance/In/Out, the Uncategorized cell, and the
  // reconciliation month list. A failed read renders as "—", never as $0.00: a
  // zero balance is a number a treasurer would read aloud to a board.
  let totals: LedgerSeasonTotals | null = null;
  if (season) {
    const { data: totalsData, error: totalsError } = await supabase.rpc(
      "ledger_season_totals",
      { p_program_id: program.id, p_season_id: season.id },
    );
    const row = Array.isArray(totalsData) ? totalsData[0] : totalsData;
    totals = totalsError ? null : seasonTotalsFromRow(row);
  }
  const totalsUnavailable = !!season && !totals;

  // ---- Reconciliation (Wave L) ----------------------------------------------
  // Months (this season) that carry non-voided entries, and which of those the
  // treasurer has marked reconciled against the bank statement. Reconciliation
  // rows are program-scoped (not season-scoped) — we look them up by month key.
  const reconMonths = totals?.months ?? [];
  const reconciledBy = new Map<string, { date: string; note: string | null }>();
  if (reconMonths.length > 0) {
    const { data: recRows } = await supabase
      .from("ledger_reconciliations")
      .select("month, note, created_at")
      .eq("program_id", program.id);
    for (const r of (recRows as
      { month: string; note: string | null; created_at: string }[] | null) ??
      []) {
      const key = monthKeyForDate(r.month);
      if (key) reconciledBy.set(key, { date: r.created_at, note: r.note });
    }
  }
  const confirmParam = one("confirm");
  const unmarkConfirmMonth =
    canWrite && confirmParam?.startsWith("unmark_")
      ? confirmParam.slice("unmark_".length)
      : null;

  // ---- "Void & redo" prefill (from the entry that was just voided) ----------
  let prefill: EntryPrefill | null = null;
  const reenterId = one("reenter");
  if (canWrite && reenterId) {
    const { data } = await supabase
      .from("ledger_entries")
      .select(ENTRY_COLUMNS)
      .eq("id", reenterId)
      .eq("program_id", program.id)
      .maybeSingle();
    const row = data as EntryRow | null;
    if (row) {
      prefill = {
        redoOf: reenterId,
        entry_date: row.entry_date,
        direction: row.direction,
        amount_cents: row.amount_cents,
        budget_line_id: row.budget_line_id,
        competition_id: row.competition_id,
        trip_id: row.trip_id,
        memo: row.memo,
        counterparty: row.counterparty,
        hadReceipt: !!row.receipt_path,
      };
    }
  }

  // A row's popover reopens on `?edit=<entryId>` and carries its own error —
  // but only when that row is really on this page and still live. A voided row
  // renders as inert text with no popover (and is filtered out entirely by the
  // default "live rows only" filter), so a message aimed at it would render
  // nowhere at all. Fail OPEN to the page banner in that case.
  const flash = readFlash<LedgerSection>(sp, LEDGER_FLASH_MAPS);
  const openId = canWrite ? one("edit") : null;
  const rowWillRender =
    !!openId && entries.some((e) => e.id === openId && !e.voided_at);
  const rowOwned = flash.error?.section === "row";
  const rowError = rowOwned && rowWillRender ? flash.error!.message : null;
  // A row-owned message with nowhere to land falls open to the page banner.
  const pageFlash: PageFlash<LedgerSection> =
    rowOwned && !rowWillRender
      ? { ok: flash.ok, error: { section: "page", message: flash.error!.message } }
      : flash;

  // Paging links keep every filter and drop the one-shot params (a flash, an
  // error, a reopened popover) so page 2 is not still shouting about page 1.
  const ONE_SHOT = ["edit", "error", "ok", "confirm", "reenter"];
  const TRANSIENT = new Set(["page", ...ONE_SHOT]);
  const keepFilters = (drop: Set<string>): URLSearchParams => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value !== "string" || drop.has(key)) continue;
      qs.set(key, value);
    }
    return qs;
  };
  const ledgerHref = (qs: URLSearchParams, hash = ""): string => {
    const query = qs.toString();
    return `/${slug}/treasury${query ? `?${query}` : ""}${hash}`;
  };
  const pageHref = (target: number): string => {
    const qs = keepFilters(TRANSIENT);
    if (target > 1) qs.set("page", String(target));
    return ledgerHref(qs);
  };
  // Open (or close) ONE row's fix panel without losing the filters or the page
  // the treasurer is looking at. `?edit=` is the same param a refused write comes
  // back on, so the link and the redirect land in exactly the same place.
  const rowHref = (entryId: string | null): string => {
    const qs = keepFilters(new Set(ONE_SHOT));
    if (entryId) qs.set("edit", entryId);
    return ledgerHref(qs, entryId ? `#${entryAnchor(entryId)}` : "");
  };

  const metric = (value: string | null): string => value ?? "—";

  return (
    <section className="stack money">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            Tracked, never touched — entries void, never delete
          </p>
          <div className="page-title-row">
            <h1 className="page-h1">Money</h1>
            {showGuide && <HelpDot href={`/${slug}/treasury?help=1`} />}
          </div>
        </div>
        {canWrite && season && (
          <div className="page-head-actions">
            <AddEntry
              programId={program.id}
              slug={slug}
              seasonId={season.id}
              today={zonedDateKey(new Date(), program.timezone)}
              options={options}
              prefill={prefill}
            />
          </div>
        )}
      </div>

      {showGuide && (
        <IntroStrip
          surfaceKey="treasury"
          programId={program.id}
          selfPath={`/${slug}/treasury`}
          guideState={guideState}
          help={one("help") === "1"}
          canWrite={canWrite}
        />
      )}

      <SubTabs strip={treasuryTabs(slug, "ledger")} />

      <Flash flash={pageFlash} section="page" />

      {!season && (
        <p className="alert-error">
          No active season. Ledger entries are season-scoped —{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link> to
          record them.
        </p>
      )}

      {totalsUnavailable && (
        <p className="alert-error">
          The season totals could not be read just now, so Balance, In, Out and
          Uncategorized are blank rather than wrong. The entries below are
          unaffected — reload to try again.
        </p>
      )}

      {balancesUnavailable && (
        <p className="alert-error">
          The running balance could not be read just now, so the Balance column
          is blank rather than wrong. Each entry&apos;s own amount is unaffected
          — reload to try again.
        </p>
      )}

      {countError && (
        <p className="alert-error">
          How many entries match these filters could not be read just now, so
          this page says which entries it is showing but not how many there are
          in total. Keep paging with Older to see the rest.
        </p>
      )}

      {/* Metric strip */}
      <div className="metric-strip">
        <div className="metric-cell">
          <div className="metric-label">Balance</div>
          <div className="metric-value">
            {metric(totals && formatCents(totals.netCents))}
          </div>
          <div className="metric-sub">this season · voids excluded</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">In</div>
          <div className="metric-value ok">
            {metric(totals && formatCents(totals.inCents))}
          </div>
          <div className="metric-sub">income received</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Out</div>
          <div className="metric-value alert">
            {metric(totals && formatCents(totals.outCents))}
          </div>
          <div className="metric-sub">expenses paid</div>
        </div>
        <div
          className={`metric-cell${totals && totals.uncategorizedCount > 0 ? " warn" : ""}`}
        >
          <div className="metric-label">Uncategorized</div>
          <div className="metric-value">
            {metric(totals && String(totals.uncategorizedCount))}
          </div>
          <div className="metric-sub">
            {!totals ? (
              "count unavailable"
            ) : totals.uncategorizedCount > 0 ? (
              <>
                {formatCents(totals.uncategorizedCents)} ·{" "}
                <Link
                  href={`/${slug}/treasury?uncategorized=1`}
                  className="metric-link"
                >
                  categorize now
                </Link>
              </>
            ) : (
              "all categorized"
            )}
          </div>
        </div>
      </div>

      {season && reconMonths.length > 0 && (
        <Reconciliation
          programId={program.id}
          slug={slug}
          months={reconMonths}
          reconciledBy={reconciledBy}
          canWrite={canWrite}
          confirmMonth={unmarkConfirmMonth}
          timeZone={program.timezone}
        />
      )}

      <LedgerFilters
        slug={slug}
        options={options}
        // The sanitized term, not the raw one: the box shows what was actually
        // searched for rather than punctuation that never reached the query.
        q={search ?? ""}
        direction={dirFilter}
        from={from}
        to={to}
        line={lineFilter}
        competition={compFilter}
        trip={tripFilter}
        includeVoided={includeVoided}
        uncategorizedOnly={uncategorizedOnly}
      />

      <LedgerTable
        programId={program.id}
        slug={slug}
        entries={entries}
        balanceById={balanceById}
        showBalance={showBalance}
        options={options}
        canWrite={canWrite}
        openId={rowWillRender ? openId : null}
        error={rowError}
        range={range}
        pageHref={pageHref}
        rowHref={rowHref}
      />

      <p className="page-foot">
        A mistake is voided and redone with a reason — the audit log keeps both.
        Voided rows never count toward balances. Balance is the season total as
        of that entry, so it reads the same whichever filter or page you are on.
      </p>
    </section>
  );
}
