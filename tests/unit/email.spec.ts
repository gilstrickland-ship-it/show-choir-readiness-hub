// ============================================================================
// Unit tests — LIKE/ILIKE metacharacter escaping (E3).
// ----------------------------------------------------------------------------
// `escapeLike` turns an ILIKE filter into a safe case-insensitive EXACT match by
// escaping `\`, `%`, and `_` so a stored value is matched literally. Every
// address-matching ILIKE site (Resend webhook, guardian unsubscribe, /launch
// invite lookup, self-service link recovery) runs the value through this first.
// ============================================================================

import { describe, test, expect } from "vitest";
import { escapeLike } from "@/lib/email";

describe("escapeLike", () => {
  test("leaves an ordinary address untouched", () => {
    expect(escapeLike("parent@example.org")).toBe("parent@example.org");
  });

  test("escapes an underscore so it isn't a single-char wildcard", () => {
    expect(escapeLike("first_last@example.org")).toBe(
      "first\\_last@example.org",
    );
  });

  test("escapes a percent so it isn't a multi-char wildcard", () => {
    expect(escapeLike("a%b@example.org")).toBe("a\\%b@example.org");
  });

  test("escapes a backslash first so its own escape isn't re-escaped", () => {
    // A literal backslash becomes `\\`; the following `_` becomes `\_` — i.e. no
    // runaway doubling. Each metacharacter is escaped exactly once.
    expect(escapeLike("a\\_b")).toBe("a\\\\\\_b");
  });

  test("escapes every metacharacter in a mixed value", () => {
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });

  test("is a no-op on the empty string", () => {
    expect(escapeLike("")).toBe("");
  });

  test("would not widen a match: an escaped value has no bare wildcard", () => {
    const escaped = escapeLike("100%_off@x.io");
    // No `%` or `_` remains unpreceded by a backslash.
    expect(/(?<!\\)[%_]/.test(escaped)).toBe(false);
  });
});
