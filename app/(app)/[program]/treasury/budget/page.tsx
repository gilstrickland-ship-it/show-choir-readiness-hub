import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  TREASURY_WRITE_ROLES,
  CATEGORY_DIRECTIONS,
  CATEGORY_DIRECTION_LABELS,
  formatCents,
  NO_HEALTH_LABEL,
  pickSeasonBudget,
  type CategoryDirection,
} from "@/lib/treasury";
import { SubTabs } from "../../SubTabs";
import { treasuryTabs } from "@/lib/subnav";
import { IntroStrip, HelpDot } from "../../IntroStrip";
import { loadGuideState } from "@/lib/guide";
import {
  BudgetCategory,
  LINE_EDIT_PREFIX,
  lineEditKey,
  type CategoryRow,
  type LineRow,
} from "./BudgetLines";
import { createBudget, activateBudget, seedTemplate, addCategory } from "./actions";

// Budget builder (T018). Create a budget for the active season, define custom
// categories (income|expense) and lines (planned dollars → cents), and seed the
// §7 common structure with one click when empty. Reads gate on TREASURY_ROLES;
// writes gate on treasurer only (canWrite) — board/director/admin see the whole
// budget but every control is hidden for them. The per-category table, its line
// popovers, and the two category disclosures live in BudgetLines.

interface BudgetRow {
  id: string;
  name: string;
  status: "draft" | "active" | "closed";
}

// Page-level messages. `line` and `line_in_use` belong to one line, so they
// travel with `?edit=line-<id>` and render inside that row's popover instead.
const ERR: Record<string, string> = {
  budget: "Could not save the budget. Check the name and try again.",
  active_exists:
    "Another budget is already active for this season. Close it before activating a new one.",
  category: "A category needs a name and a direction (income or expense).",
  cat_in_use: "Remove this category's lines before deleting it.",
  not_empty:
    "This budget already has categories — the template only seeds an empty budget.",
  budget_gone: "That budget is no longer here. Nothing was changed.",
  category_gone: "That category is no longer here. Nothing was changed.",
};

const LINE_ERR: Record<string, string> = {
  line: "A line needs a name and a valid planned amount (e.g. 1,234.56).",
  line_in_use:
    "This line has ledger entries tagged to it. Re-tag those entries (void + redo) before deleting the line.",
  line_gone: "That line is no longer here. Nothing was changed.",
};

