import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  formatCents,
  actualForDirection,
  lineActualsFromRows,
  lineVariance,
  seasonTotalsFromRow,
  type CategoryDirection,
  type LineActual,
  type LedgerSeasonTotals,
} from "@/lib/treasury";
import { TreasuryTabs } from "../TreasuryTabs";

// Budget vs Actual (T020). Per line: planned / actual (non-voided ledger sum) /
// variance, grouped income then expense, category subtotals, and a season header
// with planned in/out, actual in/out, and net. Read-only — no writes here.
//
// Actuals come from the same 0019 SQL aggregates the ledger page reads
// (ledger_season_totals for the header, ledger_line_actuals per line), not from
// a fetched entry list. Summing fetched rows meant both pages silently stopped
// at PostgREST's 1000-row cap — and could stop at DIFFERENT rows, so the two
// money screens could disagree with each other and neither would say so.

interface CatRow {
  id: string;
  name: string;
  direction: CategoryDirection;
  sort_order: number;
}
interface LineRow {
  id: string;
  category_id: string;
  name: string;
  planned_cents: number;
  sort_order: number;
}

export default async function BudgetVsActualPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Money" role={role} allowed={TREASURY_ROLES} />
    );
  }

  const supabase = await createClient();

  let budgetName: string | null = null;
  let cats: CatRow[] = [];
  let lines: LineRow[] = [];
  let actualByLine = new Map<string, LineActual>();
  let totals: LedgerSeasonTotals | null = null;
  // The per-line aggregate fails independently of the header aggregate, and its
  // failure used to collapse into an empty map while the only banner keyed on
  // the OTHER rpc — so every line printed "$0.00 actual" against a real planned
  // figure, and every variance read as a full-budget underspend.
  let actualsUnavailable = false;

  if (season) {
    const { data: budget } = await supabase
      .from("budgets")
      .select("id, name")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const b = budget as { id: string; name: string } | null;
    budgetName = b?.name ?? null;

    if (b) {
      const [{ data: catData }, lineActualsRes, totalsRes] = await Promise.all([
        supabase
          .from("budget_categories")
          .select("id, name, direction, sort_order")
          .eq("program_id", program.id)
          .eq("budget_id", b.id)
          .order("direction", { ascending: true })
          .order("sort_order", { ascending: true }),
        supabase.rpc("ledger_line_actuals", {
          p_program_id: program.id,
          p_season_id: season.id,
        }),
        supabase.rpc("ledger_season_totals", {
          p_program_id: program.id,
          p_season_id: season.id,
        }),
      ]);
      cats = (catData as CatRow[] | null) ?? [];
      actualsUnavailable = !!lineActualsRes.error;
      actualByLine = lineActualsRes.error
        ? new Map()
        : lineActualsFromRows(lineActualsRes.data);
      const totalsRow = Array.isArray(totalsRes.data)
        ? totalsRes.data[0]
        : totalsRes.data;
      totals = totalsRes.error ? null : seasonTotalsFromRow(totalsRow);

      if (cats.length > 0) {
        const { data: lineData } = await supabase
          .from("budget_lines")
          .select("id, category_id, name, planned_cents, sort_order")
          .eq("program_id", program.id)
          .in(
            "category_id",
            cats.map((c) => c.id),
          )
          .order("sort_order", { ascending: true });
        lines = (lineData as LineRow[] | null) ?? [];
      }
    }
  }

  const linesByCat = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByCat.get(l.category_id) ?? [];
    arr.push(l);
    linesByCat.set(l.category_id, arr);
  }

  // Header totals: planned per direction (sum of line planned), actual per
  // direction (non-voided ledger, tagged or not), net = actual in − actual out.
  const plannedByDir: Record<CategoryDirection, number> = { income: 0, expense: 0 };
  for (const c of cats) {
    for (const l of linesByCat.get(c.id) ?? []) {
      plannedByDir[c.direction] += l.planned_cents;
    }
  }
  // A failed totals read prints "—", never "$0.00" — a zero here would read as
  // "the season took in nothing", which is a claim, not a blank.
  const money = (cents: number | null): string =>
    cents === null ? "—" : formatCents(cents);

  const section = (dir: CategoryDirection) => {
    const secCats = cats.filter((c) => c.direction === dir);
    return (
      <div className="stack">
        <h2>{dir === "income" ? "Income" : "Expense"}</h2>
        <table className="members">
          <thead>
            <tr>
              <th>Line</th>
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
            </tr>
          </thead>
          {secCats.map((c) => {
              const catLines = linesByCat.get(c.id) ?? [];
              let cPlanned = 0;
              let cActual = 0;
              const rows = catLines.map((l) => {
                const a = actualForDirection(actualByLine.get(l.id), dir);
                cPlanned += l.planned_cents;
                cActual += a;
                return { l, a, v: lineVariance(l.planned_cents, a, dir) };
              });
              return (
                <tbody key={c.id}>
                  <tr>
                    <td colSpan={4}>
                      <strong>{c.name}</strong>
                    </td>
                  </tr>
                  {/* Planned is a budget row and is always known. Actual and
                      variance come off the ledger aggregate, so when that read
                      failed they are blanks, never zeros — "$0.00 spent" is a
                      claim about a season. */}
                  {rows.map(({ l, a, v }) => (
                    <tr key={l.id}>
                      <td style={{ paddingLeft: "1.5rem" }}>{l.name}</td>
                      <td className="num">{formatCents(l.planned_cents)}</td>
                      <td className="num">{money(actualsUnavailable ? null : a)}</td>
                      <td className="num">{money(actualsUnavailable ? null : v)}</td>
                    </tr>
                  ))}
                  {catLines.length === 0 && (
                    <tr>
                      <td className="muted" style={{ paddingLeft: "1.5rem" }}>
                        No lines.
                      </td>
                      <td className="num">{formatCents(0)}</td>
                      <td className="num">{money(actualsUnavailable ? null : 0)}</td>
                      <td className="num">{money(actualsUnavailable ? null : 0)}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ paddingLeft: "1.5rem" }} className="muted">
                      {c.name} subtotal
                    </td>
                    <td className="num">{formatCents(cPlanned)}</td>
                    <td className="num">
                      {money(actualsUnavailable ? null : cActual)}
                    </td>
                    <td className="num">
                      {money(
                        actualsUnavailable
                          ? null
                          : lineVariance(cPlanned, cActual, dir),
                      )}
                    </td>
                  </tr>
                </tbody>
              );
            })}
            {secCats.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={4} className="muted">
                    No {dir} categories.
                  </td>
                </tr>
              </tbody>
            )}
        </table>
      </div>
    );
  };

  return (
    <section className="stack">
      <TreasuryTabs slug={slug} active="bva" />
      <h1>Budget vs Actual</h1>
      <p className="muted">
        Planned versus what actually cleared the ledger (voided entries excluded).
        Positive variance is favorable: under budget on expense, ahead of plan on
        income.
      </p>

      {!season && <p className="alert-error">No active season.</p>}
      {season && !budgetName && (
        <p>
          No budget for <strong>{season.label}</strong> yet.{" "}
          <Link href={`/${slug}/treasury/budget`}>Build one</Link>.
        </p>
      )}

      {season && budgetName && (!totals || actualsUnavailable) && (
        <p className="alert-error">
          {!totals && actualsUnavailable
            ? "The season actuals could not be read just now, so the totals and every line's Actual below are blank rather than wrong."
            : !totals
              ? "The season actuals could not be read just now, so the header totals below are blank rather than wrong."
              : "The per-line actuals could not be read just now, so each line's Actual and Variance below are blank rather than wrong."}{" "}
          Reload to try again.
        </p>
      )}

      {season && budgetName && (
        <>
          <div className="detail-list">
            <div>
              <span className="muted">Budget</span>
              <span>{budgetName}</span>
            </div>
            <div>
              <span className="muted">Season</span>
              <span>{season.label}</span>
            </div>
          </div>

          <table className="members">
            <thead>
              <tr>
                <th></th>
                <th className="num">Planned</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Income</td>
                <td className="num">{formatCents(plannedByDir.income)}</td>
                <td className="num">{money(totals?.inCents ?? null)}</td>
                <td className="num">
                  {money(
                    totals
                      ? lineVariance(plannedByDir.income, totals.inCents, "income")
                      : null,
                  )}
                </td>
              </tr>
              <tr>
                <td>Expense</td>
                <td className="num">{formatCents(plannedByDir.expense)}</td>
                <td className="num">{money(totals?.outCents ?? null)}</td>
                <td className="num">
                  {money(
                    totals
                      ? lineVariance(
                          plannedByDir.expense,
                          totals.outCents,
                          "expense",
                        )
                      : null,
                  )}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Net</strong>
                </td>
                <td className="num">
                  <strong>
                    {formatCents(plannedByDir.income - plannedByDir.expense)}
                  </strong>
                </td>
                <td className="num">
                  <strong>{money(totals?.netCents ?? null)}</strong>
                </td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>

          {section("income")}
          {section("expense")}
        </>
      )}
    </section>
  );
}
