// One convention for the messages a surface shows after a write (spec 005 Wave
// 8 / T142), generalized from the strongest version of it — the host command
// center's `?ok=`/`?error=` contract (Wave 7).
//
// What it replaces: every page hand-rolled this. Some declared a search param
// per outcome and printed a toast per param (hosting had EIGHT, shifts five);
// some kept an `ERR` object plus a private `message()` that forgot the prototype
// guard; the trip page and the ledger each invented their own idea of which
// section a message belongs to. Three ingredients turned out to be the whole
// job, and they are the three below.
//
//   1. A MAP from URL code to { section, message }. The map is the contract:
//      the section is part of the entry, so the anchor a redirect scrolls to and
//      the block that renders the message are the same answer, read from the
//      same place, and cannot drift.
//   2. A LOOKUP that goes through Object.hasOwn. The code rides in the URL, so
//      `?error=constructor` must resolve to nothing rather than walking up
//      Object.prototype and handing React a function to render — and `?error=`
//      may arrive as an ARRAY (`?error=a&error=b`), which must not 500 the page.
//   3. A typed KEY UNION shared by the actions that write the URL and the page
//      that reads it, so a key no action emits shows up in review, and a key no
//      map defines is a compile error at the redirect that would have emitted it.
//
// Rendering lives in app/(app)/[program]/Flash.tsx. This module is pure — no
// React, no DB — so the maps and the guards are unit-testable on their own.

export interface FlashEntry<S extends string = string> {
  // Which block of the page owns this message. A page with one message area
  // uses a single-member union; the trip page, the ledger and the host center
  // each name several.
  section: S;
  message: string;
}

// Keyed by the surface's own key union, so every key it declares has a message
// and a home section — a missing one is a type error, not a blank alert.
export type FlashMap<K extends string, S extends string> = Record<
  K,
  FlashEntry<S>
>;

// What Next hands a page: a duplicated param arrives as an array.
export type SearchParams = Record<string, string | string[] | undefined>;

// A single string value for a param, or null. An array-typed param (a
// hand-typed or hostile `?error=a&error=b`) reads as absent rather than being
// coerced into "a,b" and looked up.
export function oneParam(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  return typeof v === "string" ? v : null;
}

// Resolve a code against a map. Unrecognized, absent, or a prototype key → null.
export function flashFrom<K extends string, S extends string>(
  map: FlashMap<K, S>,
  code: string | null | undefined,
): FlashEntry<S> | null {
  if (!code || !Object.hasOwn(map, code)) return null;
  return map[code as K];
}

// The writing half of the contract: an action building a redirect asks the map
// which section its key belongs to rather than repeating the answer at the call
// site. Keyed by the union, so both halves are compile-checked together.
export function flashSection<K extends string, S extends string>(
  map: FlashMap<K, S>,
  key: K,
): S {
  return map[key].section;
}

export interface PageFlash<S extends string> {
  ok: FlashEntry<S> | null;
  error: FlashEntry<S> | null;
}

// Read both codes off the URL in one call.
//
// `fallbackSection` decides what an UNRECOGNIZED `?error=` does. Omit it and the
// message is dropped (the host center and the trip page have always worked that
// way: an unknown code is a URL someone typed, not a failure that happened).
// Supply it and an unresolved code still says something out loud in that
// section — which is what the money and shifts surfaces need, because there a
// stale or renamed code means a write really did fail, and a silent failure over
// money is the worst outcome of the three.
export function readFlash<S extends string>(
  sp: SearchParams,
  maps: {
    ok?: FlashMap<string, S>;
    error?: FlashMap<string, S>;
    fallbackSection?: S;
  },
): PageFlash<S> {
  const okCode = oneParam(sp, "ok");
  const errorCode = oneParam(sp, "error");
  const ok = maps.ok ? flashFrom(maps.ok, okCode) : null;
  let error = maps.error ? flashFrom(maps.error, errorCode) : null;
  if (!error && errorCode && maps.fallbackSection !== undefined) {
    error = { section: maps.fallbackSection, message: "Something went wrong." };
  }
  return { ok, error };
}
