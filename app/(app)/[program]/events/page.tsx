import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateInTz, formatTimeInTz, zonedDateKey } from "@/lib/datetime";
import { EVENTS_WRITE_ROLES } from "@/lib/events";
import { eventEnsembleMap } from "@/lib/competitions";
import { eventViewTabs, type EventViewTab } from "@/lib/subnav";
import { SubTabs } from "../SubTabs";
import { readFlash, oneParam } from "@/lib/flash";
import { EVENTS_FLASH_MAPS, type EventsSection } from "./shared";
import { AddEvent } from "./AddEvent";

// The events calendar (§5a, T013; re-shaped spec 005 Wave 11 / T159) — month and
// week, server-rendered, every time in programs.timezone (Constitution VII).
// Both views stay: a server-rendered calendar you can page through IS this
// page's job, and month and week answer two different questions ("when is that
// week of fittings" / "what is happening Thursday").
//
// What changed is the create form's standing. Wave 1 made Season the one place
// you add things (US1, P6), and this page's always-open "Add an event" heading
// was a second, competing primary path directly under the calendar. It is now
// the Season drawer's "More options →" panel — a labeled disclosure holding the
// fields a two-field drawer can't take — and only mutations sit in disclosures
// here; the calendar, which is what the page is for, is what you see.

interface EventRow {
  id: string;
  title: string;
  kind: string;
  starts_at: string | null;
  location: string | null;
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
  // Next hands back an ARRAY for a duplicated param (?view=a&view=b), so every
  // read goes through oneParam — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "events");
  const canWrite = (EVENTS_WRITE_ROLES as readonly string[]).includes(role);
  const tz = program.timezone;
  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);

  const view: EventViewTab = one("view") === "week" ? "week" : "month";
  const todayKey = zonedDateKey(new Date(), tz);
  const refParam = one("ref");
  const refKey = refParam && /^\d{4}-\d{2}-\d{2}$/.test(refParam) ? refParam : todayKey;
  const ref = parseCivil(refKey);

  // One `?ok=` and one `?error=`, resolved against this surface's map (shared.ts).
  const flash = readFlash<EventsSection>(sp, EVENTS_FLASH_MAPS);
  // `?add=event` is the Season drawer's "More options →" link AND the URL a
  // refused save comes back on; a message with nowhere to render is worse than
  // no message, so anything the flash resolved springs the panel too.
  const addOpen =
    canWrite && (one("add") === "event" || !!flash.ok || !!flash.error);

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
    .select("id, title, kind, starts_at, location")
    .eq("program_id", program.id)
    .gte("starts_at", `${civilKey(addDays(gridStart, -1))}T00:00:00Z`)
    .lt("starts_at", `${civilKey(addDays(gridEnd, 1))}T00:00:00Z`)
    .order("starts_at", { ascending: true });
  const events = (evData as EventRow[] | null) ?? [];

  // Targeted ensembles per event (Feature 004): an event absent from the map
  // targets the whole program (zero junction rows).
  const evEnsembles = await eventEnsembleMap(
    supabase,
    program.id,
    events.map((e) => e.id),
  );

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
  const ensembleName = new Map(ensembles.map((e) => [e.id, e.name]));

  // A short audience label for a calendar event: its targeted ensembles, or
  // "Whole program" when it has none (Feature 004).
  function audienceLabel(eventId: string): string {
    const ids = evEnsembles.get(eventId);
    if (!ids || ids.length === 0) return "Whole program";
    return ids.map((id) => ensembleName.get(id) ?? "?").join(", ");
  }

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

      <SubTabs strip={eventViewTabs(slug, view, refKey)} />

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
                          <div className="muted" style={{ fontSize: "0.7rem" }}>
                            {audienceLabel(e.id)}
                          </div>
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
        <AddEvent
          programId={program.id}
          slug={slug}
          seasonId={season.id}
          tz={tz}
          ensembles={ensembles}
          open={addOpen}
          flash={flash}
        />
      )}
      {canWrite && !season && (
        <p className="muted">
          No season yet — competitions, events, and trips all belong to a
          season. <Link href={`/${slug}/season`}>Start yours on Season</Link>.
        </p>
      )}
    </section>
  );
}
