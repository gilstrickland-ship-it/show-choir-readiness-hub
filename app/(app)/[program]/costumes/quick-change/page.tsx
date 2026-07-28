import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COSTUMES_ROLES } from "@/lib/nav";
import { competitionEnsembleIds } from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { EnsembleGrid } from "./EnsembleGrid";

// The quick-change sheet (spec 005 US15). Not a tab — a printable view, reached
// from Checkout, because it is a piece of paper you carry into the wings, not a
// place you go to do something.
//
// It is also the highest jargon density in the product, so the page teaches its
// own model in one sentence before the grid: a column is the GAP between two
// costume sets, and each column is named for the two numbers it sits between
// ("Opener → Ballad") rather than for their sort order.
//
// Print: the app chrome, the picker and the explanatory copy drop away, each
// ensemble starts on its own sheet, and the grids stop scrolling and lay out at
// full width (@media print in globals.css).

interface CompRow {
  id: string;
  name: string;
  date: string | null;
  season_id: string;
}

export default async function QuickChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param, so every read goes through
  // `one()` — a hand-typed URL must not 500 the page or smuggle an array into a
  // query filter.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Wardrobe" role={role} allowed={COSTUMES_ROLES} />
    );
  }
  const tz = program.timezone;

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };
  const selectedCompId = one("competition");

  const supabase = await createClient();

  // Competition picker — every competition in the program (most recent first).
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name, date, season_id")
    .eq("program_id", program.id)
    .order("date", { ascending: false, nullsFirst: false });
  const competitions = (compData as CompRow[] | null) ?? [];
  const comp = competitions.find((c) => c.id === selectedCompId) ?? null;
  const compDate = comp?.date
    ? formatDateInTz(`${comp.date}T12:00:00Z`, tz)
    : null;

  return (
    <section className="stack">
      <div className="page-head qc-chrome">
        <div className="page-head-titles">
          <p className="eyebrow">
            <Link href={`/${slug}/costumes/checkout`}>← Checkout</Link> · sheet to
            print
          </p>
          <h1 className="page-h1">Quick change</h1>
        </div>
      </div>

      {/* The one sentence that teaches the model, before anything else. */}
      <p className="qc-explainer">
        Each column is a costume change between numbers — what comes off, what
        goes on.
      </p>

      <p className="muted qc-chrome">
        Pick a competition, then print the page (⌘-P or Ctrl-P). Each ensemble
        prints on its own sheet, with absent students marked.
      </p>

      <form method="get" className="row-inline wardrobe-filters qc-chrome">
        <label>
          Competition
          <select name="competition" defaultValue={selectedCompId ?? ""}>
            <option value="">Choose a competition…</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.date ? ` — ${formatDateInTz(`${c.date}T12:00:00Z`, tz)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">
          Open
        </button>
      </form>

      {comp && (
        <>
          {/* Survives the print, so the paper says what it is for. */}
          <p className="qc-standfirst">
            <strong>{comp.name}</strong>
            {compDate ? ` · ${compDate}` : ""}
          </p>
          <QuickChangeForComp programId={program.id} comp={comp} />
        </>
      )}
    </section>
  );
}

// Fan the sheet out over the competition's participating ensembles, one grid
// each — a competition can include several (Feature 004).
async function QuickChangeForComp({
  programId,
  comp,
}: {
  programId: string;
  comp: CompRow;
}) {
  const supabase = await createClient();
  const ensembleIds = await competitionEnsembleIds(supabase, comp.id);
  if (ensembleIds.length === 0) {
    return (
      <p className="muted">
        This competition has no ensembles yet, so there is no student list to
        build a sheet from. Add its ensembles on the competition page.
      </p>
    );
  }

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", programId)
    .in("id", ensembleIds)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as { id: string; name: string }[] | null) ?? [];

  return (
    <>
      {ensembles.map((e) => (
        <EnsembleGrid
          key={e.id}
          programId={programId}
          seasonId={comp.season_id}
          competitionId={comp.id}
          competitionName={comp.name}
          ensembleId={e.id}
          ensembleName={e.name}
        />
      ))}
    </>
  );
}
