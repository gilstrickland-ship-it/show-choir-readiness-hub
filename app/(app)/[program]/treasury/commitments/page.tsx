import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  COMMITMENT_CREATE_ROLES,
  COMMITMENT_KINDS,
  TREASURY_WRITE_ROLES,
  commitmentDrawdownFromRows,
  commitmentTotalsFromRow,
  formatCents,
  ledgerPageRange,
  ledgerPageRangeUnknownTotal,
  parsePageParam,
  pickSeasonBudget,
  parseCommitmentKind,
  type CommitmentDrawdown,
  type CommitmentKind,
  type CommitmentTotals,
  type LedgerPageRange,
} from "@/lib/treasury";
import { zonedDateKey } from "@/lib/datetime";
import { SubTabs } from "../../SubTabs";
import { Flash } from "../../Flash";
import { readFlash, oneParam, type PageFlash } from "@/lib/flash";
import { treasuryTabs } from "@/lib/subnav";
import type { CatOpt, LineOpt, LineOptions } from "../shared";
import { AddCommitment } from "./AddCommitment";
import {
  CommitmentSection,
  type CommitmentListRow,
  type LinkedEntry,
} from "./CommitmentTable";
import {
  COMMITMENT_FLASH_MAPS,
  commitmentAnchor,
  type CommitmentSection as FlashSection,
} from "./flash";

// Commitments (spec 006 T174–T176) — the layer between what a season planned
// and what it has spent. Two sections, one per subtype, because they are two
// different promises rather than two signs of one number (decision D4):
//
//   Money we have promised   — reduces still-available on its budget line NOW,
//                              before any cash moves.
//   Money promised to us     — does NOT raise what may be spent until it lands.
//
// A load-and-compose page, like the ledger's: this file reads, the drawer and
// the table render, and the vocabulary lives with them. Never the word
// "encumbrance" (R9): the state is "committed", a district document is a
// purchase order, a booster one is approved spending.
//
// EVERY FIGURE IS A SQL AGGREGATE. The season roll-up is public.commitment_totals
// (0021) and each row's remaining balance is public.commitment_drawdown_rows
// (0022) asked for exactly the ids on this page. Nothing is summed over a fetched
// list, because PostgREST caps a response at `max_rows` and says nothing when it
// truncates — the defect that has now been fixed five times on the ledger. And a
// figure that could not be read renders "—", never $0.00.

const LIST_COLUMNS =
  "id, kind, funding_source, number, revision, revision_of_id, vendor, purpose, " +
  "amount_cents, shipping_cents, tax_cents, budget_line_id, need_by, status, " +
  "after_the_fact, external_ref, board_minutes_ref, note, requested_by, requested_at, " +
  "approved_by, approved_at, issued_at, received_at, closed_at, close_reason, " +
  "released_cents, cancelled_at, cancel_reason, superseded_at";

const PAGE_SIZE = 50;

// The most recent entries booked against the open commitment. The COUNT is
// exact, so the panel can say how many there are even when it lists a slice.
const LINKED_LIMIT = 50;

// Which URL param pages which section. Two lists on one page need two, or
// pressing "older" under the purchase orders would silently re-page the grants
// underneath them.
const PAGE_PARAM: Record<CommitmentKind, string> = {
  spending: "page",
  expected: "epage",
};

