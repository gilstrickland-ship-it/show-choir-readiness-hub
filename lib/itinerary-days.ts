import { zonedDateKey, formatDayHeadingInTz } from "@/lib/datetime";

// Day-grouping for multi-day itineraries + trip schedules (Wave G / G2). One home
// for the rule shared by the staff editor, the parent itinerary page, and the
// parent packet PDF: bucket items by their calendar day in the PROGRAM timezone
// (zonedDateKey — Constitution VII), and only surface day headers when the items
// actually span more than one calendar day. A single-day itinerary renders flat,
// exactly as before (no header noise).
//
// Pure (no DB, no React) so tests/unit covers it directly. Generic over the row
// shape via a `getStart` accessor, because the editor/parent rows carry `starts_at`
// while the PDF data carries `startsAt`.

export interface DayGroup<T> {
  // "YYYY-MM-DD" in program tz, or "" for the untimed bucket.
  key: string;
  // "Friday, Apr 10" (full weekday, no year) or "Untimed".
  label: string;
  items: T[];
}

export interface GroupedDays<T> {
  // True when the timed items span more than one calendar day (program tz) — the
  // only condition under which callers render day headers.
  multiDay: boolean;
  groups: DayGroup<T>[];
}

const UNTIMED_KEY = "";
const UNTIMED_LABEL = "Untimed";

// ---------------------------------------------------------------------------
// Living itinerary change detection (Wave C2 / K, T055; reworked T169). One home
// for the rule shared by the staff editor (published itineraries are editable in
// place; a nudge appears when the schedule drifts after publishing) and the
// parent itinerary page (an "Updated {when}" banner). Publishing does NOT freeze
// the itinerary — staff keep editing a live schedule on competition day — so
// both surfaces must agree on whether families are seeing something newer than
// the publish moment.
//
// THE BANNER READS THE PARENT ROW, NOT THE ITEMS (T169). This used to walk
// `itinerary_items.updated_at` across the surviving rows, which could see an
// edit and an addition and was blind by construction to a DELETION — there is
// no row left to read, so removing a line from a published schedule produced no
// banner at all and families kept following a time that no longer existed.
// `itineraries.items_changed_at` is stamped by a trigger on every insert, update
// AND delete (migration 0024), so "changed since publishing" is one comparison
// that cannot miss a removal.
//
// Changes within PUBLISH_JITTER_MS of publish (the publish write itself, or a
// last-second tidy) don't count as a post-publish change; anything later does.
// Pure (no DB, no React) so tests/unit covers both halves directly.

// The grace window after published_at during which item changes are treated as
// part of publishing, not a post-publish change.
export const PUBLISH_JITTER_MS = 60_000;

export interface ChangedSincePublish {
  // Did ANYTHING about this schedule change after publishing — an edit, an
  // addition, or a removal?
  changed: boolean;
  // ISO timestamp of that change (the itinerary's items_changed_at), or null
  // when nothing changed. What the parent banner prints.
  changedAt: string | null;
}

const UNCHANGED: ChangedSincePublish = { changed: false, changedAt: null };

// The banner's existence, from the parent row alone.
export function changedSincePublish(
  itemsChangedAt: string | null,
  publishedAt: string | null,
  jitterMs: number = PUBLISH_JITTER_MS,
): ChangedSincePublish {
  if (!publishedAt || !itemsChangedAt) return UNCHANGED;
  const base = new Date(publishedAt).getTime();
  const changedAt = new Date(itemsChangedAt).getTime();
  if (Number.isNaN(base) || Number.isNaN(changedAt)) return UNCHANGED;
  return changedAt > base + jitterMs
    ? { changed: true, changedAt: new Date(changedAt).toISOString() }
    : UNCHANGED;
}

// How many items that are STILL THERE were added or edited since publishing.
// Staff detail only, and deliberately not the banner's condition: zero of these
// while `changedSincePublish` says the schedule changed means the change was a
// removal, which is the one thing the surviving rows can never show.
export function editedItemsSincePublish(
  items: ReadonlyArray<{ updated_at: string | null }>,
  publishedAt: string | null,
  jitterMs: number = PUBLISH_JITTER_MS,
): number {
  if (!publishedAt) return 0;
  const base = new Date(publishedAt).getTime();
  if (Number.isNaN(base)) return 0;
  const threshold = base + jitterMs;

  let count = 0;
  for (const item of items) {
    if (!item.updated_at) continue;
    const t = new Date(item.updated_at).getTime();
    if (!Number.isNaN(t) && t > threshold) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Parent poster time anchors (§8a, §10). The family home page shows "call HH:MM"
// and, when meaningful, "home ~HH:MM". Call time is the depart item's start (or
// the earliest start). The home estimate needs a REAL end anchor: the latest
// item end time. A schedule with no end times, or one whose latest end collapses
// to the call time, has no truthful "home" to show — so we return null and the
// caller suppresses the segment rather than printing a misleading estimate that
// just mirrors the call time. Pure (no DB, no React) so tests/unit covers it.
export interface ItineraryAnchors {
  callTime: string | null;
  // ISO timestamp of the estimated arrival home, or null when there's no
  // meaningful end anchor (no item has an end time, or it equals the call time).
  homeEstimate: string | null;
}

export function itineraryAnchors(
  items: ReadonlyArray<{
    starts_at: string | null;
    ends_at: string | null;
    kind: string;
  }>,
): ItineraryAnchors {
  const depart = items.find((r) => r.kind === "depart" && r.starts_at);
  const callTime =
    depart?.starts_at ?? items.find((r) => r.starts_at)?.starts_at ?? null;

  // Latest genuine end time — start times are deliberately excluded (the last
  // item starting isn't when the bus gets home).
  const lastEnd =
    items
      .map((r) => r.ends_at)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;

  const homeEstimate = lastEnd && lastEnd !== callTime ? lastEnd : null;
  return { callTime, homeEstimate };
}

export function groupItemsByDay<T>(
  items: T[],
  tz: string,
  getStart: (item: T) => string | null,
): GroupedDays<T> {
  // Bucket by day key, preserving each item's incoming order within its day.
  const buckets = new Map<string, T[]>();
  const firstStart = new Map<string, string>();
  for (const item of items) {
    const start = getStart(item);
    const key = start ? zonedDateKey(start, tz) : UNTIMED_KEY;
    const list = buckets.get(key);
    if (list) {
      list.push(item);
    } else {
      buckets.set(key, [item]);
    }
    if (start && !firstStart.has(key)) firstStart.set(key, start);
  }

  const timedKeys = [...buckets.keys()].filter((k) => k !== UNTIMED_KEY).sort();
  const multiDay = timedKeys.length > 1;

  // Timed days ascending, then the untimed bucket (if any) last.
  const orderedKeys = [...timedKeys];
  if (buckets.has(UNTIMED_KEY)) orderedKeys.push(UNTIMED_KEY);

  const groups: DayGroup<T>[] = orderedKeys.map((key) => ({
    key,
    label:
      key === UNTIMED_KEY
        ? UNTIMED_LABEL
        : formatDayHeadingInTz(firstStart.get(key)!, tz),
    items: buckets.get(key)!,
  }));

  return { multiDay, groups };
}
