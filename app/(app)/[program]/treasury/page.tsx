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
  sumActuals,
  listMonthsWithEntries,
  monthKeyForDate,
  type LedgerDirection,
  type LedgerAmountRow,
  type LedgerMonthRow,
} from "@/lib/treasury";
import { zonedDateKey } from "@/lib/datetime";
import { TreasuryTabs } from "./TreasuryTabs";
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

const ENTRY_COLUMNS =
  "id, entry_date, direction, amount_cents, budget_line_id, competition_id, trip_id, memo, counterparty, receipt_path, voided_at, void_reason, created_at";

// Page-level messages. Anything a row owns (a failed void, a failed filing)
// renders inside that row's popover instead — see ROW_ERR below.
const ERR: Record<string, string> = {
  entry:
    "Could not save the entry. Check the amount (e.g. 1,234.56), direction, and date.",
  receipt_type: "Receipts must be a PDF or image.",
  receipt_upload: "The receipt failed to upload. The entry was not saved.",
  reconcile: "Could not update the reconciliation record.",
};

// Errors that belong to one entry. They arrive with `?edit=<entryId>`, which is
// also what reopens that row's popover, so the message lands where the control
// that produced it is.
const ROW_ERR: Record<string, string> = {
  void: "Could not void that entry.",
  void_reason: "A void needs a reason.",
  categorize: "Could not put that entry on a budget line.",
};

function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
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
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

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
    const { data: budget } = await supabase
      .from("budgets")
      .select("id")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const budgetId = (budget as { id: string } | null)?.id ?? null;

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

  let query = supabase
    .from("ledger_entries")
    .select(ENTRY_COLUMNS)
    .eq("program_id", program.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (season) query = query.eq("season_id", season.id);
  if (!includeVoided) query = query.is("voided_at", null);
  if (uncategorizedOnly) query = query.is("budget_line_id", null);
  if (dirFilter !== "all") query = query.eq("direction", dirFilter);
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  if (lineFilter) query = query.eq("budget_line_id", lineFilter);
  if (compFilter) query = query.eq("competition_id", compFilter);
  if (tripFilter) query = query.eq("trip_id", tripFilter);
  // Who and what — the two free-text columns the four decisions write.
  if (search) {
    query = query.or(`counterparty.ilike.%${search}%,memo.ilike.%${search}%`);
  }

  const { data: entryData } = await query;
  const entries = (entryData as (EntryRow & { created_at: string })[] | null) ?? [];

  // Running balance over the displayed non-voided rows, computed chronologically
  // then rendered date-desc. (With filters applied the balance is "as of this
  // row within the current view"; voided rows never contribute — Principle V.)
  const chrono = entries
    .filter((e) => !e.voided_at)
    .slice()
    .sort((a, b) =>
      a.entry_date === b.entry_date
        ? a.created_at.localeCompare(b.created_at)
        : a.entry_date.localeCompare(b.entry_date),
    );
  const balanceById = new Map<string, number>();
  let running = 0;
  for (const e of chrono) {
    running += e.direction === "in" ? e.amount_cents : -e.amount_cents;
    balanceById.set(e.id, running);
  }

  // ---- Season metric strip + uncategorized nudge ----------------------------
  // One season-wide fetch drives Balance/In/Out (via sumActuals, which excludes
  // voids) and the Uncategorized cell (live rows with no budget line).
  let metrics = { inCents: 0, outCents: 0, netCents: 0 };
  let unCount = 0;
  let unTotal = 0;
  {
    let mq = supabase
      .from("ledger_entries")
      .select("amount_cents, direction, voided_at, budget_line_id")
      .eq("program_id", program.id);
    if (season) mq = mq.eq("season_id", season.id);
    const { data: mData } = await mq;
    const rows = (mData as LedgerAmountRow[] | null) ?? [];
    metrics = sumActuals(rows);
    for (const r of rows) {
      if (r.voided_at || r.budget_line_id) continue;
      unCount += 1;
      unTotal += r.amount_cents;
    }
  }

  // ---- Reconciliation (Wave L) ----------------------------------------------
  // Months (this season) that carry non-voided entries, and which of those the
  // treasurer has marked reconciled against the bank statement. Reconciliation
  // rows are program-scoped (not season-scoped) — we look them up by month key.
  let reconMonths: string[] = [];
  const reconciledBy = new Map<string, { date: string; note: string | null }>();
  if (season) {
    const { data: monthRows } = await supabase
      .from("ledger_entries")
      .select("entry_date, voided_at")
      .eq("program_id", program.id)
      .eq("season_id", season.id);
    reconMonths = listMonthsWithEntries(
      (monthRows as LedgerMonthRow[] | null) ?? [],
    );

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

  // A row's popover reopens on `?edit=<entryId>`, carrying its own error.
  const errorCode = one("error");
  const openId = canWrite ? one("edit") : null;
  const rowError = openId ? message(ROW_ERR, errorCode) : null;
  const pageError = rowError ? null : message(ERR, errorCode);
  const unknownError = errorCode && !rowError && !pageError;

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

      <TreasuryTabs slug={slug} active="ledger" />

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {(pageError || unknownError) && (
        <p className="alert-error">{pageError ?? "Something went wrong."}</p>
      )}

      {!season && (
        <p className="alert-error">
          No active season. Ledger entries are season-scoped —{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link> to
          record them.
        </p>
      )}

      {/* Metric strip */}
      <div className="metric-strip">
        <div className="metric-cell">
          <div className="metric-label">Balance</div>
          <div className="metric-value">{formatCents(metrics.netCents)}</div>
          <div className="metric-sub">this season · voids excluded</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">In</div>
          <div className="metric-value ok">{formatCents(metrics.inCents)}</div>
          <div className="metric-sub">income received</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Out</div>
          <div className="metric-value alert">
            {formatCents(metrics.outCents)}
          </div>
          <div className="metric-sub">expenses paid</div>
        </div>
        <div className={`metric-cell${unCount > 0 ? " warn" : ""}`}>
          <div className="metric-label">Uncategorized</div>
          <div className="metric-value">{unCount}</div>
          <div className="metric-sub">
            {unCount > 0 ? (
              <>
                {formatCents(unTotal)} ·{" "}
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
        options={options}
        canWrite={canWrite}
        openId={openId}
        error={rowError}
      />

      <p className="page-foot">
        A mistake is voided and redone with a reason — the audit log keeps both.
        Voided rows never count toward balances.
      </p>
    </section>
  );
}
