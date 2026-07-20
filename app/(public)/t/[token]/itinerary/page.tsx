import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz, formatTimeInTz, formatDateTimeInTz } from "@/lib/datetime";
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

// Ignore edits within this window of publish so the publish write itself (and
// any near-simultaneous last-second tidy) never trips the "updated" banner
// (C2-2). Anything edited more than a minute after publish is a real change.
const PUBLISH_JITTER_MS = 60_000;

// The latest genuine post-publish change to a block's items, if any — the signal
// for the "living itinerary" banner.
function lastChangedAfterPublish(
  items: ItemRow[],
  publishedAt: string | null,
): { at: string; count: number } | null {
  if (!publishedAt) return null;
  const threshold = new Date(publishedAt).getTime() + PUBLISH_JITTER_MS;
  if (Number.isNaN(threshold)) return null;

  let latest = 0;
  let count = 0;
  for (const item of items) {
    if (!item.updated_at) continue;
    const t = new Date(item.updated_at).getTime();
    if (!Number.isNaN(t) && t > threshold) {
      count += 1;
      if (t > latest) latest = t;
    }
  }
  return count > 0 ? { at: new Date(latest).toISOString(), count } : null;
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
    competitionId: string;
    competitionName: string;
    date: string | null;
    items: ItemRow[];
    changed: { at: string; count: number } | null;
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
        changed: lastChangedAfterPublish(itemRows, it.published_at),
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
          {block.changed && (
            /* Living itinerary (C2-2): hosts compress schedules day-of, so a
               parent must be able to trust that what they see is current. This
               page always reads live data; the banner just points at the change. */
            <p className="token-notice" role="status">
              Updated {formatDateTimeInTz(block.changed.at, tz)} — times can shift
              on competition day; this page always shows the latest.
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
