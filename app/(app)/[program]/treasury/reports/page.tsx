import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeInTz } from "@/lib/datetime";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  formatCents,
  sumActuals,
  type CategoryDirection,
  type LedgerDirection,
} from "@/lib/treasury";
import { TreasuryTabs } from "../TreasuryTabs";

// Reports (T020): per-event cost report (competition or trip → income/expense/
// net + line breakdown) and a read-only board-snapshot data page (totals,
// category rollups, uncategorized note, as-of stamp) that links to the P5 PDF
// at /api/pdf/board-snapshot?season=... . Read-only; no writes.

interface CatRow {
  id: string;
  name: string;
  direction: CategoryDirection;
}
interface LineRow {
  id: string;
  category_id: string;
  name: string;
}
interface EntryRow {
  direction: LedgerDirection;
  amount_cents: number;
  voided_at: string | null;
  budget_line_id: string | null;
  competition_id: string | null;
  trip_id: string | null;
}
interface NamedRow {
  id: string;
  name: string;
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Money" role={role} allowed={TREASURY_ROLES} />
    );
  }
  const { event } = await searchParams;

  const supabase = await createClient();

  let cats: CatRow[] = [];
  let lines: LineRow[] = [];
  let entries: EntryRow[] = [];
  let comps: NamedRow[] = [];
  let trips: NamedRow[] = [];

  if (season) {
    const [{ data: budget }, { data: compData }, { data: tripData }, { data: entryData }] =
      await Promise.all([
        supabase
          .from("budgets")
          .select("id, name")
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("status", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
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
        supabase
          .from("ledger_entries")
          .select(
            "direction, amount_cents, voided_at, budget_line_id, competition_id, trip_id",
          )
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .is("voided_at", null),
      ]);

    const b = budget as { id: string; name: string } | null;
    comps = (compData as NamedRow[] | null) ?? [];
    trips = (tripData as NamedRow[] | null) ?? [];
    entries = (entryData as EntryRow[] | null) ?? [];

    if (b) {
      const { data: catData } = await supabase
        .from("budget_categories")
        .select("id, name, direction")
        .eq("program_id", program.id)
        .eq("budget_id", b.id)
        .order("direction", { ascending: true })
        .order("sort_order", { ascending: true });
      cats = (catData as CatRow[] | null) ?? [];
      if (cats.length > 0) {
        const { data: lineData } = await supabase
          .from("budget_lines")
          .select("id, category_id, name")
          .eq("program_id", program.id)
          .in(
            "category_id",
            cats.map((c) => c.id),
          );
        lines = (lineData as LineRow[] | null) ?? [];
      }
    }
  }

  const lineName = new Map(lines.map((l) => [l.id, l.name]));
  const lineCat = new Map(lines.map((l) => [l.id, l.category_id]));
  const catById = new Map(cats.map((c) => [c.id, c]));

  // ---- Board snapshot rollups ----------------------------------------------
  const snapshot = sumActuals(entries);
  const catActual = new Map<string, number>();
  let uncategorizedCount = 0;
  let uncategorizedTotal = 0;
  for (const e of entries) {
    if (e.budget_line_id) {
      const catId = lineCat.get(e.budget_line_id);
      if (catId) {
        catActual.set(catId, (catActual.get(catId) ?? 0) + e.amount_cents);
      }
    } else {
      uncategorizedCount += 1;
      uncategorizedTotal += e.amount_cents;
    }
  }
  const asOf = formatDateTimeInTz(new Date(), program.timezone);

  // ---- Per-event cost report ------------------------------------------------
  const kind = event?.startsWith("comp:")
    ? "comp"
    : event?.startsWith("trip:")
      ? "trip"
      : null;
  const eventId = kind ? event!.slice(5) : null;
  const eventName = kind
    ? kind === "comp"
      ? (comps.find((c) => c.id === eventId)?.name ?? null)
      : (trips.find((t) => t.id === eventId)?.name ?? null)
    : null;

  const eventEntries = eventId
    ? entries.filter((e) =>
        kind === "comp" ? e.competition_id === eventId : e.trip_id === eventId,
      )
    : [];
  const eventTotals = sumActuals(eventEntries);
  // Line breakdown within the event.
  const eventByLine = new Map<string | null, number>();
  for (const e of eventEntries) {
    const key = e.budget_line_id;
    eventByLine.set(key, (eventByLine.get(key) ?? 0) + e.amount_cents);
  }

  return (
    <section className="stack">
      <TreasuryTabs slug={slug} active="reports" />
      <h1>Reports</h1>

      {!season && <p className="alert-error">No active season.</p>}

      {season && (
        <>
          {/* Per-event cost report */}
          <div className="stack">
            <h2>Per-event cost report</h2>
            <p className="muted">
              What a competition or trip actually cost — income, expense, and net
              for every entry tagged to it.
            </p>
            <form method="get" className="row-inline">
              <label>
                Event
                <select name="event" defaultValue={event ?? ""}>
                  <option value="">Choose a competition or trip…</option>
                  {comps.length > 0 && (
                    <optgroup label="Competitions">
                      {comps.map((c) => (
                        <option key={c.id} value={`comp:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {trips.length > 0 && (
                    <optgroup label="Trips">
                      {trips.map((t) => (
                        <option key={t.id} value={`trip:${t.id}`}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <button type="submit" className="secondary">
                Run
              </button>
            </form>

            {eventId && eventName && (
              <div className="stack">
                <div className="detail-list">
                  <div>
                    <span className="muted">Event</span>
                    <span>{eventName}</span>
                  </div>
                  <div>
                    <span className="muted">Income</span>
                    <span className="num">{formatCents(eventTotals.inCents)}</span>
                  </div>
                  <div>
                    <span className="muted">Expense</span>
                    <span className="num">{formatCents(eventTotals.outCents)}</span>
                  </div>
                  <div>
                    <span className="muted">Net</span>
                    <span className="num">
                      <strong>{formatCents(eventTotals.netCents)}</strong>
                    </span>
                  </div>
                </div>
                <table className="members">
                  <thead>
                    <tr>
                      <th>Budget line</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...eventByLine.entries()].map(([lid, amt]) => (
                      <tr key={lid ?? "uncat"}>
                        <td>
                          {lid ? (
                            (lineName.get(lid) ?? "—")
                          ) : (
                            <span className="muted">uncategorized</span>
                          )}
                        </td>
                        <td className="num">{formatCents(amt)}</td>
                      </tr>
                    ))}
                    {eventEntries.length === 0 && (
                      <tr>
                        <td colSpan={2} className="muted">
                          No entries tagged to this event.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Board snapshot data */}
          <div className="stack">
            <h2>Board snapshot</h2>
            <p className="muted">
              The monthly-meeting summary. Full financial transparency to the
              board is a fiduciary norm — and the treasurer&apos;s protection.
              As of {asOf}.
            </p>

            <div className="detail-list">
              <div>
                <span className="muted">Income (actual)</span>
                <span className="num">{formatCents(snapshot.inCents)}</span>
              </div>
              <div>
                <span className="muted">Expense (actual)</span>
                <span className="num">{formatCents(snapshot.outCents)}</span>
              </div>
              <div>
                <span className="muted">Net</span>
                <span className="num">
                  <strong>{formatCents(snapshot.netCents)}</strong>
                </span>
              </div>
            </div>

            <h3>Category rollups</h3>
            <table className="members">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Direction</th>
                  <th className="num">Actual</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{catById.get(c.id)?.direction}</td>
                    <td className="num">{formatCents(catActual.get(c.id) ?? 0)}</td>
                  </tr>
                ))}
                {cats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No budget categories yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {uncategorizedCount > 0 ? (
              <p className="alert-error">
                {uncategorizedCount} uncategorized{" "}
                {uncategorizedCount === 1 ? "entry" : "entries"} totaling{" "}
                {formatCents(uncategorizedTotal)} are not reflected in the
                category rollups above.{" "}
                <Link href={`/${slug}/treasury?uncategorized=1`}>Clear them</Link>.
              </p>
            ) : (
              <p className="muted">All entries are categorized.</p>
            )}

            <p>
              <a
                href={`/api/pdf/board-snapshot?season=${season.id}`}
                className="secondary"
              >
                Download board snapshot (PDF)
              </a>
            </p>
          </div>
        </>
      )}
    </section>
  );
}
