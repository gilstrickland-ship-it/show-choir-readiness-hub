// ============================================================================
// Unit tests — the wardrobe's shared helpers (spec 005 Wave W)
// ----------------------------------------------------------------------------
// Four boundaries live in lib/costumes.ts and every costume surface leans on
// them:
//   * the enum parsers, which sit between a hand-typed (or hostile) `?kind=` /
//     posted form value and a database enum;
//   * the inventory search sanitizer, which sits between a typed phrase and a
//     PostgREST filter STRING whose grammar a comma or a paren would rewrite;
//   * costumeChanges, which turns an ordered set list into the quick-change
//     sheet's columns — the model the sheet now explains in one sentence;
//   * the size-mismatch heuristic, which is advisory and must never claim a
//     mismatch it cannot actually judge (§4: "warns, never blocks").
//
// Pure functions only; no DB, no network (runs under vitest.unit.config.ts).
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  parsePieceKind,
  parsePieceCondition,
  parseAlterationStatus,
  pieceSearchTerm,
  costumeChanges,
  relevantSizeValue,
  sizeMismatch,
  isDirectKind,
} from "@/lib/costumes";

describe("enum parsers", () => {
  test("accept the enum values and nothing else", () => {
    expect(parsePieceKind("dress")).toBe("dress");
    expect(parsePieceKind("set_piece")).toBe("set_piece");
    expect(parsePieceCondition("fair")).toBe("fair");
    expect(parseAlterationStatus("in_progress")).toBe("in_progress");
  });

  test("reject anything that isn't one, including prototype keys", () => {
    for (const bad of ["", "Dress", "gown", "constructor", "__proto__", "toString"]) {
      expect(parsePieceKind(bad)).toBeNull();
      expect(parsePieceCondition(bad)).toBeNull();
      expect(parseAlterationStatus(bad)).toBeNull();
    }
  });

  test("a missing param is null, not a default", () => {
    // The pages read these off the URL: absent means "no filter", which is a
    // different answer from "an unrecognized filter".
    expect(parsePieceKind(null)).toBeNull();
    expect(parsePieceKind(undefined)).toBeNull();
    expect(parsePieceCondition(null)).toBeNull();
    expect(parseAlterationStatus(undefined)).toBeNull();
  });
});

describe("isDirectKind", () => {
  test("props and set pieces skip student assignment; costumes don't", () => {
    expect(isDirectKind("prop")).toBe(true);
    expect(isDirectKind("set_piece")).toBe(true);
    expect(isDirectKind("dress")).toBe(false);
    expect(isDirectKind("accessory")).toBe(false);
  });
});

describe("pieceSearchTerm", () => {
  test("keeps an ordinary search intact", () => {
    expect(pieceSearchTerm("Dress 14")).toBe("Dress 14");
    expect(pieceSearchTerm("  emerald  ")).toBe("emerald");
  });

  test("strips the characters that would rewrite the PostgREST filter", () => {
    // A comma starts a new filter, a paren closes the or() group, and %/*/_ are
    // wildcards the query adds itself.
    expect(pieceSearchTerm("dress,color.ilike.%")).toBe("dress color.ilike.");
    expect(pieceSearchTerm("a(b)c")).toBe("a b c");
    expect(pieceSearchTerm("dress_1")).toBe("dress 1");
    expect(pieceSearchTerm(`quote"and'quote`)).toBe("quote and quote");
  });

  test("caps the length and empties out to null", () => {
    expect(pieceSearchTerm("x".repeat(200))).toHaveLength(60);
    expect(pieceSearchTerm("")).toBeNull();
    expect(pieceSearchTerm("   ")).toBeNull();
    expect(pieceSearchTerm("%%%")).toBeNull();
    expect(pieceSearchTerm(null)).toBeNull();
    expect(pieceSearchTerm(undefined)).toBeNull();
  });
});

describe("costumeChanges", () => {
  const sets = [
    { id: "s1", name: "Opener" },
    { id: "s2", name: "Ballad" },
    { id: "s3", name: "Closer" },
  ];

  test("a change is the gap BETWEEN two sets, named for both", () => {
    const changes = costumeChanges(sets);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      number: 1,
      from: sets[0],
      to: sets[1],
      label: "Opener → Ballad",
    });
    expect(changes[1].number).toBe(2);
    expect(changes[1].label).toBe("Ballad → Closer");
  });

  test("fewer than two sets means there is nothing to change between", () => {
    expect(costumeChanges([])).toEqual([]);
    expect(costumeChanges([sets[0]])).toEqual([]);
  });

  test("the label never falls back to a sort number", () => {
    // The whole point of US15: a column says what it is in the program's own
    // words, whatever the sets are called.
    const [only] = costumeChanges([
      { id: "a", name: "Set 1" },
      { id: "b", name: "Set 2" },
    ]);
    expect(only.label).toBe("Set 1 → Set 2");
  });
});

describe("relevantSizeValue", () => {
  test("maps a piece kind onto the program's own size key", () => {
    const sizes = { Dress: "6", Shoe: "8.5", Jacket: "M" };
    expect(relevantSizeValue("dress", sizes)).toBe("6");
    expect(relevantSizeValue("shoes", sizes)).toBe("8.5");
    expect(relevantSizeValue("vest", sizes)).toBe("M");
  });

  test("returns null when no size key plausibly applies", () => {
    const sizes = { Dress: "6" };
    // Accessories, props and set pieces map to nothing — we can't judge them.
    expect(relevantSizeValue("accessory", sizes)).toBeNull();
    expect(relevantSizeValue("prop", sizes)).toBeNull();
    expect(relevantSizeValue("pants", sizes)).toBeNull();
    expect(relevantSizeValue("dress", null)).toBeNull();
    expect(relevantSizeValue("dress", { Dress: "  " })).toBeNull();
  });
});

describe("sizeMismatch", () => {
  test("flags a real disagreement", () => {
    expect(sizeMismatch("8", "dress", { Dress: "6" })).toBe(true);
  });

  test("stays quiet when it cannot judge", () => {
    // No piece size, no student size, or a kind with no size key at all: an
    // advisory chip that fires on absence is a chip nobody trusts.
    expect(sizeMismatch(null, "dress", { Dress: "6" })).toBe(false);
    expect(sizeMismatch("  ", "dress", { Dress: "6" })).toBe(false);
    expect(sizeMismatch("6", "dress", null)).toBe(false);
    expect(sizeMismatch("6", "prop", { Dress: "8" })).toBe(false);
  });

  test("is tolerant of case and spacing, which are not disagreements", () => {
    expect(sizeMismatch("m", "vest", { Jacket: "M" })).toBe(false);
    expect(sizeMismatch(" 6 ", "dress", { Dress: "6" })).toBe(false);
  });
});
