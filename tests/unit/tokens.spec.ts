// ============================================================================
// Unit tests — tokenized link layer primitives (T021, §8a).
// ----------------------------------------------------------------------------
// Pure parts only; no DB, no network (runs under vitest.unit.config.ts). Covers
// mint/hash/verify and the capability allow-list SHAPE — the allow-list is the
// security boundary for the anonymous token surface, so its exact contents are
// asserted here to catch accidental capability creep (Constitution II).
// ============================================================================

import { describe, test, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateToken,
  hashToken,
  verifyToken,
  guardianLinks,
  guardianCan,
  shareCan,
  shareResourceTable,
  revokeShareLink,
  documentAllowsToken,
  parentSurfaceAvailable,
  seasonCalendarAvailable,
  CAPABILITIES,
  GUARDIAN_CAPABILITIES,
  SHARE_CAPABILITIES,
  GUARDIAN_WRITE_CAPABILITIES,
  DOCUMENT_TOKEN_KINDS,
  PARENT_SURFACE_FLAGS,
  SEASON_CALENDAR_FLAGS,
  GUARDIAN_LINK_SURFACES,
  type ParentSurface,
} from "@/lib/tokens";
import type { FlagKey, FlaggableProgram } from "@/lib/flags";

describe("mint / hash", () => {
  test("generateToken yields a URL-safe raw token and its sha256-hex hash", () => {
    const { raw, hash } = generateToken();
    // base64url: no +, /, or = padding.
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes → 43 base64url chars.
    expect(raw.length).toBeGreaterThanOrEqual(43);
    // sha256 hex is 64 chars.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(raw));
  });

  test("tokens are unique across mints (≥128-bit random)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateToken().raw);
    expect(seen.size).toBe(200);
  });

  test("hashToken is deterministic", () => {
    expect(hashToken("hello")).toBe(hashToken("hello"));
    expect(hashToken("hello")).not.toBe(hashToken("world"));
  });
});

describe("verify (constant-time)", () => {
  test("accepts a raw token against its own hash", () => {
    const { raw, hash } = generateToken();
    expect(verifyToken(raw, hash)).toBe(true);
  });

  test("rejects a wrong token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(verifyToken(a.raw, b.hash)).toBe(false);
  });

  test("rejects when lengths differ (no throw)", () => {
    expect(verifyToken("x", "abcd")).toBe(false);
  });
});

describe("capability allow-list (exhaustive — §8a)", () => {
  test("guardian capabilities are EXACTLY the documented set", () => {
    // email:unsubscribe is a deliberate, justified addition (CAN-SPAM + RFC 8058
    // one-click): a preference write on the recipient's own address, added to the
    // allow-list so the token unsubscribe surfaces are gated by it. The list
    // stays tiny — this test guards against any further creep.
    expect([...GUARDIAN_CAPABILITIES].sort()).toEqual(
      [
        "absence:submit",
        "costume:view",
        "email:unsubscribe",
        "itinerary:view",
        "shift:cancel",
        "shift:claim",
        "signup:view",
      ].sort(),
    );
  });

  test("guardian WRITES are exactly the three operational writes", () => {
    // Unsubscribe is a PREFERENCE write, not an operational one — it stays OUT of
    // this set (which gates the shift/absence writes that touch operations).
    expect([...GUARDIAN_WRITE_CAPABILITIES].sort()).toEqual(
      ["absence:submit", "shift:cancel", "shift:claim"].sort(),
    );
  });

  test("share links allow ONLY read-only resource view", () => {
    expect([...SHARE_CAPABILITIES]).toEqual(["resource:view"]);
  });

  test("CAPABILITIES groups the two kinds", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(["guardian", "share"]);
  });

  test("guardianCan / shareCan gate correctly", () => {
    expect(guardianCan("shift:claim")).toBe(true);
    expect(guardianCan("resource:view")).toBe(false);
    expect(guardianCan("ledger:write")).toBe(false);
    expect(shareCan("resource:view")).toBe(true);
    expect(shareCan("shift:claim")).toBe(false);
  });
});

