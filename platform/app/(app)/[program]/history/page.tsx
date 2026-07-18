import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { activeCaptions } from "@/lib/competitions";
import { formatDateOnly } from "@/lib/treasury";

// Trophy case / season history (§5, T028). Visible to every staff role behind the
// `archive` flag. Competition results grouped by season — the emotional archive
// payload that makes the multi-year vault loved, not merely useful. Read-only.

export const dynamic = "force-dynamic";

interface ResultRow {
  placement: string | null;
  division: string | null;
  score: number | null;
  captions: Record<string, unknown> | null;
  notes: string | null;
  competition: {
    name: string;
    date: string | null;
    host_school: string | null;
    season_id: string;
  } | null;
}

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program } = await getTenantContext(slug);
  requireFlag(program, "archive");

  const supabase = await createClient();

  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, label, starts_on, is_active, archived_at")
    .eq("program_id", program.id)
    .order("starts_on", { ascending: false, nullsFirst: false })
    .order("label", { ascending: false });
  const seasons =
    (seasonRows as {
      id: string;
      label: string;
      starts_on: string | null;
      is_active: boolean;
      archived_at: string | null;
    }[] | null) ?? [];

  const { data: resultRows } = await supabase
    .from("competition_results")
    .select(
      "placement, division, score, captions, notes, competition:competitions(name, date, host_school, season_id)",
    )
    .eq("program_id", program.id);
  const results = (resultRows as ResultRow[] | null) ?? [];

  const bySeason = new Map<string, ResultRow[]>();
  for (const r of results) {
    const sid = r.competition?.season_id;
    if (!sid) continue;
    const list = bySeason.get(sid) ?? [];
    list.push(r);
    bySeason.set(sid, list);
  }
  for (const list of bySeason.values()) {
    list.sort((a, b) =>
      (b.competition?.date ?? "").localeCompare(a.competition?.date ?? ""),
    );
  }

  const totalResults = results.length;

  return (
    <section className="stack">
      <h1>Trophy case</h1>
      <p className="muted">
        Every placement, caption, and score {program.name} has earned — the
        program&apos;s own record, kept across every season.
      </p>

      {totalResults === 0 && (
        <p className="muted">
          No results recorded yet. Record placements on each competition&apos;s
          page after the show, and they&apos;ll live here forever.
        </p>
      )}

      {seasons.map((s) => {
        const list = bySeason.get(s.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={s.id} className="stack" style={{ width: "100%" }}>
            <h2>
              {s.label}{" "}
              {s.is_active && <span className="badge">Active</span>}
              {s.archived_at && <span className="chip">Archived</span>}
            </h2>
            <div className="card-grid">
              {list.map((r, i) => {
                const caps = activeCaptions(r.captions);
                return (
                  <div className="card" key={i}>
                    <h2>{r.competition?.name ?? "Competition"}</h2>
                    <div className="metric" style={{ fontSize: "1.2rem" }}>
                      {r.placement ?? "Recorded"}
                    </div>
                    <div className="muted">
                      {formatDateOnly(r.competition?.date)}
                      {r.competition?.host_school
                        ? ` · ${r.competition.host_school}`
                        : ""}
                    </div>
                    {(r.score != null || r.division) && (
                      <div className="muted">
                        {r.division ? `${r.division}` : ""}
                        {r.division && r.score != null ? " · " : ""}
                        {r.score != null ? `Score ${r.score}` : ""}
                      </div>
                    )}
                    {caps.length > 0 && (
                      <div>
                        {caps.map((c) => (
                          <span className="chip" key={c}>
                            🏆 {c}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.notes && <p className="muted">{r.notes}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="muted">
        <Link href={`/${slug}/dashboard`}>Back to dashboard</Link>
      </p>
    </section>
  );
}
