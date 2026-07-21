// ============================================================================
// iCalendar (.ics) builder — add published itinerary call times to a calendar.
// ----------------------------------------------------------------------------
// Pure, dependency-light VCALENDAR generator (Constitution VII: times stored UTC,
// emitted here as UTC instants with the Z suffix so a parent's calendar app
// renders them in the parent's own device tz — exactly the 7:15 AM call time,
// wherever they are). No PII beyond the item text a parent already sees on the
// itinerary page (Constitution III): student names never appear.
//
// Escapes text per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline) and
// folds long content lines to ≤75 octets (§3.1). No DB, no env, no clock beyond
// an injectable DTSTAMP — so tests/unit covers it directly and deterministically.
// ============================================================================

import { nextDateKey } from "@/lib/datetime";

export interface IcsItem {
  // Stable per-item id → the VEVENT UID (a re-download of an unchanged item
  // updates the same calendar entry instead of duplicating it).
  id: string;
  title: string | null;
  kind: string;
  // UTC ISO instants. Only items WITH a start become events (untimed rows — a
  // bare "load the bus" with no clock time — are skipped, not emitted at 00:00).
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  details: string | null;
  // All-day (RFC 5545 DATE-valued) event support (Wave G / G1). When `allDay` is
  // true the event is emitted with DTSTART;VALUE=DATE / DTEND;VALUE=DATE from the
  // date keys below (startsAt/endsAt are ignored). `allDayStart` is the inclusive
  // first calendar day ("YYYY-MM-DD"); `allDayEnd` is the inclusive LAST day
  // (defaults to allDayStart). DTEND is emitted as the day AFTER allDayEnd, since
  // an all-day DTEND is exclusive per RFC 5545 §3.6.1. Used for competitions with
  // no published call time (all-day on the comp date) and for multi-day trips.
  allDay?: boolean;
  allDayStart?: string | null;
  allDayEnd?: string | null;
}

export interface IcsCalendarInput {
  // Appended to each event's SUMMARY as "{title} — {competitionName}" for the
  // per-competition itinerary feed. OMIT for a mixed feed (the season calendar),
  // where each item's title already stands on its own.
  competitionName?: string;
  // Constitution IX — the only source of the product name. Flows into PRODID.
  brandName: string;
  // Host part of each VEVENT UID (e.g. the brand domain). Keeps UIDs globally
  // unique without leaking anything — it is a constant, not per-family.
  uidDomain: string;
  items: IcsItem[];
  // Injectable generation stamp (defaults to now) — deterministic in tests.
  dtstamp?: Date;
  // PRODID product segment (defaults to "Itinerary"). The season feed passes
  // "Season Calendar" so the calendar's origin reads sensibly.
  productName?: string;
  // Optional calendar display name → X-WR-CALNAME + NAME (RFC 7986). Calendar
  // apps show this as the subscribed calendar's title.
  calendarName?: string;
  // Optional refresh hint for a SUBSCRIBED feed (RFC 7986 REFRESH-INTERVAL +
  // the widely-honored X-PUBLISHED-TTL). An ISO 8601 duration, e.g. "PT12H".
  refreshInterval?: string;
}

// Escape a text value per RFC 5545 §3.3.11. Order matters: backslash first so we
// don't double-escape the escapes we add for the other characters.
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// UTC ISO instant → "YYYYMMDDTHHMMSSZ" (RFC 5545 UTC "date-time"). Invalid/empty
// yields null so the caller can skip the property.
export function formatIcsUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

