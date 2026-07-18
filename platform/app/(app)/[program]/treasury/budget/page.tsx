import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  TREASURY_WRITE_ROLES,
  CATEGORY_DIRECTIONS,
  formatCents,
  NO_HEALTH_LABEL,
  type CategoryDirection,
} from "@/lib/treasury";
import { TreasuryTabs } from "../TreasuryTabs";
import {
  createBudget,
  activateBudget,
  seedTemplate,
  addCategory,
  updateCategory,
  deleteCategory,
  addLine,
  updateLine,
  deleteLine,
} from "./actions";

// Budget builder (T018). Create a budget for the active season, define custom
// categories (income|expense) and lines (planned dollars → cents), and seed the
// §7 common structure with one click when empty. Reads gate on TREASURY_ROLES;
// writes gate on treasurer only (canWrite) — board/director/admin see the whole
// budget but every control is hidden for them.

interface BudgetRow {
  id: string;
  name: string;
  status: "draft" | "active" | "closed";
}
interface CategoryRow {
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

const ERR: Record<string, string> = {
  budget: "Could not save the budget. Check the name and try again.",
  active_exists:
    "Another budget is already active for this season. Close it before activating a new one.",
  category: "A category needs a name and a direction (income or expense).",
  line: "A line needs a name and a valid planned amount (e.g. 1,234.56).",
  cat_in_use: "Remove this category's lines before deleting it.",
  line_in_use:
    "This line has ledger entries tagged to it. Re-tag those entries (void + re-enter) before deleting the line.",
  not_empty: "This budget already has categories — the template only seeds an empty budget.",
};

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) notFound();
  const canWrite = TREASURY_WRITE_ROLES.includes(role);
  const { saved, error } = await searchParams;

  const supabase = await createClient();

  // The budget for the active season (draft or active). One per season is the
  // norm; if multiple drafts exist we take the newest.
  let budget: BudgetRow | null = null;
  if (season) {
    const { data } = await supabase
      .from("budgets")
      .select("id, name, status")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("status", { ascending: true }) // 'active' < 'closed' < 'draft' alphabetically; prefer active
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    budget = (data as BudgetRow | null) ?? null;
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

  const linesByCat = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByCat.get(l.category_id) ?? [];
    arr.push(l);
    linesByCat.set(l.category_id, arr);
  }

  const incomeCats = categories.filter((c) => c.direction === "income");
  const expenseCats = categories.filter((c) => c.direction === "expense");
  const isEmpty = categories.length === 0;

  return (
    <section className="stack">
      <TreasuryTabs slug={slug} active="budget" />
      <h1>Budget</h1>
      <p className="muted">
        A fully custom, two-level structure — your categories and lines. Planned
        amounts are entered in dollars and stored to the cent. One active budget
        per season.
      </p>

      {saved && <p className="alert-ok">Saved.</p>}
      {error && <p className="alert-error">{ERR[error] ?? "Something went wrong."}</p>}

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
                {cats.map((cat) => {
                  const catLines = linesByCat.get(cat.id) ?? [];
                  const subtotal = catLines.reduce(
                    (s, l) => s + l.planned_cents,
                    0,
                  );
                  return (
                    <div key={cat.id} className="stack">
                      <div className="row-inline">
                        <h3 style={{ margin: 0 }}>{cat.name}</h3>
                        <span className="num muted">
                          planned {formatCents(subtotal)}
                        </span>
                      </div>

                      <table className="members">
                        <thead>
                          <tr>
                            <th>Line</th>
                            <th className="num">Planned</th>
                            {canWrite && <th></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {catLines.map((l) =>
                            canWrite ? (
                              <tr key={l.id}>
                                <td colSpan={2}>
                                  <form
                                    action={updateLine}
                                    className="row-inline"
                                    id={`edit-line-${l.id}`}
                                  >
                                    <input
                                      type="hidden"
                                      name="programId"
                                      value={program.id}
                                    />
                                    <input type="hidden" name="slug" value={slug} />
                                    <input type="hidden" name="lineId" value={l.id} />
                                    <input
                                      type="text"
                                      name="name"
                                      defaultValue={l.name}
                                      required
                                      aria-label="Line name"
                                    />
                                    <input
                                      type="text"
                                      name="planned"
                                      inputMode="decimal"
                                      defaultValue={(l.planned_cents / 100).toFixed(2)}
                                      aria-label="Planned dollars"
                                    />
                                    <input
                                      type="number"
                                      name="sort_order"
                                      defaultValue={l.sort_order}
                                      aria-label="Sort order"
                                      style={{ width: "4rem" }}
                                    />
                                    <button type="submit" className="secondary">
                                      Save
                                    </button>
                                  </form>
                                </td>
                                <td>
                                  <form action={deleteLine}>
                                    <input
                                      type="hidden"
                                      name="programId"
                                      value={program.id}
                                    />
                                    <input type="hidden" name="slug" value={slug} />
                                    <input type="hidden" name="lineId" value={l.id} />
                                    <button type="submit" className="linklike danger">
                                      Delete
                                    </button>
                                  </form>
                                </td>
                              </tr>
                            ) : (
                              <tr key={l.id}>
                                <td>{l.name}</td>
                                <td className="num">
                                  {formatCents(l.planned_cents)}
                                </td>
                              </tr>
                            ),
                          )}
                          {catLines.length === 0 && (
                            <tr>
                              <td colSpan={canWrite ? 3 : 2} className="muted">
                                No lines yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      {canWrite && (
                        <details>
                          <summary>Add line · category settings</summary>
                          <div className="stack">
                            <form action={addLine} className="row-inline">
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="categoryId"
                                value={cat.id}
                              />
                              <label>
                                New line
                                <input type="text" name="name" required />
                              </label>
                              <label>
                                Planned $
                                <input
                                  type="text"
                                  name="planned"
                                  inputMode="decimal"
                                  placeholder="0.00"
                                />
                              </label>
                              <button type="submit">Add line</button>
                            </form>

                            <form action={updateCategory} className="row-inline">
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="categoryId"
                                value={cat.id}
                              />
                              <label>
                                Rename
                                <input
                                  type="text"
                                  name="name"
                                  defaultValue={cat.name}
                                  required
                                />
                              </label>
                              <label>
                                Direction
                                <select
                                  name="direction"
                                  defaultValue={cat.direction}
                                >
                                  {CATEGORY_DIRECTIONS.map((d) => (
                                    <option key={d} value={d}>
                                      {d}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Sort
                                <input
                                  type="number"
                                  name="sort_order"
                                  defaultValue={cat.sort_order}
                                  style={{ width: "4rem" }}
                                />
                              </label>
                              <button type="submit" className="secondary">
                                Save category
                              </button>
                            </form>

                            <form action={deleteCategory}>
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="categoryId"
                                value={cat.id}
                              />
                              <button type="submit" className="linklike danger">
                                Delete category “{cat.name}”
                              </button>
                            </form>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
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
                  <input type="text" name="name" required placeholder="Concessions" />
                </label>
                <label>
                  Direction
                  <select name="direction" defaultValue="expense">
                    {CATEGORY_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sort
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
