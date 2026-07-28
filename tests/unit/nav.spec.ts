// ============================================================================
// Unit tests — navigation visibility + the mobile tab bar (spec 005 T141).
// ----------------------------------------------------------------------------
// The mobile bar used to name four slots outright and drop any the viewer
// couldn't see, WITHOUT backfilling: a treasurer saw "Today · Season · More"
// with Money — her entire job — inside the sheet. These specs pin the two halves
// of the fix: a director's bar is byte-identical to what it was, and every other
// seat's bar is the first four surfaces that seat can actually reach.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  NAV,
  isNavItemVisible,
  splitMobileNav,
  MOBILE_TAB_ORDER,
  MOBILE_TAB_COUNT,
} from "@/lib/nav";
import { flagRegistry, type FlagKey } from "@/lib/flags";
import type { Role } from "@/lib/auth";

const ROLES: Role[] = [
  "director",
  "admin",
  "treasurer",
  "costume_manager",
  "board_member",
];

// Every flag on — the widest surface any seat could have, so what differs
// between the bars below is ROLE and nothing else.
function allFlags(on = true): Record<FlagKey, boolean> {
  return Object.fromEntries(
    (Object.keys(flagRegistry) as FlagKey[]).map((k) => [k, on]),
  ) as Record<FlagKey, boolean>;
}

// What the layout hands MobileNav: NAV filtered once through isNavItemVisible.
function bar(
  role: Role,
  flags: Record<FlagKey, boolean> = allFlags(),
): { tabs: string[]; more: string[] } {
  const items = NAV.filter((i) => isNavItemVisible(i, role, flags)).map(
    ({ slot, label }) => ({ slot, label }),
  );
  const split = splitMobileNav(items);
  return {
    tabs: split.tabs.map((t) => t.label),
    more: split.more.map((m) => m.label),
  };
}

describe("the phone's order preference covers the whole nav", () => {
  test("every NAV slot is ranked", () => {
    // A slot missing here would rank last and silently fall off the bar — which
    // is exactly how Money ended up in a sheet for the seat that lives in it.
    for (const item of NAV) {
      expect(MOBILE_TAB_ORDER).toContain(item.slot);
    }
    expect(MOBILE_TAB_ORDER).toHaveLength(NAV.length);
  });
});

describe("a director's bar is unchanged by the backfill", () => {
  test("Today · Season · People · Wardrobe, with the rest in More", () => {
    // The four slots the old TAB_SLOTS constant hardcoded, in that order.
    expect(bar("director").tabs).toEqual([
      "Today",
      "Season",
      "People",
      "Wardrobe",
    ]);
    // The sheet keeps NAV order, not the phone's ranking.
    expect(bar("director").more).toEqual(["Money", "Comms", "Hosting"]);
  });

  test("admin gets the identical bar (same seat capabilities, §2)", () => {
    expect(bar("admin")).toEqual(bar("director"));
  });
});

describe("a treasurer gets Money as a real tab", () => {
  test("Money is promoted, not buried in More", () => {
    const { tabs, more } = bar("treasurer");
    expect(tabs).toContain("Money");
    expect(more).not.toContain("Money");
  });

  test("the bar is exactly the four surfaces a treasurer can reach", () => {
    // People and Wardrobe are not this seat's surfaces, so the two slots they
    // used to hold (and leave empty) go to Money and Comms.
    expect(bar("treasurer").tabs).toEqual([
      "Today",
      "Season",
      "Money",
      "Comms",
    ]);
    expect(bar("treasurer").more).toEqual([]);
  });
});

describe("the other seats", () => {
  test("costume manager: Wardrobe and Comms fill the freed slots", () => {
    expect(bar("costume_manager").tabs).toEqual([
      "Today",
      "Season",
      "Wardrobe",
      "Comms",
    ]);
    expect(bar("costume_manager").more).toEqual([]);
  });

  test("board member sees six surfaces, so two stay in the sheet", () => {
    // No backfill is owed here — the bar is full of items this seat can see.
    // Money and Hosting sit in More because four slots cannot hold six items.
    expect(bar("board_member").tabs).toEqual([
      "Today",
      "Season",
      "People",
      "Wardrobe",
    ]);
    expect(bar("board_member").more).toEqual(["Money", "Hosting"]);
  });
});

describe("the bar never outruns what the seat can see", () => {
  test("no tab or sheet entry is a surface the desktop nav hides", () => {
    for (const role of ROLES) {
      const visible = NAV.filter((i) => isNavItemVisible(i, role, allFlags()));
      const labels = new Set(visible.map((i) => i.label));
      const { tabs, more } = bar(role);
      for (const label of [...tabs, ...more]) {
        expect(labels.has(label)).toBe(true);
      }
      // Nothing is dropped either: tabs ∪ more is the whole visible list.
      expect(new Set([...tabs, ...more])).toEqual(labels);
    }
  });

  test("at most MOBILE_TAB_COUNT tabs, for every seat and flag state", () => {
    for (const role of ROLES) {
      expect(bar(role).tabs.length).toBeLessThanOrEqual(MOBILE_TAB_COUNT);
      expect(bar(role, allFlags(false)).tabs.length).toBeLessThanOrEqual(
        MOBILE_TAB_COUNT,
      );
    }
  });

  test("flags off shrink the bar rather than promoting a hidden surface", () => {
    // A prep-tier treasurer (treasury flag off) has no Money surface at all —
    // the bar must not invent a tab for it.
    const flags = { ...allFlags(), treasury: false };
    const { tabs, more } = bar("treasurer", flags);
    expect([...tabs, ...more]).not.toContain("Money");
    expect(tabs).toEqual(["Today", "Season", "Comms"]);
  });

  test("a seat with nothing but Today gets a one-tab bar, not a crash", () => {
    const flags = allFlags(false);
    expect(bar("treasurer", flags)).toEqual({ tabs: ["Today"], more: [] });
  });
});