describe("share resource → parent table (cross-program guard)", () => {
  // share_links.resource_id is a POLYMORPHIC soft reference, so no foreign key
  // can hold it — mintShareLink and resolveToken instead check the referenced
  // row lives in the link's own program, and this mapping tells them which table
  // to look in. A resource kind missing from it would skip the check entirely,
  // which is exactly the hole that let a link reach another tenant's packet.
  test("every share resource maps to the table it points at", () => {
    expect(shareResourceTable("itinerary")).toBe("competitions");
    expect(shareResourceTable("packet")).toBe("competitions");
    expect(shareResourceTable("signup_page")).toBe("seasons");
    expect(shareResourceTable("season_calendar")).toBe("seasons");
  });

  test("no share resource resolves to an unknown table", () => {
    for (const resource of [
      "itinerary",
      "packet",
      "signup_page",
      "season_calendar",
    ] as const) {
      expect(["competitions", "seasons"]).toContain(shareResourceTable(resource));
    }
  });
});

// ---------------------------------------------------------------------------
// F-A — one share link, two very different documents.
//
// Publishing an itinerary auto-mints a BROADCAST share link and tells the
// director they shared the times. The packet route accepted that same
// `resource='itinerary'` token and served the parent packet PDF, which prints
// bus and hotel-ROOM assignments student by student plus chaperone and
// volunteer names. A director pasting the "itinerary" link into a public
// booster post published a rooming list for minors.
//
// The capability was narrowed to match the promise. These tests pin the table
// that decides it: flip packet_pdf back to accepting "share" and they fail.
describe("which token kinds may open which document (Constitution III)", () => {
  test("the packet PDF is GUARDIAN-ONLY — no broadcast link reaches it", () => {
    expect([...DOCUMENT_TOKEN_KINDS.packet_pdf]).toEqual(["guardian"]);
    expect(documentAllowsToken("packet_pdf", "guardian")).toBe(true);
    expect(documentAllowsToken("packet_pdf", "share")).toBe(false);
  });

  test("the documents that carry only TIMES stay shareable", () => {
    // The itinerary page and its .ics name no person, so the broadcast link the
    // director was promised still works — narrowing the packet did not quietly
    // take away the thing they meant to share.
    expect(documentAllowsToken("itinerary_page", "share")).toBe(true);
    expect(documentAllowsToken("itinerary_ics", "share")).toBe(true);
    expect(documentAllowsToken("itinerary_page", "guardian")).toBe(true);
    expect(documentAllowsToken("itinerary_ics", "guardian")).toBe(true);
  });

  test("the season feed is addressed by a season, so share links only", () => {
    expect([...DOCUMENT_TOKEN_KINDS.season_feed]).toEqual(["share"]);
    expect(documentAllowsToken("season_feed", "guardian")).toBe(false);
  });

  test("every document names at least one kind and no unknown kind", () => {
    for (const kinds of Object.values(DOCUMENT_TOKEN_KINDS)) {
      expect(kinds.length).toBeGreaterThan(0);
      for (const k of kinds) expect(["guardian", "share"]).toContain(k);
    }
  });
});

