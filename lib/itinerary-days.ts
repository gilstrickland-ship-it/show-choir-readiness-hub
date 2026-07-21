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
