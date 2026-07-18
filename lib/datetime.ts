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
