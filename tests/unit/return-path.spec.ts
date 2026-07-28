// ============================================================================
// Unit tests — server-side return-path allow-list (Constitution I)
// ----------------------------------------------------------------------------
// A create/edit form rendered somewhere other than its own module page posts an
// opaque `from` KEY plus the program slug; this module turns that pair into a
// path WE own. Both halves have to fail closed: an unknown key, and a "slug"
// that is really the front half of somebody else's URL.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  returnPath,
  programPath,
  isProgramSlug,
  isReturnSurface,
  programRoot,
} from "@/lib/return-path";

describe("returnPath", () => {
  test("resolves the two allow-listed surfaces", () => {
    expect(returnPath("demo", "season")).toBe("/demo/season");
    expect(returnPath("demo", "dashboard")).toBe("/demo/dashboard");
  });

  test("tolerates surrounding whitespace on the key", () => {
    expect(returnPath("demo", " season ")).toBe("/demo/season");
  });

  test("an absent or unknown key means the module-page redirect", () => {
    expect(returnPath("demo", "")).toBeNull();
    expect(returnPath("demo", "treasury")).toBeNull();
    // Not a key: a URL. The whole point of the allow-list.
    expect(returnPath("demo", "https://evil.example/steal")).toBeNull();
    expect(returnPath("demo", "/demo/season")).toBeNull();
  });

  test("a prototype key is not a surface", () => {
    expect(returnPath("demo", "constructor")).toBeNull();
    expect(returnPath("demo", "toString")).toBeNull();
  });

  test("a slug that isn't a slug can't become a protocol-relative redirect", () => {
    // "/" + "/evil.example" reads as "//evil.example/season" — a browser follows
    // that off-site. Fail closed instead.
    expect(returnPath("/evil.example", "season")).toBeNull();
    expect(returnPath("//evil.example", "season")).toBeNull();
    expect(returnPath("demo/../../evil", "season")).toBeNull();
    expect(returnPath("https://evil.example", "season")).toBeNull();
    expect(returnPath("", "season")).toBeNull();
    expect(returnPath("demo?next=x", "season")).toBeNull();
    expect(returnPath("demo#x", "season")).toBeNull();
  });
});

describe("isProgramSlug", () => {
  test("accepts what the program-create flow mints", () => {
    expect(isProgramSlug("demo")).toBe(true);
    expect(isProgramSlug("e2e-test-program")).toBe(true);
    expect(isProgramSlug("2026-choir")).toBe(true);
  });

  test("rejects anything that could change what the path means", () => {
    expect(isProgramSlug("/demo")).toBe(false);
    expect(isProgramSlug("-demo")).toBe(false);
    expect(isProgramSlug("Demo")).toBe(false);
    expect(isProgramSlug("de mo")).toBe(false);
    expect(isProgramSlug("demo/season")).toBe(false);
    expect(isProgramSlug("")).toBe(false);
  });
});

describe("programPath", () => {
  test("builds an in-app path for a real slug", () => {
    expect(programPath("demo", "dashboard")).toBe("/demo/dashboard");
  });

  test("returns null rather than a path a caller could interpolate anyway", () => {
    expect(programPath("/evil.example", "dashboard")).toBeNull();
  });
});

describe("programRoot (T143a)", () => {
  test("is the program's own path, with no trailing segment", () => {
    // revalidatePath(…, "layout") is given this when a write changes the shell
    // (the header prints the active season's label). `/demo/` is a different
    // cache key from `/demo`, which is why it is not programPath(slug, "").
    expect(programRoot("demo")).toBe("/demo");
    expect(programPath("demo", "")).toBe("/demo/");
  });

  test("fails closed on the same hostile values programPath does", () => {
    expect(programRoot("/evil.example")).toBeNull();
    expect(programRoot("")).toBeNull();
    expect(programRoot("HTTPS://evil.example")).toBeNull();
  });
});

describe("isReturnSurface", () => {
  test("narrows to the two surfaces that host borrowed forms", () => {
    expect(isReturnSurface("season")).toBe(true);
    expect(isReturnSurface("dashboard")).toBe(true);
    expect(isReturnSurface("settings")).toBe(false);
  });
});
