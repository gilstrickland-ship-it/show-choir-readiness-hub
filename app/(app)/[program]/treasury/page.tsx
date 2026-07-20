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
  formatDateOnly,
  todayDateKey,
  sumActuals,
  NO_HEALTH_LABEL,
  type CategoryDirection,
  type LedgerDirection,
  type LedgerAmountRow,
} from "@/lib/treasury";
import { TreasuryTabs } from "./TreasuryTabs";
import { addEntry, voidEntry, categorizeEntry } from "./actions";

// Running ledger (T019) — the treasury landing. Date-desc list with direction
// badges, cents-formatted amounts, a running balance, filters (date range /
// direction / budget line / competition / trip / include-voided), the add-entry
// form (with receipt upload), the void + "void & re-enter" flow, and the
// Uncategorized nudge with one-click filter and inline categorize.

interface EntryRow {
  id: string;
  entry_date: string;
  direction: LedgerDirection;
  amount_cents: number;
  budget_line_id: string | null;
  competition_id: string | null;
  trip_id: string | null;
  memo: string | null;
  counterparty: string | null;
  receipt_path: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}
interface LineOpt {
  id: string;
  name: string;
  category_id: string;
}
interface CatOpt {
  id: string;
  name: string;
  direction: CategoryDirection;
}
interface CompOpt {
  id: string;
  name: string;
}
interface TripOpt {
  id: string;
  name: string;
}

