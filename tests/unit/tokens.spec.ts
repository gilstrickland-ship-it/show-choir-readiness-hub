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
  CAPABILITIES,
  GUARDIAN_CAPABILITIES,
  SHARE_CAPABILITIES,
  GUARDIAN_WRITE_CAPABILITIES,
} from "@/lib/tokens";

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

describe("guardianLinks (three canonical footer URLs)", () => {
  test("builds itinerary / signup / absence / unsubscribe links off the raw token", () => {
    const links = guardianLinks("RAWTOKEN");
    expect(links.itinerary).toMatch(/\/t\/RAWTOKEN\/itinerary$/);
    expect(links.signup).toMatch(/\/t\/RAWTOKEN\/signup$/);
    expect(links.absence).toMatch(/\/t\/RAWTOKEN\/absence$/);
    expect(links.unsubscribe).toMatch(/\/t\/RAWTOKEN\/unsubscribe$/);
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
