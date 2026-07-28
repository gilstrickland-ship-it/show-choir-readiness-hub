// ============================================================================
// Unit tests — comms recipients + body rendering (T023/T025/T026)
// ----------------------------------------------------------------------------
// Pure-ish: computeRecipients is exercised against a tiny chainable Supabase mock
// so we can prove (a) it filters to email_status='ok' at the query layer — the
// mechanism that HONORS bounce/unsubscribe (T026) — and (b) it dedupes families
// by lowercased email. bodyToHtml/announcementHtml/guardianLinksEmailHtml are
// pure, and the last two are asserted against real guardianLinks output so the
// footer under test is the one a program's flags actually produce.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  computeRecipients,
  bodyToHtml,
  announcementHtml,
  sendStatusLabel,
} from "@/lib/comms";
import { guardianLinks } from "@/lib/tokens";
import { guardianLinksEmailHtml } from "@/lib/comms-send";
import type { FlaggableProgram } from "@/lib/flags";
import type { SupabaseClient } from "@supabase/supabase-js";

// A program with every flag the footer consults set explicitly, so a test says
// what it means rather than leaning on a tier baseline.
function allFlags(on: boolean): FlaggableProgram {
  return {
    tier: "program",
    feature_overrides: { competitions: on, comms: on, shifts: on },
  };
}

type Call = [string, ...unknown[]];

// A chainable query stub: records filter calls and resolves to { data: rows }.
function makeQuery(rows: unknown[], calls: Call[]) {
  const q: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return q;
  };
  q.select = chain("select");
  q.eq = chain("eq");
  q.not = chain("not");
  q.in = chain("in");
  q.then = (resolve: (v: { data: unknown[] }) => unknown) =>
    Promise.resolve({ data: rows }).then(resolve);
  return q;
}

function mockSupabase(rows: unknown[], calls: Call[]): SupabaseClient {
  return {
    from: () => makeQuery(rows, calls),
  } as unknown as SupabaseClient;
}