// A "YYYY-MM-DD" date key → "YYYYMMDD" (RFC 5545 DATE value). Invalid/empty
// yields null so the caller can skip the property. Accepts a full ISO string too
// (uses its date portion) for convenience.
export function formatIcsDate(key: string | null | undefined): string | null {
  if (!key) return null;
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

// Fold one content line to ≤75 octets (RFC 5545 §3.1). Continuation lines begin
// with a single space and that space counts toward the 75-octet budget. Folds on
// whole characters so a multibyte UTF-8 sequence is never split.
function foldLine(line: string): string {
  const MAX = 75;
  if (Buffer.byteLength(line, "utf8") <= MAX) return line;

  let out = "";
  let seg = "";
  let segBytes = 0;
  let first = true;

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    // Continuation physical lines spend 1 octet on their leading space.
    const limit = first ? MAX : MAX - 1;
    if (segBytes + chBytes > limit) {
      out += (first ? "" : " ") + seg + "\r\n";
      first = false;
      seg = ch;
      segBytes = chBytes;
    } else {
      seg += ch;
      segBytes += chBytes;
    }
  }
  out += (first ? "" : " ") + seg;
  return out;
}

// Neutral PRODID (Constitution IX — no hardcoded product name; the brand flows
// in). The "//EN" language tag and "-//" (non-registered) prefix are RFC idiom.
function prodId(brandName: string, productName: string): string {
  return `-//${brandName}//${productName}//EN`;
}

// Build a VCALENDAR string with one VEVENT per TIMED item. Returns a valid
// (possibly event-less) calendar even when no item has a start time.
export function buildIcs(input: IcsCalendarInput): string {
  const stamp = formatIcsUtc((input.dtstamp ?? new Date()).toISOString())!;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId(input.brandName, input.productName ?? "Itinerary")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  // Subscribed-feed metadata (RFC 7986). A calendar name + refresh cadence so a
  // client shows a sensible title and re-polls the live feed on its own.
  if (input.calendarName && input.calendarName.trim()) {
    lines.push(`NAME:${escapeIcsText(input.calendarName)}`);
    lines.push(`X-WR-CALNAME:${escapeIcsText(input.calendarName)}`);
  }
  if (input.refreshInterval && input.refreshInterval.trim()) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${input.refreshInterval}`);
    lines.push(`X-PUBLISHED-TTL:${input.refreshInterval}`);
  }

  for (const item of input.items) {
    const summarySource =
      (item.title && item.title.trim()) || item.kind || "Itinerary item";
    const summary = input.competitionName
      ? `${summarySource} — ${input.competitionName}`
      : summarySource;

    // Two shapes: an all-day DATE event, or a timed UTC-instant event. Untimed
    // rows (no start of either kind) are skipped, never emitted at 00:00.
    if (item.allDay) {
      const startDate = formatIcsDate(item.allDayStart);
      if (!startDate) continue;
      // DTEND is exclusive for all-day events (§3.6.1): day after the last day.
      const endInclusive = item.allDayEnd || item.allDayStart;
      const endDate = formatIcsDate(nextDateKey(endInclusive)) ?? undefined;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${item.id}@${input.uidDomain}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      if (endDate) lines.push(`DTEND;VALUE=DATE:${endDate}`);
      lines.push(`SUMMARY:${escapeIcsText(summary)}`);
      if (item.location && item.location.trim()) {
        lines.push(`LOCATION:${escapeIcsText(item.location)}`);
      }
      if (item.details && item.details.trim()) {
        lines.push(`DESCRIPTION:${escapeIcsText(item.details)}`);
      }
      lines.push("END:VEVENT");
      continue;
    }

    const dtstart = formatIcsUtc(item.startsAt);
    if (!dtstart) continue; // untimed rows are not calendar events.

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id}@${input.uidDomain}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${dtstart}`);
    const dtend = formatIcsUtc(item.endsAt);
    if (dtend) lines.push(`DTEND:${dtend}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (item.location && item.location.trim()) {
      lines.push(`LOCATION:${escapeIcsText(item.location)}`);
    }
    if (item.details && item.details.trim()) {
      lines.push(`DESCRIPTION:${escapeIcsText(item.details)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// Filename-safe slug for the Content-Disposition attachment name. Lowercase,
// non-alphanumerics collapsed to single hyphens, trimmed. Falls back to
// "itinerary" for an empty/symbol-only name.
export function slugifyForFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "itinerary";
}
