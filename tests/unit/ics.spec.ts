// ============================================================================
// Unit tests — iCalendar (.ics) builder (T045, C2-1).
// ----------------------------------------------------------------------------
// Pure; no DB, no network (runs under vitest.unit.config.ts). Locks the RFC 5545
// invariants the calendar-app round-trip depends on: UTC "Z" instants, stable
// per-item UIDs, correct escaping, timed-only events, and ≤75-octet line folding.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  buildIcs,
  escapeIcsText,
  formatIcsUtc,
  formatIcsDate,
  slugifyForFilename,
  type IcsItem,
} from "@/lib/ics";

const DTSTAMP = new Date("2026-03-01T00:00:00Z");

function item(overrides: Partial<IcsItem>): IcsItem {
  return {
    id: "item-1",
    title: "Warm-up",
    kind: "warmup",
    startsAt: "2026-03-14T13:15:00Z",
    endsAt: "2026-03-14T13:45:00Z",
    location: "Room 214",
    details: null,
    ...overrides,
  };
}

describe("formatIcsUtc", () => {
  test("emits YYYYMMDDTHHMMSSZ in UTC with a Z suffix", () => {
    expect(formatIcsUtc("2026-03-14T13:15:00Z")).toBe("20260314T131500Z");
  });
  test("null / invalid input yields null", () => {
    expect(formatIcsUtc(null)).toBeNull();
    expect(formatIcsUtc("not-a-date")).toBeNull();
  });
});

describe("escapeIcsText (RFC 5545 §3.3.11)", () => {
  test("escapes backslash, semicolon, comma, and newline", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });
  test("backslash is escaped first (no double-escaping)", () => {
    expect(escapeIcsText(";")).toBe("\\;");
    expect(escapeIcsText("\\;")).toBe("\\\\\\;");
  });
});

