import Link from "next/link";
import {
  PIECE_KINDS,
  PIECE_CONDITIONS,
  PIECE_KIND_LABELS,
  PIECE_CONDITION_LABELS,
} from "@/lib/costumes";

// The inventory filter row (spec 005 US14-1). Two controls answer the question
// a costume manager actually arrives with — "where is dress 14?" — so search and
// what-it-is stay visible; the two that answer a stocktake's question (which
// set, what condition) fold into one "More filters". The summary counts what is
// on, and the disclosure starts OPEN whenever any of them is, because a filtered
// list that doesn't say why is how a closet appears to be missing things.
//
// A plain GET form: the URL is the filter state, so it is shareable (the
// landing's "Condition flags" card links straight into ?condition=fair), and
// the default — no query at all — renders exactly the list it always did.

export function InventoryFilters({
  slug,
  sets,
  q,
  kind,
  set,
  condition,
}: {
  slug: string;
  sets: { id: string; name: string }[];
  q: string;
  kind: string;
  set: string;
  condition: string;
}) {
  const moreOn = [set, condition].filter((v) => v !== "" && v !== "all").length;

  return (
    <form method="get" className="row-inline wardrobe-filters">
      <label>
        Search
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name, colour or where it lives"
        />
      </label>
      <label>
        What it is
        <select name="kind" defaultValue={kind}>
          <option value="all">Everything</option>
          {PIECE_KINDS.map((k) => (
            <option key={k} value={k}>
              {PIECE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      <details className="stack wardrobe-more" open={moreOn > 0}>
        <summary className="wardrobe-disclosure">
          More filters — {moreOn > 0 ? `${moreOn} on` : "none on"}
        </summary>
        <div className="row-inline wardrobe-more-panel">
          <label>
            Set
            <select name="set" defaultValue={set}>
              <option value="all">All sets</option>
              <option value="none">Not in a set</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Condition
            <select name="condition" defaultValue={condition}>
              <option value="all">Any condition</option>
              {PIECE_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {PIECE_CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <button type="submit" className="secondary">
        Filter
      </button>
      <Link href={`/${slug}/costumes/inventory`}>Clear</Link>
    </form>
  );
}
