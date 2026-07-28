// ============================================================================
// Unit tests — the trip page's URL contract (spec 005 Wave 2)
// ----------------------------------------------------------------------------
// Everything the trip page reads out of its own query string, and everything the
// travel actions write into it, goes through three helpers in shared.ts. They
// are the boundary between a hand-typed (or hostile) URL and what the page
// renders, so they are pinned here: an unrecognized code must render nothing, a
// prototype key must not resolve to a function, and a kind that isn't a kind
// must not reach the query string at all.
//
// Pure functions only; no DB, no network (runs under vitest.unit.config.ts).
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  tripError,
  asGroupKind,
  kindQuery,
} from "@/app/(app)/[program]/travel/[tripId]/shared";

describe("tripError", () => {
  test("resolves a known code to its section and message", () => {
    expect(tripError("name")).toEqual({
      slot: "overview",
      message: "A trip needs a name.",
    });
    expect(tripError("group")?.slot).toBe("group");
    expect(tripError("chaperone")?.slot).toBe("chaperones");
    expect(tripError("trip_delete")?.slot).toBe("danger");
  });

  test("returns null for an absent or unrecognized code", () => {
    expect(tripError(null)).toBeNull();
    expect(tripError("")).toBeNull();
    expect(tripError("not_a_code")).toBeNull();
  });

  test("rejects Object.prototype keys rather than walking the prototype", () => {
    // ?error=constructor once handed React a function to render.
    for (const key of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "__proto__",
      "valueOf",
    ]) {
      expect(tripError(key)).toBeNull();
    }
  });
});

describe("asGroupKind", () => {
  test("passes the two real kinds through", () => {
    expect(asGroupKind("bus")).toBe("bus");
    expect(asGroupKind("room")).toBe("room");
  });

  test("rejects anything else, including prototype keys and null", () => {
    expect(asGroupKind(null)).toBeNull();
    expect(asGroupKind("")).toBeNull();
    expect(asGroupKind("buses")).toBeNull();
    expect(asGroupKind("Bus")).toBeNull();
    expect(asGroupKind("constructor")).toBeNull();
    expect(asGroupKind("__proto__")).toBeNull();
  });
});

describe("kindQuery", () => {
  test("emits the errorKind param for a real kind", () => {
    expect(kindQuery("bus")).toBe("&errorKind=bus");
    expect(kindQuery("room")).toBe("&errorKind=room");
  });

  test("emits nothing at all for a value that isn't a kind", () => {
    // Nothing that fails the allow-list may reach the URL — not even encoded.
    expect(kindQuery("")).toBe("");
    expect(kindQuery("van")).toBe("");
    expect(kindQuery("constructor")).toBe("");
    expect(kindQuery("bus&conflict=x")).toBe("");
    expect(kindQuery("bus#anchor")).toBe("");
  });

  test("round-trips with asGroupKind, which is what the page reads it back with", () => {
    for (const kind of ["bus", "room"] as const) {
      const param = kindQuery(kind).replace("&errorKind=", "");
      expect(asGroupKind(param)).toBe(kind);
    }
  });
});
