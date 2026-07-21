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
// Living itinerary change detection (Wave C2 / K, T055). One home for the rule
// shared by the staff editor (published itineraries are editable in place; a
// nudge appears when times drift after publishing) and the parent itinerary
// page (an "Updated {when}" banner). Publishing does NOT freeze the itinerary —
// staff keep editing a live schedule on competition day — so both surfaces must
// agree on whether families are seeing something newer than the publish moment.
//
// Edits within PUBLISH_JITTER_MS of publish (the publish write itself, or a
// last-second tidy) don't count as a post-publish change; anything later does.
// Pure (no DB, no React) so tests/unit covers it directly.

// The grace window after published_at during which item edits are treated as
// part of publishing, not a post-publish change.
export const PUBLISH_JITTER_MS = 60_000;

export interface ChangedSincePublish {
  // How many items were genuinely edited after publish (past the jitter window).
  count: number;
  // ISO timestamp of the latest such edit, or null when count === 0.
  lastChangedAt: string | null;
}

export function changedItemsSincePublish(
  items: ReadonlyArray<{ updated_at: string | null }>,
  publishedAt: string | null,
  jitterMs: number = PUBLISH_JITTER_MS,
): ChangedSincePublish {
  const none: ChangedSincePublish = { count: 0, lastChangedAt: null };
  if (!publishedAt) return none;
  const base = new Date(publishedAt).getTime();
  if (Number.isNaN(base)) return none;
  const threshold = base + jitterMs;

  let count = 0;
  let latest = 0;
  for (const item of items) {
    if (!item.updated_at) continue;
    const t = new Date(item.updated_at).getTime();
    if (!Number.isNaN(t) && t > threshold) {
      count += 1;
      if (t > latest) latest = t;
    }
  }
  return count > 0
    ? { count, lastChangedAt: new Date(latest).toISOString() }
    : none;
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
