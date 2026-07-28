import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES } from "@/lib/nav";
import {
  SHIFT_WRITE_ROLES,
  suggestShifts,
  type SuggestItem,
  type CostumeSetInfo,
} from "@/lib/shifts";
import { competitionEnsembleIds, type ItineraryItemKind } from "@/lib/competitions";
import { toZonedInputValue } from "@/lib/datetime";
import { CommsTabs } from "../../CommsTabs";
import { createSuggestedShifts } from "../actions";

// "Suggest shifts" (§8, T024, invariant §9.3). For a competition WITH a PUBLISHED
// itinerary, derive DRAFT shift suggestions from itinerary items + costume set
// transitions and render them as editable pre-filled rows. Nothing is created
// until the director confirms — the AI-draft rule's spirit applied to a pure
// derivation (this derivation calls no model; it is deterministic).

interface CompRow {
  id: string;
  name: string;
  season_id: string;
}

export default async function SuggestShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ competition?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);
  requireFlag(program, "comms");
  requireFlag(program, "shifts");
  if (!COMMS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Comms" role={role} allowed={COMMS_ROLES} />
    );
  }
  if (!SHIFT_WRITE_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Comms" role={role} allowed={SHIFT_WRITE_ROLES} />
    );
  }
  const tz = program.timezone;
  const { competition: competitionId } = await searchParams;

  const supabase = await createClient();

  // Competitions that have a published itinerary — the only ones we can suggest
  // from (invariant §9.3).
  const { data: pubItin } = await supabase
    .from("itineraries")
    .select("competition_id")
    .eq("program_id", program.id)
    .eq("status", "published");
  const publishedCompIds = Array.from(
    new Set(
      ((pubItin as { competition_id: string }[] | null) ?? []).map(
        (r) => r.competition_id,
      ),
    ),
  );

  const { data: compData } = publishedCompIds.length
    ? await supabase
        .from("competitions")
        .select("id, name, season_id")
        .eq("program_id", program.id)
        .in("id", publishedCompIds)
        .order("date", { ascending: true, nullsFirst: false })
    : { data: null };
  const competitions = (compData as CompRow[] | null) ?? [];

  const selected = competitionId
    ? competitions.find((c) => c.id === competitionId) ?? null
    : null;

  // Build the suggestions for the selected competition.
  let suggestions: ReturnType<typeof suggestShifts> = [];
  if (selected) {
    const { data: itin } = await supabase
      .from("itineraries")
      .select("id")
      .eq("program_id", program.id)
      .eq("competition_id", selected.id)
      .eq("status", "published")
      .maybeSingle();
    const itineraryId = (itin as { id: string } | null)?.id ?? null;

    const items: SuggestItem[] = itineraryId
      ? (
          ((
            await supabase
              .from("itinerary_items")
              .select("kind, title, starts_at, ends_at, location")
              .eq("program_id", program.id)
              .eq("itinerary_id", itineraryId)
          ).data as
            | {
                kind: ItineraryItemKind;
                title: string | null;
                starts_at: string | null;
                ends_at: string | null;
                location: string | null;
              }[]
            | null) ?? []
        ).map((i) => ({
          kind: i.kind,
          title: i.title ?? i.kind,
          starts_at: i.starts_at,
          ends_at: i.ends_at,
          location: i.location,
        }))
      : [];

    // Costume sets for the competition's participating ensembles this season, each
    // flagged with whether a student is assigned a piece in it (an empty set → no
    // change). A competition can include several ensembles (Feature 004).
    const performingEnsembleIds = await competitionEnsembleIds(supabase, selected.id);
    let setQuery = supabase
      .from("costume_sets")
      .select("id, name, sort_order")
      .eq("program_id", program.id)
      .eq("season_id", selected.season_id);
    setQuery =
      performingEnsembleIds.length > 0
        ? setQuery.in("ensemble_id", performingEnsembleIds)
        : setQuery.is("ensemble_id", null);
    const setRows =
      ((await setQuery.order("sort_order", { ascending: true })).data as
        | { id: string; name: string; sort_order: number }[]
        | null) ?? [];

    const setIds = setRows.map((s) => s.id);
    const dressedSetIds = new Set<string>();
    if (setIds.length > 0) {
      const { data: pieceData } = await supabase
        .from("costume_pieces")
        .select("id, set_id")
        .eq("program_id", program.id)
        .in("set_id", setIds);
      const pieceToSet = new Map(
        ((pieceData as { id: string; set_id: string | null }[] | null) ?? []).map(
          (p) => [p.id, p.set_id],
        ),
      );
      const pieceIds = Array.from(pieceToSet.keys());
      if (pieceIds.length > 0) {
        const { data: asgData } = await supabase
          .from("costume_assignments")
          .select("piece_id")
          .eq("program_id", program.id)
          .eq("season_id", selected.season_id)
          .in("piece_id", pieceIds);
        for (const a of (asgData as { piece_id: string }[] | null) ?? []) {
          const setId = pieceToSet.get(a.piece_id);
          if (setId) dressedSetIds.add(setId);
        }
      }
    }

    const costumeSets: CostumeSetInfo[] = setRows.map((s) => ({
      id: s.id,
      name: s.name,
      sort_order: s.sort_order,
      hasAssignments: dressedSetIds.has(s.id),
    }));

    suggestions = suggestShifts({ items, costumeSets });
  }

  return (
    <section className="stack">
      <CommsTabs
        slug={slug}
        active="shifts"
        digestEnabled={flags.digest}
        announcementsEnabled={flags.announcements}
        shiftsEnabled
      />
      <p>
        <Link href={`/${slug}/comms/shifts`}>← Shifts</Link>
      </p>
      <h1>Suggest shifts</h1>
      <p className="muted">
        Draft shifts derived from a published itinerary and costume changes. Edit
        or uncheck any row; nothing is created until you confirm.
      </p>

      {competitions.length === 0 && (
        <p className="muted">
          No competition has a published itinerary yet. Publish an itinerary to
          get shift suggestions.
        </p>
      )}

      {competitions.length > 0 && (
        <form method="get" className="row-inline">
          <label>
            Competition
            <select name="competition" defaultValue={competitionId ?? ""}>
              <option value="">— choose —</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            Build suggestions
          </button>
        </form>
      )}

      {selected && suggestions.length === 0 && (
        <p className="muted">
          Nothing to suggest for {selected.name} yet — no meals, load times,
          check-in, or costume changes were found in the itinerary.
        </p>
      )}

      {selected && suggestions.length > 0 && season && (
        <form action={createSuggestedShifts} className="stack" style={{ width: "100%" }}>
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="seasonId" value={selected.season_id} />
          <input type="hidden" name="competitionId" value={selected.id} />
          <input type="hidden" name="tz" value={tz} />
          <input type="hidden" name="count" value={suggestions.length} />

          {suggestions.map((s, i) => (
            <div key={i} className="confirm-box" style={{ width: "100%" }}>
              <label className="row-inline">
                <input type="checkbox" name={`keep_${i}`} defaultChecked />
                Create this shift
              </label>
              <div className="row-inline">
                <label>
                  Title
                  <input type="text" name={`title_${i}`} defaultValue={s.title} />
                </label>
                <label>
                  Needed
                  <input
                    type="number"
                    name={`needed_${i}`}
                    className="num"
                    min={1}
                    defaultValue={s.needed_count}
                  />
                </label>
              </div>
              <div className="row-inline">
                <label>
                  Starts
                  <input
                    type="datetime-local"
                    name={`starts_${i}`}
                    defaultValue={toZonedInputValue(s.starts_at, tz)}
                  />
                </label>
                <label>
                  Ends
                  <input
                    type="datetime-local"
                    name={`ends_${i}`}
                    defaultValue={toZonedInputValue(s.ends_at, tz)}
                  />
                </label>
              </div>
              <label>
                Notes
                <input type="text" name={`notes_${i}`} defaultValue={s.notes ?? ""} />
              </label>
            </div>
          ))}

          <button type="submit">Create the checked shifts</button>
        </form>
      )}
    </section>
  );
}