const ERR: Record<string, string> = {
  entry: "Could not save the entry. Check the amount (e.g. 1,234.56), direction, and date.",
  void: "Could not void the entry.",
  void_reason: "A void needs a reason.",
  categorize: "Could not categorize the entry.",
  receipt_type: "Receipts must be a PDF or image.",
  receipt_upload: "The receipt failed to upload. The entry was not saved.",
};

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    direction?: string;
    line?: string;
    competition?: string;
    trip?: string;
    voided?: string;
    uncategorized?: string;
    reenter?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Money" role={role} allowed={TREASURY_ROLES} />
    );
  }
  const canWrite = TREASURY_WRITE_ROLES.includes(role);
  const sp = await searchParams;

  const supabase = await createClient();

  // Option sources: budget lines (grouped by category) for the current season's
  // budget, plus season competitions and trips for tagging + filtering.
  let cats: CatOpt[] = [];
  let lines: LineOpt[] = [];
  let comps: CompOpt[] = [];
  let trips: TripOpt[] = [];

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
    comps = (compRes.data as CompOpt[] | null) ?? [];
    trips = (tripRes.data as TripOpt[] | null) ?? [];

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

  const linesByCat = new Map<string, LineOpt[]>();
  for (const l of lines) {
    const arr = linesByCat.get(l.category_id) ?? [];
    arr.push(l);
    linesByCat.set(l.category_id, arr);
  }
  const lineName = new Map(lines.map((l) => [l.id, l.name]));
  const compName = new Map(comps.map((c) => [c.id, c.name]));
  const tripName = new Map(trips.map((t) => [t.id, t.name]));

  // ---- Filters --------------------------------------------------------------
  const includeVoided = sp.voided === "1";
  const uncategorizedOnly = sp.uncategorized === "1";
  const dirFilter = (LEDGER_DIRECTIONS as readonly string[]).includes(
    sp.direction ?? "",
  )
    ? (sp.direction as LedgerDirection)
    : "all";

  let query = supabase
    .from("ledger_entries")
    .select(
      "id, entry_date, direction, amount_cents, budget_line_id, competition_id, trip_id, memo, counterparty, receipt_path, voided_at, void_reason, created_at",
    )
    .eq("program_id", program.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (season) query = query.eq("season_id", season.id);
  if (!includeVoided) query = query.is("voided_at", null);
  if (uncategorizedOnly) query = query.is("budget_line_id", null);
  if (dirFilter !== "all") query = query.eq("direction", dirFilter);
  if (sp.from) query = query.gte("entry_date", sp.from);
  if (sp.to) query = query.lte("entry_date", sp.to);
  if (sp.line) query = query.eq("budget_line_id", sp.line);
  if (sp.competition) query = query.eq("competition_id", sp.competition);
  if (sp.trip) query = query.eq("trip_id", sp.trip);

  const { data: entryData } = await query;
  const entries = (entryData as EntryRow[] | null) ?? [];

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

  // ---- Re-enter prefill (from a just-voided entry) --------------------------
  let prefill: EntryRow | null = null;
  if (canWrite && sp.reenter) {
    const { data } = await supabase
      .from("ledger_entries")
      .select(
        "id, entry_date, direction, amount_cents, budget_line_id, competition_id, trip_id, memo, counterparty, receipt_path, voided_at, void_reason, created_at",
      )
      .eq("id", sp.reenter)
      .eq("program_id", program.id)
      .maybeSingle();
    prefill = (data as EntryRow | null) ?? null;
  }

  const dollarsValue = (cents: number) => (cents / 100).toFixed(2);

  const lineSelect = (name: string, defaultValue: string) => (
    <select name={name} defaultValue={defaultValue}>
      <option value="">(uncategorized)</option>
      {cats.map((c) => (
        <optgroup
          key={c.id}
          label={`${c.direction === "income" ? "Income" : "Expense"} — ${c.name}`}
        >
          {(linesByCat.get(c.id) ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <section className="stack money">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Tracked, never touched — entries void, never delete</p>
          <h1 className="page-h1">Money</h1>
        </div>
        {canWrite && season && (
          <div className="page-head-actions">
            <details className="drawer" open={!!prefill}>
              <summary className="button-link accent">+ Add entry</summary>
              <div className="drawer-panel" id="add-entry">
                <h2 className="drawer-title">
                  {prefill ? "Re-enter (from voided entry)" : "Add an entry"}
                </h2>
                <form action={addEntry} className="stack" encType="multipart/form-data">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="seasonId" value={season.id} />
                  <div className="row-inline">
                    <label>
                      Date
                      <input
                        type="date"
                        name="entry_date"
                        required
                        defaultValue={prefill?.entry_date ?? todayDateKey()}
                      />
                    </label>
                    <label>
                      Direction
                      <select
                        name="direction"
                        required
                        defaultValue={prefill?.direction ?? "out"}
                      >
                        {LEDGER_DIRECTIONS.map((d) => (
                          <option key={d} value={d}>
                            {d === "in" ? "In (income)" : "Out (expense)"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount $
                      <input
                        type="text"
                        name="amount"
                        inputMode="decimal"
                        required
                        placeholder="1,234.56"
                        defaultValue={prefill ? dollarsValue(prefill.amount_cents) : ""}
                      />
                    </label>
                    <label>
                      Paid to / received from
                      <input
                        type="text"
                        name="counterparty"
                        placeholder="Payee or source"
                        defaultValue={prefill?.counterparty ?? ""}
                      />
                    </label>
                  </div>
                  <div className="row-inline">
                    <label>
                      Budget line
                      {lineSelect("budget_line_id", prefill?.budget_line_id ?? "")}
                    </label>
                    <label>
                      Competition tag
                      <select
                        name="competition_id"
                        defaultValue={prefill?.competition_id ?? ""}
                      >
                        <option value="">(none)</option>
                        {comps.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Trip tag
                      <select name="trip_id" defaultValue={prefill?.trip_id ?? ""}>
                        <option value="">(none)</option>
                        {trips.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label style={{ width: "100%" }}>
                    Memo
                    <input type="text" name="memo" defaultValue={prefill?.memo ?? ""} />
                  </label>
                  <label>
                    Receipt (PDF or image)
                    <input type="file" name="receipt" accept="application/pdf,image/*" />
                  </label>
                  <p className="muted">{NO_HEALTH_LABEL}</p>
                  <button type="submit">
                    {prefill ? "Save re-entry" : "Add entry"}
                  </button>
                </form>
              </div>
            </details>
          </div>
        )}
      </div>

      <TreasuryTabs slug={slug} active="ledger" />

      {sp.saved && <p className="alert-ok">Saved.</p>}
      {sp.error && (
        <p className="alert-error">{ERR[sp.error] ?? "Something went wrong."}</p>
      )}

      {!season && (
        <p className="alert-error">
          No active season. Ledger entries are season-scoped —{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link> to record
          them.
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
          <div className="metric-value alert">{formatCents(metrics.outCents)}</div>
          <div className="metric-sub">expenses paid</div>
        </div>
        <div className={`metric-cell${unCount > 0 ? " warn" : ""}`}>
          <div className="metric-label">Uncategorized</div>
          <div className="metric-value">{unCount}</div>
          <div className="metric-sub">
            {unCount > 0 ? (
              <>
                {formatCents(unTotal)} ·{" "}
                <Link href={`/${slug}/treasury?uncategorized=1`} className="metric-link">
                  categorize now
                </Link>
              </>
            ) : (
              "all categorized"
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="row-inline money-filters">
        <label>
          From
          <input type="date" name="from" defaultValue={sp.from ?? ""} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={sp.to ?? ""} />
        </label>
        <label>
          Direction
          <select name="direction" defaultValue={dirFilter}>
            <option value="all">All</option>
            {LEDGER_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d === "in" ? "In" : "Out"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Budget line
          <select name="line" defaultValue={sp.line ?? ""}>
            <option value="">All lines</option>
            {cats.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {(linesByCat.get(c.id) ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Competition
          <select name="competition" defaultValue={sp.competition ?? ""}>
            <option value="">All</option>
            {comps.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trip
          <select name="trip" defaultValue={sp.trip ?? ""}>
            <option value="">All</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row-inline">
          <input
            type="checkbox"
            name="voided"
            value="1"
            defaultChecked={includeVoided}
          />
          Include voided
        </label>
        {uncategorizedOnly && (
          <input type="hidden" name="uncategorized" value="1" />
        )}
        <button type="submit" className="secondary">
          Filter
        </button>
        <Link href={`/${slug}/treasury`} className="linklike">
          Clear
        </Link>
      </form>

      {/* Ledger table */}
      <table className="members money-ledger">
        <thead>
          <tr>
            <th>Date</th>
            <th className="right">Amount</th>
            <th>Line</th>
            <th>Paid to / from · memo</th>
            <th>Receipt</th>
            <th className="right">Balance</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const voided = !!e.voided_at;
            const tag = e.competition_id
              ? (compName.get(e.competition_id) ?? "competition")
              : e.trip_id
                ? (tripName.get(e.trip_id) ?? "trip")
                : "";
            const uncategorized = !e.budget_line_id;
            const party = [e.counterparty, e.memo].filter(Boolean).join(" · ");
            const rowClass = voided
              ? "ledger-voided"
              : uncategorized
                ? "ledger-uncat"
                : undefined;
            return (
              <tr key={e.id} className={rowClass}>
                <td>{formatDateOnly(e.entry_date)}</td>
                <td className="right">
                  {voided ? (
                    <span className="money-amt">
                      {e.direction === "in" ? "+ " : "− "}
                      {formatCents(e.amount_cents)}
                    </span>
                  ) : (
                    <span className={`money-amt ${e.direction === "in" ? "in" : "out"}`}>
                      {e.direction === "in" ? "+ " : "− "}
                      {formatCents(e.amount_cents)}
                    </span>
                  )}
                </td>
                <td>
                  {uncategorized ? (
                    <>
                      <span className="money-uncat">uncategorized</span>
                      {" · "}
                      <Link
                        href={`/${slug}/treasury?uncategorized=1`}
                        className="money-fix"
                      >
                        fix
                      </Link>
                    </>
                  ) : (
                    <>
                      {lineName.get(e.budget_line_id!) ?? "—"}
                      {tag && <span className="muted"> · {tag}</span>}
                    </>
                  )}
                </td>
                <td>{party || <span className="muted">—</span>}</td>
                <td>{e.receipt_path ? "📎" : <span className="muted">—</span>}</td>
                <td className="right">
                  {voided ? (
                    <span className="muted">—</span>
                  ) : (
                    formatCents(balanceById.get(e.id) ?? 0)
                  )}
                </td>
                {canWrite && (
                  <td>
                    {voided ? (
                      <span className="muted" title={e.void_reason ?? undefined}>
                        voided
                      </span>
                    ) : (
                      <details>
                        <summary>Correct</summary>
                        <div className="stack">
                          {uncategorized && cats.length > 0 && (
                            <form action={categorizeEntry} className="row-inline">
                              <input type="hidden" name="programId" value={program.id} />
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="entryId" value={e.id} />
                              {lineSelect("budget_line_id", "")}
                              <button type="submit" className="secondary">
                                Categorize
                              </button>
                            </form>
                          )}
                          <form action={voidEntry} className="row-inline">
                            <input type="hidden" name="programId" value={program.id} />
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="entryId" value={e.id} />
                            <input
                              type="text"
                              name="reason"
                              placeholder="Reason (required)"
                              required
                              aria-label="Void reason"
                            />
                            <button type="submit" className="linklike danger">
                              Void
                            </button>
                            <button
                              type="submit"
                              name="reenter"
                              value="1"
                              className="linklike"
                            >
                              Void &amp; re-enter
                            </button>
                          </form>
                        </div>
                      </details>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 7 : 6} className="muted">
                No entries match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="page-foot">
        Corrections are void + re-enter with a required reason — the audit log keeps
        everything. Voided rows never count toward balances.
      </p>
    </section>
  );
}
