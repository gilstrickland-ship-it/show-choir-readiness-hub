import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz, formatTimeInTz, formatDateTimeInTz } from "@/lib/datetime";
import {
  groupItemsByDay,
  changedItemsSincePublish,
  type ChangedSincePublish,
} from "@/lib/itinerary-days";
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
  updated_at: string | null;
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
      // Competitions the family's ensembles participate in (Feature 004 junction).
      const { data: ceRows } = ensembleIds.length
        ? await supabase
            .from("competition_ensembles")
            .select("competition_id")
            .eq("program_id", program.id)
            .in("ensemble_id", ensembleIds)
        : { data: null };
      const familyCompIds = Array.from(
        new Set(
          ((ceRows as { competition_id: string }[] | null) ?? []).map(
            (r) => r.competition_id,
          ),
        ),
      );
      if (familyCompIds.length > 0) {
        const { data: comps } = await supabase
          .from("competitions")
          .select("id")
          .eq("program_id", program.id)
          .eq("season_id", seasonId)
          .in("id", familyCompIds)
          .gte("date", todayKey)
          .order("date", { ascending: true });
        competitionIds = ((comps as { id: string }[] | null) ?? []).map((c) => c.id);
      }
    }
  }

  // Load ONLY published itineraries for those competitions.
  const blocks: Array<{
    competitionId: string;
    competitionName: string;
    date: string | null;
    items: ItemRow[];
    changed: ChangedSincePublish;
  }> = [];

  if (competitionIds.length > 0) {
    const { data: itins } = await supabase
      .from("itineraries")
      .select("id, competition_id, status, published_at, competition:competitions(name, date)")
      .eq("program_id", program.id)
      .eq("status", "published")
      .in("competition_id", competitionIds);

    for (const it of (itins as unknown as Array<{
      id: string;
      competition_id: string;
      published_at: string | null;
      competition: { name: string; date: string | null } | null;
    }> | null) ?? []) {
      const { data: items } = await supabase
        .from("itinerary_items")
        .select("starts_at, ends_at, kind, title, location, details, sort_order, updated_at")
        .eq("program_id", program.id)
        .eq("itinerary_id", it.id)
        .order("sort_order", { ascending: true })
        .order("starts_at", { ascending: true });
      const itemRows = (items as ItemRow[] | null) ?? [];
      blocks.push({
        competitionId: it.competition_id,
        competitionName: it.competition?.name ?? "Competition",
        date: it.competition?.date ?? null,
        items: itemRows,
        changed: changedItemsSincePublish(itemRows, it.published_at),
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
              <span className="muted"> · {formatDateInTz(`${block.date}T12:00:00Z`, tz)}</span>
            )}
          </h2>
          {block.changed.count > 0 && block.changed.lastChangedAt && (
            /* Living itinerary (C2-2): hosts compress schedules day-of, so a
               parent must be able to trust that what they see is current. This
               page always reads live data; the banner just points at the change. */
            <p className="token-notice" role="status">
              Updated {formatDateTimeInTz(block.changed.lastChangedAt, tz)} — times
              can shift on competition day; this page always shows the latest.
            </p>
          )}
          <p className="itinerary-links">
            {/* Published-only (invariant §9.3) — every block here IS published, so
                these links always resolve. The routes re-check eligibility. */}
            <a href={`/t/${token}/packet?competition=${block.competitionId}`}>
              Download packet (PDF)
            </a>
            <a href={`/t/${token}/itinerary/ics/${block.competitionId}`}>
              Add to calendar
            </a>
          </p>
          {block.items.length === 0 ? (
            <p className="muted">No schedule items.</p>
          ) : (
            (() => {
              // Day headers only when this competition's items span >1 calendar
              // day (Wave G / G2) — multi-day trips read clearly; single-day
              // itineraries render flat, unchanged.
              const { multiDay, groups } = groupItemsByDay(
                block.items,
                tz,
                (i) => i.starts_at,
              );
              const renderRow = (item: ItemRow, ii: number) => (
                <li key={ii} style={{ width: "100%" }}>
                  <strong>
                    {item.starts_at ? formatTimeInTz(item.starts_at, tz) : "—"}
                  </strong>{" "}
                  {item.title ?? item.kind}
                  {item.location && <div className="muted">{item.location}</div>}
                  {item.details && <div className="muted">{item.details}</div>}
                </li>
              );
              return multiDay ? (
                <div className="stack" style={{ width: "100%" }}>
                  {groups.map((g) => (
                    <div key={g.key || "untimed"} style={{ width: "100%" }}>
                      <h3 className="itinerary-day-heading">{g.label}</h3>
                      <ul
                        className="stack"
                        style={{ listStyle: "none", paddingLeft: 0 }}
                      >
                        {g.items.map((item, ii) => renderRow(item, ii))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="stack" style={{ listStyle: "none", paddingLeft: 0 }}>
                  {block.items.map((item, ii) => renderRow(item, ii))}
                </ul>
              );
            })()
          )}
        </div>
      ))}

      <TokenFooter token={token} kind={resolved.kind} />
    </section>
  );
}
