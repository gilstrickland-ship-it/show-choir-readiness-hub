import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateInTz, formatTimeInTz, zonedDateKey } from "@/lib/datetime";
import { createEvent } from "./actions";
import { EVENTS_WRITE_ROLES, EVENT_KINDS, EVENT_KIND_LABELS } from "@/lib/events";

// Events calendar (§5a, T013) — week + month views, server-rendered, all times in
// programs.timezone (Constitution VII). Events are deliberately thin (no
// attendance/itinerary); they answer "what's happening this week" for the digest
// and dashboard. Recurring events are materialized rows created via the repeat
// helper below.

interface EventRow {
  id: string;
  title: string;
  kind: string;
  starts_at: string | null;
  location: string | null;
  ensemble_id: string | null;
}

interface EnsembleRow {
  id: string;
  name: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Civil-date helpers on a UTC-anchored Date (no timezone math — pure calendar).
function civilKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function parseCivil(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d.getTime());
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ view?: string; ref?: string; created?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "events");
  const canWrite = (EVENTS_WRITE_ROLES as readonly string[]).includes(role);
  const tz = program.timezone;
  const sp = await searchParams;

  const view = sp.view === "week" ? "week" : "month";
  const todayKey = zonedDateKey(new Date(), tz);
  const refKey = sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) ? sp.ref : todayKey;
  const ref = parseCivil(refKey);

  // Build the visible grid of civil dates.
  let gridStart: Date;
  let cells: Date[];
  if (view === "week") {
    gridStart = addDays(ref, -ref.getUTCDay());
    cells = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i));
  } else {
    const first = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
    gridStart = addDays(first, -first.getUTCDay());
    cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }
  const gridEnd = addDays(cells[cells.length - 1], 1);

  // Query padded ±1 day (covers tz offset) and bucket by program-tz date key.
  const supabase = await createClient();
  const { data: evData } = await supabase
    .from("events")
    .select("id, title, kind, starts_at, location, ensemble_id")
    .eq("program_id", program.id)
    .gte("starts_at", `${civilKey(addDays(gridStart, -1))}T00:00:00Z`)
    .lt("starts_at", `${civilKey(addDays(gridEnd, 1))}T00:00:00Z`)
    .order("starts_at", { ascending: true });
  const events = (evData as EventRow[] | null) ?? [];

  const byDay = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.starts_at) continue;
    const key = zonedDateKey(e.starts_at, tz);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];

  // Prev/next anchors.
  const prevRef =
    view === "week"
      ? civilKey(addDays(ref, -7))
      : civilKey(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1)));
  const nextRef =
    view === "week"
      ? civilKey(addDays(ref, 7))
      : civilKey(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1)));

  const heading =
    view === "week"
      ? `Week of ${formatDateInTz(`${civilKey(gridStart)}T12:00:00Z`, tz)}`
      : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(ref);

  const monthOf = ref.getUTCMonth();

  return (
    <section className="stack">
      <h1>Events</h1>

      {sp.created && <p className="alert-ok">Added {sp.created} event(s).</p>}
      {sp.error === "title" && <p className="alert-error">An event needs a title.</p>}
      {sp.error === "season" && (
        <p className="alert-error">Activate a season before adding events.</p>
      )}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      <div className="settings-tabs">
        <Link href={`/${slug}/events?view=month&ref=${refKey}`}>
          {view === "month" ? <strong>Month</strong> : "Month"}
        </Link>
        <Link href={`/${slug}/events?view=week&ref=${refKey}`}>
          {view === "week" ? <strong>Week</strong> : "Week"}
        </Link>
      </div>

      <div className="row-inline" style={{ justifyContent: "space-between", width: "100%" }}>
        <Link href={`/${slug}/events?view=${view}&ref=${prevRef}`}>← Prev</Link>
        <strong>{heading}</strong>
        <Link href={`/${slug}/events?view=${view}&ref=${nextRef}`}>Next →</Link>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className="members" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr>
              {WEEKDAYS.map((w) => (
                <th key={w}>{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, week) => (
              <tr key={week}>
                {cells.slice(week * 7, week * 7 + 7).map((cell) => {
                  const key = civilKey(cell);
                  const dayEvents = byDay.get(key) ?? [];
                  const isToday = key === todayKey;
                  const dim = view === "month" && cell.getUTCMonth() !== monthOf;
                  return (
                    <td
                      key={key}
                      style={{ verticalAlign: "top", minWidth: "6.5rem", height: "5rem" }}
                    >
                      <div className={dim ? "muted" : ""}>
                        {isToday ? <strong>{cell.getUTCDate()}</strong> : cell.getUTCDate()}
                      </div>
                      {dayEvents.map((e) => (
                        <div key={e.id} style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
                          <Link href={`/${slug}/events/${e.id}`}>
                            {e.starts_at ? formatTimeInTz(e.starts_at, tz) : ""} {e.title}
                          </Link>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && season && (
        <>
          <h2>Add an event</h2>
          <form action={createEvent} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <input type="hidden" name="tz" value={tz} />
            <div className="row-inline">
              <label>
                Title
                <input type="text" name="title" required />
              </label>
              <label>
                Kind
                <select name="kind" defaultValue="rehearsal">
                  {EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EVENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ensemble
                <select name="ensemble_id" defaultValue="">
                  <option value="">Whole program</option>
                  {ensembles.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row-inline">
              <label>
                Starts
                <input type="datetime-local" name="starts_at" />
              </label>
              <label>
                Ends
                <input type="datetime-local" name="ends_at" />
              </label>
              <label>
                Location
                <input type="text" name="location" />
              </label>
              <label>
                Repeat weekly ×
                <input
                  type="number"
                  name="repeat_count"
                  className="num"
                  min="1"
                  max="52"
                  defaultValue="1"
                />
              </label>
            </div>
            <label>
              Note
              <input type="text" name="note" />
            </label>
            <p className="muted">
              Repeat creates individual weekly rows you can edit or delete one at a time.
            </p>
            <button type="submit">Add event</button>
          </form>
        </>
      )}
      {canWrite && !season && (
        <p className="muted">No active season — events are season-scoped.</p>
      )}
    </section>
  );
}
