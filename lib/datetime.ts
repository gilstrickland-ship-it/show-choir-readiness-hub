// Timezone rendering + wall-clock⇄UTC conversion (Constitution VII).
//
// Every itinerary/event/shift time is stored `timestamptz` (UTC) and rendered in
// `programs.timezone` (IANA). A datetime-local <input> shows and accepts the
// program's wall clock; these helpers convert between that wall clock and the UTC
// instant we persist, using Intl.DateTimeFormat's `timeZone` so no third-party tz
// library is needed. This is the single home for the conversion so competitions,
// events, and itineraries all render call times identically.
//
// Pure functions only — no DB, no network — so tests/unit covers them directly.

// The zones a program can be set to, and the SINGLE list of them (spec 005 Wave
// 8 / T143). It was pasted into two files — /launch, where a founder picks one,
// and Settings, where a director changes it — with a comment in each saying it
// mirrored the other. Two lists that must agree and are maintained separately
// only ever agree by luck. It lives here because this is the module that owns
// what a timezone means to the app.
//
// It covers the show-choir corridor rather than all ~600 IANA zones; extend it
// as programs onboard outside it. A program already set to a zone that is not on
// this list keeps it — Settings prepends the current value rather than silently
// re-homing the program's whole calendar.
export const TIMEZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

// Milliseconds to add to a UTC instant to read the same wall clock as `timeZone`
// at that instant (i.e. the zone's UTC offset, DST-aware).
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  // Intl can emit hour "24" at midnight in some engines — normalize to 0.
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

// Interpret a wall-clock value ("YYYY-MM-DDTHH:MM", the datetime-local shape) as a
// time in `timeZone` and return the corresponding UTC instant. One-iteration
// offset resolution: accurate except for the ~1hr DST-transition ambiguity, which
// is acceptable for scheduling here (call times never land inside the skipped hour
// in practice). Returns null for empty/invalid input.
export function zonedWallToUtc(wall: string, timeZone: string): Date | null {
  if (!wall) return null;
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const guessUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
  );
  const offset = tzOffsetMs(new Date(guessUtc), timeZone);
  return new Date(guessUtc - offset);
}

// UTC instant → "YYYY-MM-DDTHH:MM" in `timeZone`, for a datetime-local input's
// value/defaultValue. Empty string for null so the input renders blank.
export function toZonedInputValue(
  iso: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

// Human-readable renderers, all in program tz.
export function formatDateTimeInTz(
  iso: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatTimeInTz(
  iso: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatDateInTz(
  iso: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

// The calendar day after a "YYYY-MM-DD" key (→ "YYYY-MM-DD"). Computed in UTC so
// it is DST-safe (date keys carry no offset). Null on invalid input. Used to walk
// a trip's inclusive day range and for the exclusive all-day ICS DTEND.
export function nextDateKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const ms = Date.parse(`${key.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

// The inclusive list of "YYYY-MM-DD" day keys from `startKey` to `endKey`. Empty
// when either is missing or the range is inverted. Bounded defensively so a bad
// range can never spin (a season is weeks, not years).
export function dateKeyRange(
  startKey: string | null | undefined,
  endKey: string | null | undefined,
): string[] {
  if (!startKey || !endKey) return [];
  const start = startKey.slice(0, 10);
  const end = endKey.slice(0, 10);
  if (end < start) return [];
  const out: string[] = [];
  let cur: string | null = start;
  for (let i = 0; cur && cur <= end && i < 400; i++) {
    out.push(cur);
    cur = nextDateKey(cur);
  }
  return out;
}

// A full-weekday day heading in program tz — "Friday, Apr 10" (no time, no year).
// Used to label the day groups on multi-day itineraries and trip schedules (Wave
// G / G2). Distinct from formatDateInTz (which abbreviates the weekday and adds a
// year) because a day divider reads better spelled out and without the year noise.
export function formatDayHeadingInTz(
  iso: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(d);
}

// The calendar day ("YYYY-MM-DD") an instant falls on in `timeZone` — used to
// bucket events into calendar cells by the program's wall clock, not the server's.
export function zonedDateKey(
  iso: string | Date,
  timeZone: string,
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD.
  return dtf.format(d);
}

// Whole calendar days from `from` to `to`, counted on `timeZone`'s wall calendar
// rather than by elapsed 24-hour blocks. A director counting from Thursday 9pm to
// a Saturday competition says "2 days" even though only ~34 hours elapse; a naive
// (to - from) / 86.4M floors that to 1. We bucket each instant to its program-tz
// calendar day (zonedDateKey) and diff the pure calendar dates. Parsing the
// YYYY-MM-DD keys as UTC midnights is DST-safe precisely because date keys carry
// no offset. A target day already in the past clamps to 0 ("now", not "-2 days").
export function calendarDaysBetween(
  from: Date,
  to: Date,
  timeZone: string,
): number {
  const fromUtc = Date.parse(`${zonedDateKey(from, timeZone)}T00:00:00Z`);
  const toUtc = Date.parse(`${zonedDateKey(to, timeZone)}T00:00:00Z`);
  const days = Math.round((toUtc - fromUtc) / 86_400_000);
  return days < 0 ? 0 : days;
}

// Friendly, parent-legible label for an IANA zone. "America/Chicago" reads as
// "Central Time", not the raw zone name a director would never say aloud. A
// deterministic Record (no Intl long-name lookups, which vary by engine and
// locale) keeps this pure and unit-testable. Unmapped zones fall back to the
// city segment with underscores turned into spaces ("Europe/Paris" → "Paris").
const TIME_ZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Detroit": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Arizona Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

export function formatTimeZoneLabel(timeZone: string): string {
  const mapped = TIME_ZONE_LABELS[timeZone];
  if (mapped) return mapped;
  const city = timeZone.includes("/") ? timeZone.split("/").pop()! : timeZone;
  return city.replace(/_/g, " ");
}