export default async function CommitmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param, so every read goes through
  // `oneParam` — a hand-typed URL must not 500 the page or smuggle an array into
  // a query filter.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season, isSupport } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Money" role={role} allowed={TREASURY_ROLES} />
    );
  }
  // Approve, issue, receive, close, cancel, annotate.
  const canWrite = !isSupport && TREASURY_WRITE_ROLES.includes(role);
  // Raise a request, and restate one — THE DELIBERATE RELAXATION (spec §4). A
  // director may ask; only the treasurer may approve. Support views never write.
  const canCreate = !isSupport && COMMITMENT_CREATE_ROLES.includes(role);

  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);
  const showAll = one("all") === "1";

  const supabase = await createClient();
  const today = zonedDateKey(new Date(), program.timezone);

  // ---- The budget's lines: the picker, and every row's line name ------------
  let cats: CatOpt[] = [];
  let lines: LineOpt[] = [];
  let structureUnavailable = false;
  if (season) {
    // The ACTIVE budget, else the newest — the shared choice (pickSeasonBudget).
    // `.order("status")` sorts the enum by DECLARATION order and so preferred
    // the DRAFT, which on this page would offer a commitment a budget line that
    // no other money surface is reading against.
    const { data: budgetRows, error: budgetError } = await supabase
      .from("budgets")
      .select("id, status")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("created_at", { ascending: false });
    if (budgetError) structureUnavailable = true;
    const budgetId =
      pickSeasonBudget(
        (budgetRows as { id: string; status: string }[] | null) ?? [],
      )?.id ?? null;

    if (budgetId) {
      const { data: catData, error: catError } = await supabase
        .from("budget_categories")
        .select("id, name, direction")
        .eq("program_id", program.id)
        .eq("budget_id", budgetId)
        .order("direction", { ascending: true })
        .order("sort_order", { ascending: true });
      cats = (catData as CatOpt[] | null) ?? [];
      if (catError) structureUnavailable = true;
      if (cats.length > 0) {
        const { data: lineData, error: lineError } = await supabase
          .from("budget_lines")
          .select("id, name, category_id")
          .eq("program_id", program.id)
          .in(
            "category_id",
            cats.map((c) => c.id),
          )
          .order("sort_order", { ascending: true });
        lines = (lineData as LineOpt[] | null) ?? [];
        if (lineError) structureUnavailable = true;
      }
    }
  }
  const options: LineOptions = { cats, lines };
  const lineName = new Map(lines.map((l) => [l.id, l.name]));

  // ---- The season roll-up ---------------------------------------------------
  let totals: CommitmentTotals | null = null;
  if (season) {
    const { data, error } = await supabase.rpc("commitment_totals", {
      p_program_id: program.id,
      p_season_id: season.id,
    });
    const row = Array.isArray(data) ? data[0] : data;
    totals = error ? null : commitmentTotalsFromRow(row);
  }

  // ---- One page per subtype -------------------------------------------------
  // Counted first, then exactly one page, with the SAME filters applied to both
  // — "showing 1–50 of 62" must never be describing a different set of rows than
  // the table underneath it.
  interface Section {
    rows: CommitmentListRow[];
    range: LedgerPageRange;
    countError: boolean;
  }
  const sections = new Map<CommitmentKind, Section>();

  for (const kind of COMMITMENT_KINDS) {
    if (!season) {
      sections.set(kind, {
        rows: [],
        range: ledgerPageRange(0, 1, PAGE_SIZE),
        countError: false,
      });
      continue;
    }
    const requested = parsePageParam(one(PAGE_PARAM[kind]));

    let countQuery = supabase
      .from("commitments")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .eq("kind", kind);
    let listQuery = supabase
      .from("commitments")
      .select(LIST_COLUMNS)
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .eq("kind", kind);
    // The default list is what is still LIVE. A closed, cancelled or superseded
    // document is history — real history, kept forever and one link away, but
    // not what "how much have we promised?" means.
    if (!showAll) {
      countQuery = countQuery
        .is("closed_at", null)
        .is("cancelled_at", null)
        .is("superseded_at", null);
      listQuery = listQuery
        .is("closed_at", null)
        .is("cancelled_at", null)
        .is("superseded_at", null);
    }

    // A DROPPED COUNT IS AN UNKNOWN TOTAL, NOT ZERO. ledgerPageRange(0, …) would
    // report "0 commitments" and render no pager at all, so a treasurer would
    // see exactly one page with nothing saying more followed it.
    const { count, error: countError } = await countQuery;
    const counted = countError ? null : ledgerPageRange(count ?? 0, requested, PAGE_SIZE);
    const from = counted ? counted.from : (requested - 1) * PAGE_SIZE;

    const { data } = await listQuery
      .order("requested_at", { ascending: false })
      // The unique tiebreaker, LAST. Two rows sharing a requested_at have no
      // defined order without it, and an ambiguous ORDER BY across .range() can
      // hand the same row back on two pages while another is never shown.
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    const rows = (data as CommitmentListRow[] | null) ?? [];
    sections.set(kind, {
      rows,
      range: counted ?? ledgerPageRangeUnknownTotal(requested, rows.length, PAGE_SIZE),
      countError: !!countError,
    });
  }

  const allRows = [...sections.values()].flatMap((s) => s.rows);

  // ---- What is left on each row, in SQL -------------------------------------
  let drawdown = new Map<string, CommitmentDrawdown>();
  if (season && allRows.length > 0) {
    const { data } = await supabase.rpc("commitment_drawdown_rows", {
      p_program_id: program.id,
      p_season_id: season.id,
      p_commitment_ids: allRows.map((r) => r.id),
    });
    drawdown = commitmentDrawdownFromRows(data);
  }

  // ---- Who asked and who approved ------------------------------------------
  const nameByUser = new Map<string, string>();
  const userIds = [
    ...new Set(
      allRows.flatMap((r) =>
        [r.requested_by, r.approved_by].filter((v): v is string => !!v),
      ),
    ),
  ];
  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of (data as { id: string; full_name: string | null }[] | null) ??
      []) {
      if (p.full_name) nameByUser.set(p.id, p.full_name);
    }
  }

  // ---- The open row's panel -------------------------------------------------
  // `?edit=<id>` opens ONE commitment's panel — and only when that row is really
  // on one of the two pages being rendered. A message aimed at a row that will
  // not render would render nowhere at all, so it falls OPEN to the page banner
  // (the ledger's rule, for the same reason).
  const flash = readFlash<FlashSection>(sp, COMMITMENT_FLASH_MAPS);
  const requestedOpen = one("edit");
  const openId =
    requestedOpen && allRows.some((r) => r.id === requestedOpen)
      ? requestedOpen
      : null;
  const rowOwned = flash.error?.section === "row";
  const rowError = rowOwned && openId ? flash.error!.message : null;
  const pageFlash: PageFlash<FlashSection> =
    rowOwned && !openId
      ? { ok: flash.ok, error: { section: "page", message: flash.error!.message } }
      : flash;

  // Closing is a two-step: the first press asks, with the actual amount and the
  // actual budget line in the sentence (R4). `?confirm=close_<id>` is what the
  // asking step looks like in the URL.
  const confirmParam = one("confirm");
  const confirmCloseId =
    canWrite && confirmParam?.startsWith("close_")
      ? confirmParam.slice("close_".length)
      : null;

  // The entries booked against the open commitment, listed newest first with an
  // exact count beside them.
  let linked: LinkedEntry[] | null = null;
  let linkedCount: number | null = null;
  if (openId) {
    const [{ count, error: countError }, { data, error }] = await Promise.all([
      supabase
        .from("ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("program_id", program.id)
        .eq("commitment_id", openId)
        .is("voided_at", null),
      supabase
        .from("ledger_entries")
        .select("id, entry_date, direction, amount_cents, counterparty, memo")
        .eq("program_id", program.id)
        .eq("commitment_id", openId)
        .is("voided_at", null)
        .order("entry_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(LINKED_LIMIT),
    ]);
    linked = error ? null : ((data as LinkedEntry[] | null) ?? []);
    linkedCount = countError ? null : (count ?? 0);
  }

  // ---- URL builders ---------------------------------------------------------
  // Paging and opening a panel keep the filter and each other's page, and drop
  // the one-shot params, so page 2 is not still shouting about page 1.
  const ONE_SHOT = ["edit", "error", "ok", "confirm", "add"];
  const keep = (drop: Set<string>): URLSearchParams => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value !== "string" || drop.has(key)) continue;
      qs.set(key, value);
    }
    return qs;
  };
  const href = (qs: URLSearchParams, hash = ""): string => {
    const query = qs.toString();
    return `/${slug}/treasury/commitments${query ? `?${query}` : ""}${hash}`;
  };
  const pageHrefFor =
    (kind: CommitmentKind) =>
    (target: number): string => {
      const qs = keep(new Set([...ONE_SHOT, PAGE_PARAM[kind]]));
      if (target > 1) qs.set(PAGE_PARAM[kind], String(target));
      return href(qs);
    };
  const rowHref = (id: string | null): string => {
    const qs = keep(new Set(ONE_SHOT));
    if (id) qs.set("edit", id);
    return href(qs, id ? `#${commitmentAnchor(id)}` : "");
  };
  const addHref = (kind: CommitmentKind): string => {
    const qs = keep(new Set(ONE_SHOT));
    qs.set("add", kind);
    return href(qs, `#add-commitment`);
  };
  const closeHref = (id: string): string => {
    const qs = keep(new Set(ONE_SHOT));
    qs.set("edit", id);
    // Pressing "Close it" a second time (or "Never mind") returns to the same
    // panel without the question.
    if (confirmCloseId !== id) qs.set("confirm", `close_${id}`);
    return href(qs, `#${commitmentAnchor(id)}`);
  };

  const metric = (value: string | null): string => value ?? "—";
  const attention = totals
    ? totals.staleCount + totals.overspentCount + totals.afterTheFactCount
    : null;
  const summaryFor = (kind: CommitmentKind): string => {
    if (!totals) return "totals could not be read";
    return kind === "spending"
      ? `${formatCents(totals.openCommittedCents)} still committed · ${totals.openCount} open`
      : `${formatCents(totals.openExpectedCents)} still expected · ${totals.expectedCount} open`;
  };
  const countErrored = [...sections.values()].some((s) => s.countError);
  const drawerKind: CommitmentKind =
    parseCommitmentKind(one("add") ?? "") ?? "spending";
  const drawerOpen = !!one("add");

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            Promised, not yet paid — the layer between planned and spent
          </p>
          <h1 className="page-h1">Commitments</h1>
        </div>
        {canCreate && season && (
          <div className="page-head-actions">
            <AddCommitment
              programId={program.id}
              slug={slug}
              seasonId={season.id}
              options={options}
              kind={drawerKind}
              open={drawerOpen}
            />
          </div>
        )}
      </div>

      <SubTabs strip={treasuryTabs(slug, "commitments")} />

      <Flash flash={pageFlash} section="page" />

      {!season && (
        <p className="alert-error">
          No active season. Commitments are season-scoped —{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link> to
          record them.
        </p>
      )}

      {season && !totals && (
        <p className="alert-error">
          The committed totals could not be read just now, so the figures below
          are blank rather than wrong. Reload to try again — and until they come
          back, treat what the budget says is left as a number that has not had
          the promises taken out of it.
        </p>
      )}

      {season && structureUnavailable && (
        <p className="alert-error">
          The budget&apos;s lines could not be read just now, so a commitment
          here may show no line name and the form may offer fewer lines than the
          budget has. Reload to try again.
        </p>
      )}

      {countErrored && (
        <p className="alert-error">
          How many commitments there are could not be read just now, so these
          lists say which ones they are showing but not how many exist. Keep
          paging with Older to see the rest.
        </p>
      )}

      <div className="metric-strip">
        <div className="metric-cell">
          <div className="metric-label">Still committed</div>
          <div className="metric-value">
            {metric(totals && formatCents(totals.openCommittedCents))}
          </div>
          <div className="metric-sub">
            money out we have promised · comes off{" "}
            <Link
              href={`/${slug}/treasury/budget-vs-actual`}
              className="metric-link"
            >
              still available
            </Link>
          </div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Still expected</div>
          <div className="metric-value ok">
            {metric(totals && formatCents(totals.openExpectedCents))}
          </div>
          <div className="metric-sub">
            promised to us · not available to spend
          </div>
        </div>
        <div className={`metric-cell${attention ? " warn" : ""}`}>
          <div className="metric-label">Needs a look</div>
          <div className="metric-value">
            {metric(attention === null ? null : String(attention))}
          </div>
          <div className="metric-sub">
            {!totals
              ? "count unavailable"
              : attention === 0
                ? "nothing overdue or overspent"
                : [
                    totals.staleCount > 0 ? `${totals.staleCount} overdue` : null,
                    totals.overspentCount > 0
                      ? `${totals.overspentCount} overspent`
                      : null,
                    totals.afterTheFactCount > 0
                      ? `${totals.afterTheFactCount} after the purchase`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </div>
        </div>
      </div>

      <p className="row-inline">
        {showAll ? (
          <Link href={href(keep(new Set([...ONE_SHOT, "all"])))}>
            Show only what is still open
          </Link>
        ) : (
          <Link
            href={(() => {
              const qs = keep(new Set(ONE_SHOT));
              qs.set("all", "1");
              return href(qs);
            })()}
          >
            Show closed and cancelled ones too
          </Link>
        )}
      </p>

      {COMMITMENT_KINDS.map((kind) => {
        const section = sections.get(kind)!;
        return (
          <CommitmentSection
            key={kind}
            kind={kind}
            rows={section.rows}
            range={section.range}
            pageHref={pageHrefFor(kind)}
            summary={summaryFor(kind)}
            addHref={canCreate && season ? addHref(kind) : null}
            programId={program.id}
            slug={slug}
            timeZone={program.timezone}
            today={today}
            lineName={lineName}
            drawdown={drawdown}
            nameByUser={nameByUser}
            canWrite={canWrite}
            canCreate={canCreate}
            openId={openId}
            error={rowError}
            confirmClose={
              !!confirmCloseId && !!openId && confirmCloseId === openId
            }
            linked={linked}
            linkedCount={linkedCount}
            rowHref={rowHref}
            closeHref={closeHref}
          />
        );
      })}

      <p className="page-foot">
        A commitment is never edited. Changing the amount records a revision that
        replaces it and keeps the same number, and closing one releases whatever
        is left back to its budget line — both are written down. Whoever raises a
        request cannot be the one who approves it.
      </p>
    </section>
  );
}
