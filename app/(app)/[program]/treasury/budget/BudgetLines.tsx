import { Fragment } from "react";
import Link from "next/link";
import {
  CATEGORY_DIRECTIONS,
  CATEGORY_DIRECTION_LABELS,
  formatCents,
  type CategoryDirection,
} from "@/lib/treasury";
import {
  addLine,
  updateLine,
  deleteLine,
  updateCategory,
  deleteCategory,
} from "./actions";

// One budget category and its lines (spec 005 US8-4). The table READS — a line
// is a name and a planned amount — and each row carries the standard edit
// popover, the same `<details>` the Season spine and the trip page use. Before
// this, every row rendered three live inputs and two submit buttons whether or
// not anyone meant to change anything, which made a twelve-line budget a wall
// of forty form controls and put "Delete" one mis-tap from "Save".
//
// The two things a category owns are two separately-labeled disclosures:
// adding a line is the everyday job, renaming or deleting the category is not,
// and they no longer share one "Add line · category settings" summary that told
// you neither. Writes are treasurer-only — `canWrite` is the same
// TREASURY_WRITE_ROLES check every action re-runs server-side.

export interface CategoryRow {
  id: string;
  name: string;
  direction: CategoryDirection;
  sort_order: number;
}

export interface LineRow {
  id: string;
  category_id: string;
  name: string;
  planned_cents: number;
  sort_order: number;
}

// A line's popover reopens on `?edit=line-<id>`; the key is built in one place
// so the action's redirect and the page's open test can't drift apart.
export const LINE_EDIT_PREFIX = "line-";

export function lineEditKey(lineId: string): string {
  return `${LINE_EDIT_PREFIX}${lineId}`;
}

export function BudgetCategory({
  programId,
  slug,
  cat,
  lines,
  canWrite,
  openKey,
  error,
  rowHref,
}: {
  programId: string;
  slug: string;
  cat: CategoryRow;
  lines: LineRow[];
  canWrite: boolean;
  openKey: string | null;
  error: string | null;
  // This page's URL with one line's panel open (or none). The panel opens in a
  // row of its own beneath, not in the last cell (spec 005 T143b), so the
  // trigger has to be a link rather than a <summary>.
  rowHref: (lineId: string | null) => string;
}) {
  const subtotal = lines.reduce((s, l) => s + l.planned_cents, 0);

  return (
    <div className="stack">
      <div className="row-inline">
        <h3 style={{ margin: 0 }}>{cat.name}</h3>
        <span className="num muted">planned {formatCents(subtotal)}</span>
      </div>

      <table className="members">
        <thead>
          <tr>
            <th>Line</th>
            <th className="num">Planned</th>
            {canWrite && <th className="table-action"></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const open = openKey === lineEditKey(l.id);
            return (
              <Fragment key={l.id}>
              <tr>
                <td>{l.name}</td>
                <td className="num">{formatCents(l.planned_cents)}</td>
                {canWrite && (
                  <td className="table-action">
                    <Link
                      href={rowHref(open ? null : l.id)}
                      className="money-disclosure"
                      aria-expanded={open}
                      aria-controls={open ? lineEditKey(l.id) : undefined}
                      aria-label={`Edit ${l.name}`}
                    >
                      {open ? "Close" : "Edit"}
                    </Link>
                  </td>
                )}
              </tr>
              {canWrite && open && (
                <tr className="table-panel-row" id={lineEditKey(l.id)}>
                  <td colSpan={3}>
                    <div className="table-panel">
                      <div className="stack money-fix-panel">
                        <h4 className="drawer-title">Edit line</h4>
                        {open && error && (
                          <p className="alert-error">{error}</p>
                        )}
                        <form
                          action={updateLine}
                          className="stack money-fix-form"
                        >
                          <input
                            type="hidden"
                            name="programId"
                            value={programId}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="lineId" value={l.id} />
                          <label>
                            Name
                            <input
                              type="text"
                              name="name"
                              defaultValue={l.name}
                              required
                            />
                          </label>
                          <div className="row-inline">
                            <label>
                              Planned $
                              <input
                                type="text"
                                name="planned"
                                inputMode="decimal"
                                defaultValue={(l.planned_cents / 100).toFixed(
                                  2,
                                )}
                              />
                            </label>
                            <label>
                              Order
                              <input
                                type="number"
                                name="sort_order"
                                defaultValue={l.sort_order}
                                style={{ width: "4rem" }}
                              />
                            </label>
                          </div>
                          <button type="submit" className="secondary">
                            Save line
                          </button>
                        </form>
                        <form action={deleteLine} className="money-fix-form">
                          <input
                            type="hidden"
                            name="programId"
                            value={programId}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="lineId" value={l.id} />
                          <button type="submit" className="linklike danger">
                            Delete this line
                          </button>
                        </form>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 3 : 2} className="muted">
                No lines yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <details className="stack">
            <summary className="money-disclosure">
              Add a line to {cat.name}
            </summary>
            <form action={addLine} className="row-inline money-connect">
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="categoryId" value={cat.id} />
              <label>
                Line name
                <input type="text" name="name" required placeholder="Hotels" />
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
          </details>

          <details className="stack">
            <summary className="money-disclosure">
              Category settings — rename, income or expense, order, delete
            </summary>
            <div className="stack money-connect">
              <form action={updateCategory} className="row-inline">
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="categoryId" value={cat.id} />
                <label>
                  Name
                  <input
                    type="text"
                    name="name"
                    defaultValue={cat.name}
                    required
                  />
                </label>
                <label>
                  Income or expense
                  <select name="direction" defaultValue={cat.direction}>
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
                    defaultValue={cat.sort_order}
                    style={{ width: "4rem" }}
                  />
                </label>
                <button type="submit" className="secondary">
                  Save category
                </button>
              </form>

              <form action={deleteCategory}>
                <input type="hidden" name="programId" value={programId} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="categoryId" value={cat.id} />
                <button type="submit" className="linklike danger">
                  Delete category “{cat.name}”
                </button>
              </form>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