// ---------------------------------------------------------------------------
// F-B — the parent surface evaluated no feature flags at all. Turning `shifts`
// off left families still claiming volunteer slots that no staff surface could
// show or manage. The rule (lib/tokens) is: a parent surface is available only
// when every flag its STAFF half requires is on, in the same combinations.
describe("feature flags on the anonymous parent surface (Constitution VIII)", () => {
  // A program with every flag explicitly set, so a test says what it means
  // rather than leaning on a tier baseline.
  function program(overrides: Partial<Record<FlagKey, boolean>>): FlaggableProgram {
    return {
      tier: "program",
      feature_overrides: overrides as Record<string, boolean>,
    };
  }

  test("the surface → flags map is EXACTLY the documented set", () => {
    // Adding a parent route means adding a line here. That is the point: the
    // finding was a whole surface with no entries at all.
    expect(
      Object.fromEntries(
        (Object.keys(PARENT_SURFACE_FLAGS) as ParentSurface[])
          .sort()
          .map((k) => [k, [...PARENT_SURFACE_FLAGS[k]].sort()]),
      ),
    ).toEqual({
      absence: ["competitions"],
      costumes: ["costumes"],
      itinerary: ["competitions"],
      packet: ["competitions"],
      signup: ["comms", "shifts"],
      unsubscribe: [],
      welcome: ["guide"],
    });
  });

  test("volunteer signup needs BOTH comms and shifts, like /comms/shifts does", () => {
    expect(
      parentSurfaceAvailable(program({ comms: true, shifts: true }), "signup"),
    ).toBe(true);
    // Either one off closes it — this is the exact case in the finding: shifts
    // off, families still signing up.
    expect(
      parentSurfaceAvailable(program({ comms: true, shifts: false }), "signup"),
    ).toBe(false);
    expect(
      parentSurfaceAvailable(program({ comms: false, shifts: true }), "signup"),
    ).toBe(false);
  });

  test("competitions off closes the itinerary, the packet and absences", () => {
    const off = program({ competitions: false });
    expect(parentSurfaceAvailable(off, "itinerary")).toBe(false);
    expect(parentSurfaceAvailable(off, "packet")).toBe(false);
    expect(parentSurfaceAvailable(off, "absence")).toBe(false);

    const on = program({ competitions: true });
    expect(parentSurfaceAvailable(on, "itinerary")).toBe(true);
    expect(parentSurfaceAvailable(on, "packet")).toBe(true);
    expect(parentSurfaceAvailable(on, "absence")).toBe(true);
  });

  test("costumes and the welcome card follow their own flags", () => {
    expect(parentSurfaceAvailable(program({ costumes: false }), "costumes")).toBe(
      false,
    );
    // flagRegistry's `guide` description names the "parent welcome card" in as
    // many words, and nothing on this surface evaluated it.
    expect(parentSurfaceAvailable(program({ guide: false }), "welcome")).toBe(
      false,
    );
  });

  test("unsubscribe is available with EVERY flag off (CAN-SPAM / RFC 8058)", () => {
    const allOff = program(
      Object.fromEntries(
        (
          [
            "costumes",
            "competitions",
            "travel",
            "treasury",
            "comms",
            "digest",
            "announcements",
            "shifts",
            "events",
            "archive",
            "guide",
          ] as FlagKey[]
        ).map((k) => [k, false]),
      ) as Partial<Record<FlagKey, boolean>>,
    );
    expect(parentSurfaceAvailable(allOff, "unsubscribe")).toBe(true);
    // …and it is the ONLY unconditional one.
    for (const surface of Object.keys(PARENT_SURFACE_FLAGS) as ParentSurface[]) {
      if (surface === "unsubscribe") continue;
      expect(parentSurfaceAvailable(allOff, surface)).toBe(false);
    }
  });

  test("the season feed is ANY-OF, mirroring the Season page that mints it", () => {
    expect([...SEASON_CALENDAR_FLAGS].sort()).toEqual([
      "competitions",
      "events",
      "travel",
    ]);
    // One of the three is enough — the feed still has something to carry.
    expect(
      seasonCalendarAvailable(
        program({ competitions: false, events: true, travel: false }),
      ),
    ).toBe(true);
    expect(
      seasonCalendarAvailable(
        program({ competitions: false, events: false, travel: false }),
      ),
    ).toBe(false);
  });
});

