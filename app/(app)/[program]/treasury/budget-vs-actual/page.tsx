import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  lineActualsFromRows,
  seasonTotalsFromRow,
  pickSeasonBudget,
  type CategoryDirection,
  type LineActual,
  type LedgerSeasonTotals,
} from "@/lib/treasury";
import { SubTabs } from "../../SubTabs";
import { treasuryTabs } from "@/lib/subnav";
import {
  SeasonSummary,
  LineSection,
  type CatRow,
  type LineRow,
} from "./PlanTables";

// Budget vs Actual (T020, replanned in spec 005 Wave 12): what the season
// planned beside what actually cleared the ledger, line by line. Read-only —
// no writes here, for any seat.
//
// A load-and-compose page: this file reads, the tables render (PlanTables), the
// vocabulary lives with them. What it says out loud is the ledger's vocabulary
// — money in, money out, spent so far, still available — because a treasurer
// moving between the two screens should not have to translate.
//
// Actuals come from the same 0019 SQL aggregates the ledger page reads
// (ledger_season_totals for the header, ledger_line_actuals per line), not from
// a fetched entry list. Summing fetched rows meant both pages silently stopped
// at PostgREST's 1000-row cap — and could stop at DIFFERENT rows, so the two
// money screens could disagree with each other and neither would say so.

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
  // And the budget's own shape can fail on its own too. An empty category list
  // renders as "No money-in categories yet." — which is a statement about the
  // budget, not about the read, and it is false when the read is what failed.
  let structureUnavailable = false;

  if (season) {
    // The season's budget: the ACTIVE one, else the newest. Chosen here rather
    // than by `.order("status")`, which sorts the enum by declaration order and
    // so preferred the DRAFT — the opposite of what the board PDF prints
    // (lib/treasury pickSeasonBudget).
    const { data: budgetRows } = await supabase
      .from("budgets")
      .select("id, name, status")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("created_at", { ascending: false });
    const b = pickSeasonBudget(
      (budgetRows as { id: string; name: string; status: string }[] | null) ?? [],
    );
    budgetName = b?.name ?? null;

    if (b) {
      const [catRes, lineActualsRes, totalsRes] = await Promise.all([
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
      cats = (catRes.data as CatRow[] | null) ?? [];
      structureUnavailable = !!catRes.error;
      actualsUnavailable = !!lineActualsRes.error;
      actualByLine = lineActualsRes.error
        ? new Map()
        : lineActualsFromRows(lineActualsRes.data);
      const totalsRow = Array.isArray(totalsRes.data)
        ? totalsRes.data[0]
        : totalsRes.data;
      totals = totalsRes.error ? null : seasonTotalsFromRow(totalsRow);

      if (cats.length > 0) {
        const { data: lineData, error: lineError } = await supabase
          .from("budget_lines")
          .select("id, category_id, name, planned_cents, sort_order")
          .eq("program_id", program.id)
          .in(
            "category_id",
            cats.map((c) => c.id),
          )
          .order("sort_order", { ascending: true });
        lines = (lineData as LineRow[] | null) ?? [];
        if (lineError) structureUnavailable = true;
      }
    }
  }

  const linesByCat = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByCat.get(l.category_id) ?? [];
    arr.push(l);
    linesByCat.set(l.category_id, arr);
  }

  // Planned per direction — the sum of the budget's own line amounts, which are
  // rows we have in hand and are always known.
  const plannedByDir: Record<CategoryDirection, number> = { income: 0, expense: 0 };
  for (const c of cats) {
    for (const l of linesByCat.get(c.id) ?? []) {
      plannedByDir[c.direction] += l.planned_cents;
    }
  }

  return (
    <section className="stack">
      <SubTabs strip={treasuryTabs(slug, "bva")} />
      <h1>Budget vs Actual</h1>
      <p className="muted">
        What you planned, next to what actually happened. Voided entries never
        count. Positive numbers are good news — money still available to spend,
        or more taken in than planned; a negative number means the season has
        gone past its plan.
      </p>

      {!season && <p className="alert-error">No active season.</p>}
      {season && !budgetName && (
        <p>
          No budget for <strong>{season.label}</strong> yet.{" "}
          <Link href={`/${slug}/treasury/budget`}>Build one</Link>.
        </p>
      )}

      {/* Two aggregates and the budget's own shape feed this page and each can
          fail alone. The banner names whichever one is missing, because the
          figures it explains are blanks — and a blank nobody explained reads as
          "there is no money here". */}
      {season && budgetName && (!totals || actualsUnavailable) && (
        <p className="alert-error">
          {!totals && actualsUnavailable
            ? "The season actuals could not be read just now, so the totals and every line's figures below are blank rather than wrong."
            : !totals
              ? "The season actuals could not be read just now, so the header totals below are blank rather than wrong."
              : "The per-line actuals could not be read just now, so each line's figures below are blank rather than wrong."}{" "}
          Reload to try again.
        </p>
      )}

      {season && budgetName && structureUnavailable && (
        <p className="alert-error">
          The budget&apos;s categories and lines could not be read just now, so
          this page is showing less of the budget than it has — not an empty
          one. Reload to try again.
        </p>
      )}

      {season && budgetName && (
        <>
          <dl className="detail-list">
            <dt>Budget</dt>
            <dd>{budgetName}</dd>
            <dt>Season</dt>
            <dd>{season.label}</dd>
          </dl>

          {/* Planned is the sum of budget-line amounts — real numbers, unless
              the read that fetched those lines is the thing that failed, in
              which case the sum is zero for a reason that has nothing to do
              with the budget. Then it is a blank, like every other figure this
              page could not read. */}
          <SeasonSummary
            plannedIn={structureUnavailable ? null : plannedByDir.income}
            plannedOut={structureUnavailable ? null : plannedByDir.expense}
            totals={totals}
          />

          {(["income", "expense"] as CategoryDirection[]).map((dir) => (
            <LineSection
              key={dir}
              direction={dir}
              cats={cats}
              linesByCat={linesByCat}
              actualByLine={actualByLine}
              unavailable={actualsUnavailable}
            />
          ))}
        </>
      )}
    </section>
  );
}
