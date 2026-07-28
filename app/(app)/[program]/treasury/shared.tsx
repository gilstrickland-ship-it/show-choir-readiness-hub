import type { CategoryDirection } from "@/lib/treasury";

// What an entry can be connected to, loaded once by the ledger page and handed
// to the three places that offer it: the add-entry drawer, a row's fix popover,
// and the filter row's "More filters". One shape and one grouped <select> here
// instead of three near-copies that drifted apart (the budget-line picker used
// to label its groups differently in the form and in the filter).

export interface CatOpt {
  id: string;
  name: string;
  direction: CategoryDirection;
}
export interface LineOpt {
  id: string;
  name: string;
  category_id: string;
}
export interface NamedOpt {
  id: string;
  name: string;
}

export interface TagOptions {
  cats: CatOpt[];
  lines: LineOpt[];
  comps: NamedOpt[];
  trips: NamedOpt[];
}

// Name for a tagged id, or null when nothing is tagged. Linear over lists that
// are a season's worth of budget lines / competitions / trips — small enough
// that a lookup map would cost more to keep in sync than it saves.
export function optionName(
  list: readonly NamedOpt[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return list.find((o) => o.id === id)?.name ?? null;
}

// The budget-line picker: lines grouped under their category, with the category
// direction spelled out so "Travel" under Income and "Travel" under Expense are
// never the same-looking choice.
export function LineSelect({
  name,
  defaultValue,
  options,
  blankLabel,
}: {
  name: string;
  defaultValue: string;
  options: TagOptions;
  blankLabel: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue}>
      <option value="">{blankLabel}</option>
      {options.cats.map((c) => (
        <optgroup
          key={c.id}
          label={`${c.direction === "income" ? "Income" : "Expense"} — ${c.name}`}
        >
          {options.lines
            .filter((l) => l.category_id === c.id)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
