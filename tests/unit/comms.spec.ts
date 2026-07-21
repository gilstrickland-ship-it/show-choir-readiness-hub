// ============================================================================
// Unit tests — comms recipients + body rendering (T023/T025/T026)
// ----------------------------------------------------------------------------
// Pure-ish: computeRecipients is exercised against a tiny chainable Supabase mock
// so we can prove (a) it filters to email_status='ok' at the query layer — the
// mechanism that HONORS bounce/unsubscribe (T026) — and (b) it dedupes families
// by lowercased email. bodyToHtml/announcementHtml are pure.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  computeRecipients,
  bodyToHtml,
  announcementHtml,
  sendStatusLabel,
} from "@/lib/comms";
import type { SupabaseClient } from "@supabase/supabase-js";

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

  test("footer carries the three family links + unsubscribe, body has no injected raw HTML", () => {
    const html = announcementHtml({
      bodyMd: "Weekly note",
      links: {
        itinerary: "https://x/t/tok/itinerary",
        signup: "https://x/t/tok/signup",
        absence: "https://x/t/tok/absence",
        unsubscribe: "https://x/t/tok/unsubscribe",
      },
    });
    expect(html).toContain('href="https://x/t/tok/itinerary"');
    expect(html).toContain('href="https://x/t/tok/signup"');
    expect(html).toContain('href="https://x/t/tok/absence"');
    expect(html).toContain('href="https://x/t/tok/unsubscribe"');
    expect(html).toContain("<p>Weekly note</p>");
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
