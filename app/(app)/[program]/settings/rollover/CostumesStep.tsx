import type { createClient } from "@/lib/supabase/server";
import { repointCostumeSets } from "./actions";

// Rollover step — bring costume sets across (spec 005 Wave 13 / T165).
//
// The thing this step has to make clear, because it is the one people fear: your
// costume PIECES are program property and never move, never copy, and are not
// touched here. A "set" is only a named grouping for one season, so this copies
// the NAMES into the new season as empty sets, ready to fill.

export async function CostumesStep({
  slug,
  programId,
  newSeasonId,
  fromSeasonId,
  supabase,
}: {
  slug: string;
  programId: string;
  newSeasonId: string;
  fromSeasonId: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  let oldSetCount = 0;
  if (fromSeasonId) {
    const { count } = await supabase
      .from("costume_sets")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId)
      .eq("season_id", fromSeasonId);
    oldSetCount = count ?? 0;
  }
  const sets = `${oldSetCount} set name${oldSetCount === 1 ? "" : "s"}`;

  return (
    <div className="stack">
      <p className="muted">
        Your costume <em>pieces</em> belong to the program, not to a season —
        nothing here moves, copies, or changes a single garment. A set is just a
        named grouping for one year, so this copies {sets} from this season into
        the new one as empty sets, ready to fill. Skip it and you build your sets
        from scratch instead; either way you can change them later.
      </p>
      <div className="row-inline">
        <form action={repointCostumeSets}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="newSeasonId" value={newSeasonId} />
          <input type="hidden" name="fromSeasonId" value={fromSeasonId ?? ""} />
          <button type="submit" disabled={oldSetCount === 0}>
            Copy {sets} and keep going
          </button>
        </form>
        <form action={repointCostumeSets}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="newSeasonId" value={newSeasonId} />
          <input type="hidden" name="skip" value="1" />
          <button type="submit" className="secondary">
            Skip this
          </button>
        </form>
      </div>
    </div>
  );
}