function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param, so every read goes through
  // `one()` — a hand-typed URL must not 500 the page.
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

  // First-use intro strip (spec 003 §3) — orientation only; the empty-state below
  // still carries the "start from a template" offer, so this doesn't repeat it.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(supabase, program.id, membership.user_id)
      : {};

  // The budget for the active season (draft or active). One per season is the
  // norm; if multiple exist, the ACTIVE one, else the newest — the same choice
  // every other treasury surface makes. It was `.order("status")` under a
  // comment claiming that ordering preferred 'active' alphabetically; Postgres
  // orders an enum by DECLARATION order, so it preferred the draft, and this
  // editor edited a different budget from the one the reports read
  // (lib/treasury pickSeasonBudget).
  let budget: BudgetRow | null = null;
  if (season) {
    const { data } = await supabase
      .from("budgets")
      .select("id, name, status")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("created_at", { ascending: false });
    budget = pickSeasonBudget((data as BudgetRow[] | null) ?? []);
  }

  let categories: CategoryRow[] = [];
  let lines: LineRow[] = [];
  if (budget) {
    const [{ data: catData }, { data: lineData }] = await Promise.all([
      supabase
        .from("budget_categories")
        .select("id, name, direction, sort_order")
        .eq("program_id", program.id)
        .eq("budget_id", budget.id)
        .order("direction", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("budget_lines")
        .select("id, category_id, name, planned_cents, sort_order")
        .eq("program_id", program.id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    categories = (catData as CategoryRow[] | null) ?? [];
    const catIds = new Set(categories.map((c) => c.id));
    lines = ((lineData as LineRow[] | null) ?? []).filter((l) =>
      catIds.has(l.category_id),
    );
  }

  const incomeCats = categories.filter((c) => c.direction === "income");
  const expenseCats = categories.filter((c) => c.direction === "expense");
  const isEmpty = categories.length === 0;

  // A line's edit popover reopens on `?edit=line-<id>` carrying its own message
  // (the Wave-2 section-local error contract); everything else is page-level.
  // The row-scoped message only stays row-scoped while that row is actually on
  // screen — a line that was deleted, or that belongs to another program, has no
  // popover to render into, and a message that renders nowhere is worse than one
  // in the wrong place. Those fail OPEN to the page banner.
  const errorCode = one("error");
  const openKey = canWrite ? one("edit") : null;
  // Open (or close) ONE line's panel. `?edit=` is the same param a refused save
  // comes back on, so the link and the redirect land in exactly the same place.
  const rowHref = (lineId: string | null): string => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value !== "string") continue;
      if (key === "edit" || key === "error" || key === "saved") continue;
      qs.set(key, value);
    }
    if (lineId) qs.set("edit", lineEditKey(lineId));
    const query = qs.toString();
    return `/${slug}/treasury/budget${query ? `?${query}` : ""}${
      lineId ? `#${lineEditKey(lineId)}` : ""
    }`;
  };
  const openLineId = openKey?.startsWith(LINE_EDIT_PREFIX)
    ? openKey.slice(LINE_EDIT_PREFIX.length)
    : null;
  const lineWillRender = !!openLineId && lines.some((l) => l.id === openLineId);
  const lineError = lineWillRender ? message(LINE_ERR, errorCode) : null;
  const pageError = lineError
    ? null
    : (message(ERR, errorCode) ?? message(LINE_ERR, errorCode));
  const unknownError = errorCode && !lineError && !pageError;

  // Fair-share guide (display-only): planned expenses ÷ students in the active
  // season. Derived purely — no inputs, no persistence. The student count is one
  // extra query, run only when there's an active budget to attach it to. Distinct
  // students (a performer can sit in more than one ensemble). Per-student cents
  // round UP so the share never under-collects by a rounding penny.
  const plannedExpenseCents = (() => {
    const expenseCatIds = new Set(expenseCats.map((c) => c.id));
    return lines
      .filter((l) => expenseCatIds.has(l.category_id))
      .reduce((s, l) => s + l.planned_cents, 0);
  })();
  let fairShareStudents = 0;
  if (budget?.status === "active" && season) {
    const { data: memRows } = await supabase
      .from("ensemble_members")
      .select("student_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id);
    fairShareStudents = new Set(
      ((memRows as { student_id: string }[] | null) ?? []).map(
        (m) => m.student_id,
      ),
    ).size;
  }
  const showFairShare = budget?.status === "active" && fairShareStudents > 0;
  const perStudentCents = showFairShare
    ? Math.ceil(plannedExpenseCents / fairShareStudents)
    : 0;

  return (
    <section className="stack">
      <SubTabs strip={treasuryTabs(slug, "budget")} />
      <div className="page-title-row">
        <h1>Budget</h1>
        {showGuide && <HelpDot href={`/${slug}/treasury/budget?help=1`} />}
      </div>
      {showGuide && (
        <IntroStrip
          surfaceKey="budget"
          programId={program.id}
          selfPath={`/${slug}/treasury/budget`}
          guideState={guideState}
          help={one("help") === "1"}
          canWrite={canWrite}
        />
      )}
      <p className="muted">
        A fully custom, two-level structure — your categories and lines. Planned
        amounts are entered in dollars and stored to the cent. One active budget
        per season.
      </p>

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {(pageError || unknownError) && (
        <p className="alert-error">{pageError ?? "Something went wrong."}</p>
      )}

      {!season && (
        <p className="alert-error">
          No active season. Set an active season in Settings before building a
          budget.
        </p>
      )}

      {season && !budget && (
        <div className="stack">
          <p>
            No budget yet for <strong>{season.label}</strong>.
          </p>
          {canWrite ? (
            <form action={createBudget} className="row-inline">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="seasonId" value={season.id} />
              <label>
                Budget name
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={`${season.label} Budget`}
                />
              </label>
              <button type="submit">Create budget</button>
            </form>
          ) : (
            <p className="muted">The treasurer hasn&apos;t created one yet.</p>
          )}
        </div>
      )}

      {budget && (
        <>
          <div className="row-inline">
            <h2 style={{ margin: 0 }}>{budget.name}</h2>
            <span className="badge">{budget.status}</span>
            {canWrite && budget.status === "draft" && (
              <form action={activateBudget}>
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="budgetId" value={budget.id} />
                <button type="submit" className="secondary">
                  Activate
                </button>
              </form>
            )}
          </div>

          {showFairShare && (
            <div className="fair-share-card">
              <p className="fair-share-line">
                Fair share: planned expenses{" "}
                <strong>{formatCents(plannedExpenseCents)}</strong> ÷{" "}
                {fairShareStudents} student{fairShareStudents === 1 ? "" : "s"}{" "}
                = <strong>{formatCents(perStudentCents)}</strong> per student
              </p>
              <p className="muted fair-share-note">
                A per-student share is a budgeting guide. IRS rules for booster
                nonprofits: fundraising must benefit the group, not track to
                individual students&apos; accounts.
              </p>
            </div>
          )}

          {canWrite && isEmpty && (
            <div className="confirm-box stack">
              <p>
                Start from a template? Seeds the common show-choir structure
                (Dues, Fundraising, Donations, Costumes, Choreography, Travel,
                Competition fees) as an editable starting point.
              </p>
              <form action={seedTemplate}>
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="budgetId" value={budget.id} />
                <button type="submit">Start from template</button>
              </form>
            </div>
          )}

          {(["income", "expense"] as CategoryDirection[]).map((dir) => {
            const cats = dir === "income" ? incomeCats : expenseCats;
            return (
              <div key={dir} className="stack">
                <h2>{dir === "income" ? "Income" : "Expense"}</h2>
                {cats.length === 0 && (
                  <p className="muted">No {dir} categories yet.</p>
                )}
                {cats.map((cat) => (
                  <BudgetCategory
                    key={cat.id}
                    programId={program.id}
                    slug={slug}
                    cat={cat}
                    lines={lines.filter((l) => l.category_id === cat.id)}
                    canWrite={canWrite}
                    openKey={openKey}
                    rowHref={rowHref}
                    error={lineError}
                  />
                ))}
              </div>
            );
          })}

          {canWrite && (
            <>
              <h2>Add a category</h2>
              <form action={addCategory} className="row-inline">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="budgetId" value={budget.id} />
                <label>
                  Name
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="Concessions"
                  />
                </label>
                <label>
                  Income or expense
                  <select name="direction" defaultValue="expense">
                    {CATEGORY_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {CATEGORY_DIRECTION_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Order
                  <input
                    type="number"
                    name="sort_order"
                    defaultValue={0}
                    style={{ width: "4rem" }}
                  />
                </label>
                <button type="submit">Add category</button>
              </form>
              <p className="muted">{NO_HEALTH_LABEL}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
