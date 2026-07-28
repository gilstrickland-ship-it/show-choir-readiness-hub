// ============================================================================
// Unit tests — the anonymous parent surface is not indexable (§8a, Const. II)
// ----------------------------------------------------------------------------
// The /t/ layout sets `metadata.robots`, which Next emits as a <meta> tag — and
// a <meta> tag exists only in an HTML response. Three of the routes under /t/
// are ROUTE HANDLERS: the parent packet PDF (which prints students' names
// against hotel room assignments), the per-competition .ics, and the season
// calendar feed. They have no <head>, so the directive has to be a header.
//
// These tests pin that it is set for the WHOLE subtree, in middleware, once:
// on the ordinary pass-through, on the rate-limit refusal, and therefore on the
// route handlers' own responses (including their text() error paths, which is
// asserted end-to-end in tests/e2e/parent-token.spec.ts).
// ============================================================================

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isNoIndexPath,
  NOINDEX_HEADER,
  NOINDEX_VALUE,
  NOINDEX_PREFIX,
} from "@/lib/no-index";
import { __resetRateLimit, IP_LIMIT } from "@/lib/rate-limit";

// The middleware's only other job is refreshing the Supabase auth cookie. That
// is a network call; replace it, so this spec stays a pure unit test.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { middleware } from "@/middleware";

const TOKEN = "abcdefghijklmnopqrstuvwx";

function get(path: string, ip = "203.0.113.7"): NextRequest {
  return new NextRequest(`https://example.test${path}`, {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  __resetRateLimit();
});

describe("every path under the token surface is a no-index path", () => {
  // The four routes a crawler could reach, named explicitly: the family home is
  // HTML, the other three are route handlers whose bodies are a PDF or a
  // calendar feed and carry no markup at all.
  test.each([
    `/t/${TOKEN}`,
    `/t/${TOKEN}/itinerary`,
    `/t/${TOKEN}/packet?competition=abc`,
    `/t/${TOKEN}/itinerary/ics/comp-1`,
    `/t/${TOKEN}/calendar`,
  ])("%s", (path) => {
    expect(isNoIndexPath(new URL(`https://x.test${path}`).pathname)).toBe(true);
  });

  test("and nothing else is — /link-help stays findable on purpose", () => {
    expect(isNoIndexPath("/link-help")).toBe(false);
    expect(isNoIndexPath("/")).toBe(false);
    expect(isNoIndexPath("/demo/dashboard")).toBe(false);
    // Not a prefix match on the letter: /travel is staff, and inside a login.
    expect(isNoIndexPath("/travel")).toBe(false);
  });
});

describe("middleware sets the header for the whole /t/ subtree", () => {
  test("the packet PDF route carries it", async () => {
    const res = await middleware(get(`/t/${TOKEN}/packet?competition=abc`));
    expect(res.headers.get(NOINDEX_HEADER)).toBe(NOINDEX_VALUE);
  });

  test("so do the two calendar feeds and the family page", async () => {
    for (const path of [
      `/t/${TOKEN}`,
      `/t/${TOKEN}/itinerary/ics/comp-1`,
      `/t/${TOKEN}/calendar`,
    ]) {
      const res = await middleware(get(path));
      expect(res.headers.get(NOINDEX_HEADER)).toBe(NOINDEX_VALUE);
    }
  });

  test("the rate-limit refusal carries it too — a 429 body is still a response", async () => {
    const ip = "198.51.100.4";
    let last: Response | undefined;
    for (let i = 0; i <= IP_LIMIT; i++) {
      last = await middleware(get(`/t/${TOKEN}/packet`, ip));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get(NOINDEX_HEADER)).toBe(NOINDEX_VALUE);
  });

  test("a staff page is left alone — the app's own surfaces are behind a login", async () => {
    const res = await middleware(get("/demo/dashboard"));
    expect(res.headers.get(NOINDEX_HEADER)).toBeNull();
  });
});

describe("robots.txt says the same thing", () => {
  test("it disallows exactly the token surface", async () => {
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(false);
    const rule = rules as { userAgent?: unknown; disallow?: unknown };
    expect(rule.userAgent).toBe("*");
    expect(rule.disallow).toBe(NOINDEX_PREFIX);
  });
});