describe("computeRecipients", () => {
  test("filters to email_status='ok' at the query layer (honors bounce/unsub)", async () => {
    const calls: Call[] = [];
    const supabase = mockSupabase(
      [{ id: "g1", name: "A", email: "a@x.com" }],
      calls,
    );
    await computeRecipients(supabase, {
      programId: "p1",
      seasonId: null,
      ensembleId: null,
    });
    // The 'ok' filter is what makes bounced/unsubscribed rows unreachable.
    expect(calls).toContainEqual(["eq", "email_status", "ok"]);
    expect(calls).toContainEqual(["eq", "program_id", "p1"]);
  });

  test("dedupes families by lowercased email", async () => {
    const calls: Call[] = [];
    const supabase = mockSupabase(
      [
        { id: "g1", name: "Parent One", email: "Family@X.com" },
        { id: "g2", name: "Parent One", email: "family@x.com" }, // same family, 2 kids
        { id: "g3", name: "Parent Two", email: "other@x.com" },
      ],
      calls,
    );
    const recipients = await computeRecipients(supabase, {
      programId: "p1",
      seasonId: null,
      ensembleId: null,
    });
    expect(recipients).toHaveLength(2);
    expect(recipients.map((r) => r.email.toLowerCase()).sort()).toEqual([
      "family@x.com",
      "other@x.com",
    ]);
  });

  test("skips rows with no email", async () => {
    const calls: Call[] = [];
    const supabase = mockSupabase(
      [
        { id: "g1", name: "No Email", email: null },
        { id: "g2", name: "Has Email", email: "has@x.com" },
      ],
      calls,
    );
    const recipients = await computeRecipients(supabase, {
      programId: "p1",
      seasonId: null,
      ensembleId: null,
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe("has@x.com");
  });
});

describe("bodyToHtml + announcementHtml", () => {
  test("escapes HTML and paragraphs blank-line blocks", () => {
    const html = bodyToHtml("Hello <b>world</b>\n\nSecond line");
    expect(html).toContain("&lt;b&gt;world&lt;/b&gt;");
    expect(html).toContain("<p>Hello");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  test("footer carries the family links + unsubscribe, body has no injected raw HTML", () => {
    const html = announcementHtml({
      bodyMd: "Weekly note",
      links: guardianLinks("tok", allFlags(true)),
    });
    expect(html).toContain("/t/tok/itinerary");
    expect(html).toContain("/t/tok/signup");
    expect(html).toContain("/t/tok/absence");
    expect(html).toContain("/t/tok/unsubscribe");
    expect(html).toContain("<p>Weekly note</p>");
  });

  // The footer is a rendering of what the program HAS. It used to print all
  // three links unconditionally, so a program with shifts off mailed every
  // family a "Volunteer signup" link to a page that could only refuse.
  test("a link whose feature is off is not in the footer at all", () => {
    const html = announcementHtml({
      bodyMd: "Weekly note",
      links: guardianLinks("tok", { tier: "program", feature_overrides: { shifts: false } }),
    });
    expect(html).toContain("/t/tok/itinerary");
    expect(html).not.toContain("/t/tok/signup");
    expect(html).not.toContain("Volunteer signup");
    expect(html).toContain("/t/tok/absence");
  });

  test("with every feature off the footer is Unsubscribe alone, with no empty link row", () => {
    const html = announcementHtml({
      bodyMd: "Weekly note",
      links: guardianLinks("tok", allFlags(false)),
    });
    expect(html).toContain("/t/tok/unsubscribe");
    expect(html).toContain("Unsubscribe");
    // No orphaned separator left behind by the dropped links.
    expect(html).not.toContain("·");
  });
});

// ---------------------------------------------------------------------------
// The family-links email (lib/comms-send). Its intro used to promise every
// family "view the itinerary, sign up to volunteer, and report an absence"
// whatever the program had turned on — copy that named surfaces the footer below
// it no longer carried.
// ---------------------------------------------------------------------------
describe("guardianLinksEmailHtml intro", () => {
  test("names all three when the program has all three", () => {
    const html = guardianLinksEmailHtml({
      programName: "Northside Show Choir",
      links: guardianLinks("tok", allFlags(true)),
    });
    expect(html).toContain(
      "Use them to view the itinerary, sign up to volunteer, and report an absence.",
    );
  });

  test("names only what is on, in plain English", () => {
    const html = guardianLinksEmailHtml({
      programName: "Northside Show Choir",
      links: guardianLinks("tok", {
        tier: "program",
        feature_overrides: { shifts: false },
      }),
    });
    expect(html).toContain(
      "Use them to view the itinerary and report an absence.",
    );
    expect(html).not.toContain("sign up to volunteer");
  });

  test("promises no links at all when the program has no family pages on", () => {
    const html = guardianLinksEmailHtml({
      programName: "Northside Show Choir",
      links: guardianLinks("tok", allFlags(false)),
    });
    expect(html).not.toContain("Here are your personal links");
    expect(html).toContain("doesn't have any family pages turned on");
    // Unsubscribe still reaches them (CAN-SPAM / RFC 8058).
    expect(html).toContain("/t/tok/unsubscribe");
  });
});

describe("sendStatusLabel", () => {
  test("maps the send-pipeline statuses to friendly labels", () => {
    expect(sendStatusLabel("sent")).toBe("Sent");
    expect(sendStatusLabel("skipped_no_key")).toBe("Skipped — email not set up");
    expect(sendStatusLabel("bounced")).toBe("Bounced");
    expect(sendStatusLabel("failed")).toBe("Failed");
  });

  test("unknown statuses fall back to a de-underscored form (no raw token leaks)", () => {
    expect(sendStatusLabel("queued_retry")).toBe("queued retry");
    expect(sendStatusLabel("weird")).toBe("weird");
  });
});
