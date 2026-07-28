import Link from "next/link";
import {
  COMMITMENT_KIND_LABELS,
  type CategoryDirection,
  type CommitmentKind,
  type LedgerPageRange,
} from "@/lib/treasury";

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

// An OPEN commitment this entry could be paying down (spec 006 R3). `name` is
// built on the server from the funding source, the number and the revision
// (lib/treasury commitmentRefLabel) so the picker says "PO 1042 — Costume Co",
// which is what a bookkeeper has in front of her. `kind` groups the list: a
// payment draws down a spending commitment, a receipt draws down expected money,
// and the two must never look like one another.
export interface CommitOpt extends NamedOpt {
  kind: CommitmentKind;
}

// The budget-line picker's own inputs. Separated from TagOptions because the
// commitments surface offers a budget line and nothing else — a commitment ties
// to a program-wide purpose and never to a competition, a trip or another
// commitment — and a form should not have to invent three empty lists to borrow
// one control.
export interface LineOptions {
  cats: CatOpt[];
  lines: LineOpt[];
}

export interface TagOptions extends LineOptions {
  comps: NamedOpt[];
  trips: NamedOpt[];
  commits: CommitOpt[];
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
  required,
}: {
  name: string;
  defaultValue: string;
  options: LineOptions;
  blankLabel: string;
  // A commitment without a budget line cannot exist — no line, no encumbrance,
  // no math (spec 006 §6) — so that one form asks for it. The ledger's does not:
  // an entry may arrive uncategorized and be filed later.
  required?: boolean;
}) {
  return (
    <select name={name} defaultValue={defaultValue} required={required}>
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

// The drawdown picker (spec 006 R3). Only OPEN commitments are offered — a
// closed or cancelled document is not something a treasurer means to pay down,
// and the money math counts only open ones — but the database accepts any
// status, so a late invoice against a closed purchase order can still be
// recorded from the commitment's own page.
//
// Grouped by subtype, because a payment out draws down what we promised and a
// receipt in draws down what was promised to us; one flat list would let a
// treasurer file a cheque against a grant award.
export function CommitmentSelect({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: TagOptions;
}) {
  const groups: CommitmentKind[] = ["spending", "expected"];
  return (
    <select name={name} defaultValue={defaultValue}>
      <option value="">Not against one</option>
      {groups.map((kind) => {
        const inGroup = options.commits.filter((c) => c.kind === kind);
        if (inGroup.length === 0) return null;
        return (
          <optgroup key={kind} label={COMMITMENT_KIND_LABELS[kind]}>
            {inGroup.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// ---------------------------------------------------------------------------
// How much of a list a page is actually showing, said out loud
// ---------------------------------------------------------------------------
// The ledger used to stop at PostgREST's 1000-row cap with nothing on screen
// saying so, and the fix — an explicit page plus "showing X–Y of N" — is now
// needed by every money list, not only that one. It lives here so the two
// surfaces cannot drift into two different accounts of the same silence: a
// failed COUNT is an UNKNOWN total, which is a different thing from zero, and
// the pager must keep working off the page number alone when it happens.
//
// Prev/Next are plain links — the page re-renders on the server, so paging works
// with no client JavaScript.
export function Pager({
  range,
  pageHref,
  noun,
}: {
  range: LedgerPageRange;
  pageHref: (page: number) => string;
  // Singular and plural, so the sentence reads as the list it is describing
  // ("of 412 entries", "of 9 commitments").
  noun: { one: string; many: string };
}) {
  if (range.totalKnown && range.total === 0) return null;
  if (!range.totalKnown && range.firstShown === 0 && !range.hasPrev) return null;
  return (
    <div className="row-inline money-pager">
      <span className="muted">
        {range.totalKnown ? (
          <>
            Showing {range.firstShown}–{range.lastShown} of {range.total}{" "}
            {range.total === 1 ? noun.one : noun.many}
            {range.pages > 1 ? ` · page ${range.page} of ${range.pages}` : ""}
          </>
        ) : (
          // The count failed. Say which rows these are and page on; claiming a
          // total we could not read is how "100 entries" became the whole book.
          <>
            Showing {range.firstShown}–{range.lastShown} · page {range.page} ·
            the total couldn&apos;t be read
          </>
        )}
      </span>
      {range.hasPrev && (
        <Link href={pageHref(range.page - 1)} rel="prev">
          ← Newer
        </Link>
      )}
      {range.hasNext && (
        <Link href={pageHref(range.page + 1)} rel="next">
          Older →
        </Link>
      )}
    </div>
  );
}