describe("buildIcs", () => {
  const base = {
    competitionName: "Spring Invitational",
    brandName: "Season OS",
    uidDomain: "example.test",
    dtstamp: DTSTAMP,
  };

  test("valid VCALENDAR envelope with a neutral, brand-driven PRODID", () => {
    const ics = buildIcs({ ...base, items: [item({})] });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Season OS//Itinerary//EN");
    // CRLF line endings throughout.
    expect(ics).toContain("\r\n");
  });

  test("one VEVENT per TIMED item; untimed items are skipped", () => {
    const ics = buildIcs({
      ...base,
      items: [
        item({ id: "a" }),
        item({ id: "b", startsAt: null }), // untimed → not an event
        item({ id: "c" }),
      ],
    });
    const events = ics.match(/BEGIN:VEVENT/g) ?? [];
    expect(events.length).toBe(2);
  });

  test("DTSTART/DTEND are UTC Z instants; UID is stable per item id", () => {
    const ics = buildIcs({ ...base, items: [item({ id: "sched-42" })] });
    expect(ics).toContain("DTSTART:20260314T131500Z");
    expect(ics).toContain("DTEND:20260314T134500Z");
    expect(ics).toContain("UID:sched-42@example.test");
    expect(ics).toContain("DTSTAMP:20260301T000000Z");
  });

  test("SUMMARY is '{title} — {competition}' and is escaped", () => {
    const ics = buildIcs({
      ...base,
      items: [item({ title: "Perform; sing, dance" })],
    });
    expect(ics).toContain(
      "SUMMARY:Perform\\; sing\\, dance — Spring Invitational",
    );
  });

  test("falls back to kind when the title is blank", () => {
    const ics = buildIcs({ ...base, items: [item({ title: "  " })] });
    expect(ics).toContain("SUMMARY:warmup — Spring Invitational");
  });

  test("omits LOCATION/DESCRIPTION when absent", () => {
    const ics = buildIcs({
      ...base,
      items: [item({ location: null, details: null })],
    });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });

  test("no physical line exceeds 75 octets (RFC 5545 folding)", () => {
    const longDetails =
      "Bring the full performance costume, garment bag, and both pairs of " +
      "shoes — the alterations table will be by the loading dock all morning.";
    const ics = buildIcs({ ...base, items: [item({ details: longDetails })] });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    // Folding preserves content: unfold (CRLF + leading space) then check.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`DESCRIPTION:${escapeIcsText(longDetails)}`);
  });

  test("a calendar with no timed items is still valid and event-less", () => {
    const ics = buildIcs({ ...base, items: [item({ startsAt: null })] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("formatIcsDate (RFC 5545 DATE)", () => {
  test("emits YYYYMMDD from a date key or an ISO string", () => {
    expect(formatIcsDate("2026-04-10")).toBe("20260410");
    expect(formatIcsDate("2026-04-10T13:15:00Z")).toBe("20260410");
  });
  test("null / invalid input yields null", () => {
    expect(formatIcsDate(null)).toBeNull();
    expect(formatIcsDate("nope")).toBeNull();
  });
});

describe("buildIcs — all-day (DATE-valued) events", () => {
  const base = {
    brandName: "Season OS",
    uidDomain: "example.test",
    dtstamp: DTSTAMP,
  };

  test("single-day all-day event: DTSTART;VALUE=DATE + exclusive next-day DTEND", () => {
    const ics = buildIcs({
      ...base,
      items: [
        {
          id: "comp-1",
          title: "Spring Invitational",
          kind: "competition",
          startsAt: null,
          endsAt: null,
          location: null,
          details: null,
          allDay: true,
          allDayStart: "2026-04-10",
          allDayEnd: "2026-04-10",
        },
      ],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260410");
    // DTEND is exclusive → the day AFTER the last day (RFC 5545 §3.6.1).
    expect(ics).toContain("DTEND;VALUE=DATE:20260411");
    expect(ics).not.toContain("DTSTART:20260410"); // never a timed instant
  });

  test("multi-day span: DTEND is the day after the inclusive last day", () => {
    const ics = buildIcs({
      ...base,
      items: [
        {
          id: "trip-1",
          title: "Nationals",
          kind: "trip",
          startsAt: null,
          endsAt: null,
          location: null,
          details: null,
          allDay: true,
          allDayStart: "2026-05-07",
          allDayEnd: "2026-05-10",
        },
      ],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260507");
    expect(ics).toContain("DTEND;VALUE=DATE:20260511");
  });

  test("allDayEnd defaults to allDayStart when omitted", () => {
    const ics = buildIcs({
      ...base,
      items: [
        {
          id: "e",
          title: "One day",
          kind: "event",
          startsAt: null,
          endsAt: null,
          location: null,
          details: null,
          allDay: true,
          allDayStart: "2026-04-10",
        },
      ],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260410");
    expect(ics).toContain("DTEND;VALUE=DATE:20260411");
  });

  test("timed and all-day items coexist in one calendar", () => {
    const ics = buildIcs({
      ...base,
      items: [
        item({ id: "timed", startsAt: "2026-04-11T13:15:00Z" }),
        {
          id: "allday",
          title: "Comp",
          kind: "competition",
          startsAt: null,
          endsAt: null,
          location: null,
          details: null,
          allDay: true,
          allDayStart: "2026-04-10",
        },
      ],
    });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain("DTSTART:20260411T131500Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260410");
  });
});

describe("buildIcs — feed metadata + summary suffix", () => {
  const base = {
    brandName: "Season OS",
    uidDomain: "example.test",
    dtstamp: DTSTAMP,
  };

  test("omitting competitionName yields a bare title SUMMARY (no ' — ' suffix)", () => {
    const ics = buildIcs({ ...base, items: [item({ title: "Warm-up" })] });
    expect(ics).toContain("SUMMARY:Warm-up");
    expect(ics).not.toContain("SUMMARY:Warm-up —");
  });

  test("calendarName + refreshInterval emit RFC 7986 feed metadata", () => {
    const ics = buildIcs({
      ...base,
      productName: "Season Calendar",
      calendarName: "Central HS — 2026",
      refreshInterval: "PT12H",
      items: [item({})],
    });
    expect(ics).toContain("PRODID:-//Season OS//Season Calendar//EN");
    expect(ics).toContain("X-WR-CALNAME:Central HS — 2026");
    expect(ics).toContain("NAME:Central HS — 2026");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT12H");
    expect(ics).toContain("X-PUBLISHED-TTL:PT12H");
  });
});

describe("slugifyForFilename", () => {
  test("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugifyForFilename("Spring Invitational 2026!")).toBe(
      "spring-invitational-2026",
    );
  });
  test("falls back to 'itinerary' for an empty/symbol-only name", () => {
    expect(slugifyForFilename("—")).toBe("itinerary");
    expect(slugifyForFilename("")).toBe("itinerary");
  });
});
