import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { TRAVEL_WRITE_ROLES } from "@/lib/travel";
import { formatDateInTz } from "@/lib/datetime";
import { createTrip } from "./actions";

// Trips list + create (§6, T016). All roles read travel (the flag is the gate);
// director/admin create. Trips are season-scoped; a trip serves one competition
// or none (banquet, tour). Competitions without a trip get an auto-suggested
// "create trip" prefill so the day-comp bus roster is one click away.

interface TripRow {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_overnight: boolean;
  competition_id: string | null;
}

interface CompRow {
  id: string;
  name: string;
  date: string | null;
}

function dateOnly(d: string | null, tz: string): string {
  return d ? formatDateInTz(`${d}T12:00:00Z`, tz) : "—";
}

export default async function TravelPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "travel");
  const canWrite = TRAVEL_WRITE_ROLES.includes(role);
  const { error } = await searchParams;
  const tz = program.timezone;

  const supabase = await createClient();

  let trips: TripRow[] = [];
  let competitions: CompRow[] = [];
  if (season) {
    const { data: tripData } = await supabase
      .from("trips")
      .select("id, name, starts_on, ends_on, is_overnight, competition_id")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("starts_on", { ascending: true, nullsFirst: false });
    trips = (tripData as TripRow[] | null) ?? [];

    const { data: compData } = await supabase
      .from("competitions")
      .select("id, name, date")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .order("date", { ascending: true, nullsFirst: false });
    competitions = (compData as CompRow[] | null) ?? [];
  }

  const compName = new Map(competitions.map((c) => [c.id, c.name]));
  const linkedCompIds = new Set(trips.map((t) => t.competition_id).filter(Boolean));
  // Auto-suggest a trip for each competition that has none yet (§6).
  const compsWithoutTrip = competitions.filter((c) => !linkedCompIds.has(c.id));

  return (
    <section className="stack">
      <h1>Travel</h1>

      {error === "name" && <p className="alert-error">A trip needs a name.</p>}
      {error === "season" && (
        <p className="alert-error">Activate a season before adding trips.</p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      {!season && (
        <p className="muted">
          No active season — trips are season-scoped and can&apos;t be added yet.
        </p>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Trip</th>
            <th>Dates</th>
            <th>Type</th>
            <th>Competition</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((t) => (
            <tr key={t.id}>
              <td>
                <Link href={`/${slug}/travel/${t.id}`}>{t.name}</Link>
              </td>
              <td>
                {dateOnly(t.starts_on, tz)}
                {t.ends_on && t.ends_on !== t.starts_on
                  ? ` – ${dateOnly(t.ends_on, tz)}`
                  : ""}
              </td>
              <td>
                <span className="badge">{t.is_overnight ? "Overnight" : "Day"}</span>
              </td>
              <td>
                {t.competition_id ? (
                  <span className="chip">{compName.get(t.competition_id) ?? "?"}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
          {trips.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No trips yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && season && compsWithoutTrip.length > 0 && (
        <div className="stack">
          <h2>Competitions without a trip</h2>
          <p className="muted">
            Create a trip to build its bus (and room) rosters. Overnight? Tick the
            box before creating.
          </p>
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {compsWithoutTrip.map((c) => (
              <li key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.5rem 0" }}>
                <form action={createTrip} className="row-inline">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="seasonId" value={season.id} />
                  <input type="hidden" name="competition_id" value={c.id} />
                  <input type="hidden" name="name" value={`${c.name} — travel`} />
                  <input type="hidden" name="starts_on" value={c.date ?? ""} />
                  <input type="hidden" name="ends_on" value={c.date ?? ""} />
                  <span>
                    <strong>{c.name}</strong>{" "}
                    <span className="muted">{dateOnly(c.date, tz)}</span>
                  </span>
                  <label className="row-inline">
                    <input type="checkbox" name="is_overnight" /> Overnight
                  </label>
                  <button type="submit" className="secondary">
                    Create trip
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && season && (
        <>
          <h2 id="add">Add a trip</h2>
          <form action={createTrip} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" required placeholder="Spring Trip" />
              </label>
              <label>
                Starts
                <input type="date" name="starts_on" />
              </label>
              <label>
                Ends
                <input type="date" name="ends_on" />
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" name="is_overnight" /> Overnight (rooms +
                buses)
              </label>
            </div>
            <label>
              Competition (optional)
              <select name="competition_id" defaultValue="">
                <option value="">— none (banquet, tour, standalone)</option>
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add trip</button>
          </form>
        </>
      )}
    </section>
  );
}