// The emailed footer is the same rule as the on-page one: a link to a surface
// this program has turned off lands on "not available", and a parent cannot tell
// that apart from a broken app. Unsubscribe is the documented exception and
// survives every flag being off (CAN-SPAM / RFC 8058).
describe("guardianLinks (the canonical footer URLs)", () => {
  function program(
    overrides: Partial<Record<FlagKey, boolean>>,
  ): FlaggableProgram {
    return {
      tier: "program",
      feature_overrides: overrides as Record<string, boolean>,
    };
  }

  const ALL_ON = program({ competitions: true, comms: true, shifts: true });

  test("builds itinerary / signup / absence off the raw token, in footer order", () => {
    const { links } = guardianLinks("RAWTOKEN", ALL_ON);
    expect(links.map((l) => l.surface)).toEqual([
      "itinerary",
      "signup",
      "absence",
    ]);
    expect(links.map((l) => l.label)).toEqual([
      "Itinerary",
      "Volunteer signup",
      "Report an absence",
    ]);
    expect(links.map((l) => l.url)).toEqual([
      expect.stringMatching(/\/t\/RAWTOKEN\/itinerary$/),
      expect.stringMatching(/\/t\/RAWTOKEN\/signup$/),
      expect.stringMatching(/\/t\/RAWTOKEN\/absence$/),
    ]);
  });

  test("unsubscribe is built off the same token", () => {
    expect(guardianLinks("RAWTOKEN", ALL_ON).unsubscribe).toMatch(
      /\/t\/RAWTOKEN\/unsubscribe$/,
    );
  });

  // The finding itself: shifts off, and every announcement still invited the
  // family to sign up to volunteer.
  test("shifts off drops the volunteer signup link and nothing else", () => {
    const { links } = guardianLinks("RAWTOKEN", program({ shifts: false }));
    expect(links.map((l) => l.surface)).toEqual(["itinerary", "absence"]);
  });

  test("competitions off drops both the itinerary and the absence link", () => {
    const { links } = guardianLinks("RAWTOKEN", program({ competitions: false }));
    expect(links.map((l) => l.surface)).toEqual(["signup"]);
  });

  test("every flag off leaves NO links but still unsubscribes (CAN-SPAM)", () => {
    const allOff = program({
      competitions: false,
      comms: false,
      shifts: false,
    });
    const { links, unsubscribe } = guardianLinks("RAWTOKEN", allOff);
    expect(links).toEqual([]);
    expect(unsubscribe).toMatch(/\/t\/RAWTOKEN\/unsubscribe$/);
  });

  // Every surface the footer offers must be one the flag map knows about —
  // otherwise a link could be added here that no rule ever gates.
  test("every footer surface is in PARENT_SURFACE_FLAGS", () => {
    for (const surface of GUARDIAN_LINK_SURFACES) {
      expect(PARENT_SURFACE_FLAGS).toHaveProperty(surface);
    }
  });
});

// ---------------------------------------------------------------------------
// Revoking is the ONE control a director has over a URL they have already handed
// out — an emailed link, a link in a program newsletter. The Settings button
// says "That URL stops working immediately", and revokeShareLink used to be
// `Promise<void>`: it threw the result away, so a refused write, or a link id
// belonging to another program, produced exactly the same confident message.
// Being told a live link is dead is worse than being told nothing.
//
// Zero rows is NOT automatically a failure, though — the update is filtered on
// `revoked_at is null`, so a second press of a button on a stale page matches
// nothing while the link genuinely IS dead. That case is confirmed with a read
// rather than guessed at in either direction. All three outcomes below.
describe("revokeShareLink reports whether the URL is actually dead", () => {
  // A client just complete enough for this one function: an update chain that
  // settles with what the test says, and a follow-up select that answers
  // whether the link was already revoked.
  function client(opts: {
    updated: { id: string }[] | null;
    updateError?: boolean;
    alreadyRevoked?: boolean;
  }): SupabaseClient {
    return {
      from: () => {
        let op: "select" | "update" = "select";
        const builder: Record<string, unknown> = {
          update: () => ((op = "update"), builder),
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          maybeSingle: () => builder,
          then: (onOk: (v: unknown) => unknown) =>
            Promise.resolve(
              op === "update"
                ? {
                    data: opts.updated,
                    error: opts.updateError ? { message: "refused" } : null,
                  }
                : {
                    data: opts.alreadyRevoked ? { id: "sl1" } : null,
                    error: null,
                  },
            ).then(onOk),
        };
        return builder;
      },
    } as unknown as SupabaseClient;
  }

  const args = { programId: "p1", shareLinkId: "sl1" };

  test("a live link it revoked → ok", async () => {
    const res = await revokeShareLink(client({ updated: [{ id: "sl1" }] }), args);
    expect(res.ok).toBe(true);
  });

  test("a link that was ALREADY revoked → still ok, because the URL is dead", async () => {
    const res = await revokeShareLink(
      client({ updated: [], alreadyRevoked: true }),
      args,
    );
    expect(res.ok).toBe(true);
  });

  test("a link that is not this program's → NOT ok, so nothing reassuring is said", async () => {
    const res = await revokeShareLink(
      client({ updated: [], alreadyRevoked: false }),
      args,
    );
    expect(res.ok).toBe(false);
  });

  test("a refused write → NOT ok", async () => {
    const res = await revokeShareLink(
      client({ updated: null, updateError: true }),
      args,
    );
    expect(res.ok).toBe(false);
  });
});
