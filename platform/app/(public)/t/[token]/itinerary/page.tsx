import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz, formatTimeInTz } from "@/lib/datetime";
import { TokenFooter } from "../parts";

// Published itineraries on the tokenized surface (§8a, invariant §9.3). Guardian
// token → published itineraries for the family's ensembles' upcoming
// competitions. Share link (resource 'itinerary') → that one competition. DRAFT
// ITINERARIES ARE NEVER VISIBLE HERE — only status='published'.

interface ItemRow {
  starts_at: string | null;
  ends_at: string | null;
  kind: string;
  title: string | null;
  location: string | null;
  details: string | null;
  sort_order: number;
}

export default async function PublicItineraryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();

  const { program } = resolved;
  const tz = program.timezone;
  const supabase = createAdminClient();

  // Determine which competitions to show.
  let competitionIds: string[] = [];
  const todayKey = new Date().toISOString().slice(0, 10);

  if (resolved.kind === "share") {
    if (resolved.resource !== "itinerary") notFound();
    competitionIds = [resolved.resource_id];
  } else {
    const { data: season } = await supabase
      .from("seasons")
      .select("id")
      .eq("program_id", program.id)
      .eq("is_active", true)
      .maybeSingle();
    const seasonId = (season as { id: string } | null)?.id ?? null;
    const studentIds = resolved.students.map((s) => s.id);

    if (seasonId && studentIds.length > 0) {
      const { data: mems } = await supabase
        .from("ensemble_members")
        .select("ensemble_id")
        .eq("program_id", program.id)
        .eq("season_id", seasonId)
        .in("student_id", studentIds);
      const ensembleIds = Array.from(
        new Set(((mems as { ensemble_id: string }[] | null) ?? []).map((m) => m.ensemble_id)),
      );
      if (ensembleIds.length > 0) {
        const { data: comps } = await supabase
          .from("competitions")
          .select("id")
          .eq("program_id", program.id)
          .eq("season_id", seasonId)
          .in("ensemble_id", ensembleIds)
          .gte("date", todayKey)
          .order("date", { ascending: true });
        competitionIds = ((comps as { id: string }[] | null) ?? []).map((c) => c.id);
      }
    }
  }

  // Load ONLY published itineraries for those competitions.
  const blocks: Array<{
    competitionName: string;
    date: string | null;
    items: ItemRow[];
  }> = [];

  if (competitionIds.length > 0) {
    const { data: itins } = await supabase
      .from("itineraries")
      .select("id, competition_id, status, competition:competitions(name, date)")
      .eq("program_id", program.id)
      .eq("status", "published")
      .in("competition_id", competitionIds);

    for (const it of (itins as unknown as Array<{
      id: string;
      competition: { name: string; date: string | null } | null;
    }> | null) ?? []) {
      const { data: items } = await supabase
        .from("itinerary_items")
        .select("starts_at, ends_at, kind, title, location, details, sort_order")
        .eq("program_id", program.id)
        .eq("itinerary_id", it.id)
        .order("sort_order", { ascending: true })
        .order("starts_at", { ascending: true });
      blocks.push({
        competitionName: it.competition?.name ?? "Competition",
        date: it.competition?.date ?? null,
        items: (items as ItemRow[] | null) ?? [],
      });
    }
  }

  return (
    <section className="stack">
      <h1>Itinerary</h1>

      {blocks.length === 0 && (
        <p className="muted">No published itineraries yet. Check back soon.</p>
      )}

      {blocks.map((block, bi) => (
        <div key={bi} style={{ width: "100%" }}>
          <h2>
            {block.competitionName}
            {block.date && (
              <span className="muted"> · {formatDateInTz(block.date, tz)}</span>
            )}
          </h2>
          {block.items.length === 0 ? (
            <p className="muted">No schedule items.</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none", paddingLeft: 0 }}>
              {block.items.map((item, ii) => (
                <li key={ii} style={{ width: "100%" }}>
                  <strong>
                    {item.starts_at ? formatTimeInTz(item.starts_at, tz) : "—"}
                  </strong>{" "}
                  {item.title ?? item.kind}
                  {item.location && (
                    <div className="muted">{item.location}</div>
                  )}
                  {item.details && <div className="muted">{item.details}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <TokenFooter token={token} kind={resolved.kind} />
    </section>
  );
}
