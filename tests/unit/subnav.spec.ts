// ============================================================================
// Unit tests — the one sub-tab strip (spec 005 Wave 8 / T142).
// ----------------------------------------------------------------------------
// Six components collapsed into one renderer plus these builders. A refactor
// that "looks the same" is not the same, so every strip's exact items — order,
// label, href — are pinned here against what the deleted components produced,
// and so is each one's gating: a shared component must not widen or narrow what
// any seat sees.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  rosterTabs,
  treasuryTabs,
  costumeTabs,
  commsTabs,
  settingsTabs,
  competitionTabs,
  eventViewTabs,
  type SubTabStrip,
} from "@/lib/subnav";

const SLUG = "demo";
const COMP = "c-1";

// What a reader actually gets: the label and where it goes, in order.
function shape(strip: SubTabStrip): [string, string][] {
  return strip.items.map((i) => [i.label, i.href]);
}

describe("People (was RosterTabs)", () => {
  test("a writer sees all four tabs", () => {
    expect(shape(rosterTabs(SLUG, "directory", true))).toEqual([
      ["Directory", "/demo/roster"],
      ["Ensembles", "/demo/roster/ensembles"],
      ["Import", "/demo/roster/import"],
      ["Size fields", "/demo/roster/settings"],
    ]);
  });

  test("a reader is not offered the two director/admin surfaces", () => {
    expect(shape(rosterTabs(SLUG, "directory", false))).toEqual([
      ["Directory", "/demo/roster"],
      ["Ensembles", "/demo/roster/ensembles"],
    ]);
  });

  test("the active key highlights exactly one tab", () => {
    const strip = rosterTabs(SLUG, "ensembles", true);
    expect(strip.items.filter((i) => i.key === strip.active)).toHaveLength(1);
  });
});

describe("Money (was TreasuryTabs)", () => {
  test("four tabs, read-visible to every money seat", () => {
    expect(shape(treasuryTabs(SLUG, "ledger"))).toEqual([
      ["Ledger", "/demo/treasury"],
      ["Budget", "/demo/treasury/budget"],
      ["Budget vs Actual", "/demo/treasury/budget-vs-actual"],
      ["Reports", "/demo/treasury/reports"],
    ]);
  });
});

describe("Wardrobe (was CostumeTabs)", () => {
  test("four jobs in the order the job happens; Alterations is the landing", () => {
    expect(shape(costumeTabs(SLUG, "alterations"))).toEqual([
      ["Inventory", "/demo/costumes/inventory"],
      ["Assignments", "/demo/costumes/assignments"],
      ["Alterations", "/demo/costumes"],
      ["Checkout", "/demo/costumes/checkout"],
    ]);
  });
});

describe("Comms (was CommsTabs)", () => {
  const on = {
    digestEnabled: true,
    announcementsEnabled: true,
    shiftsEnabled: true,
  };

  test("every flag on: Digest · Announcements · Shifts", () => {
    expect(shape(commsTabs(SLUG, "digest", on))).toEqual([
      ["Digest", "/demo/comms"],
      ["Announcements", "/demo/comms/announcements"],
      ["Shifts", "/demo/comms/shifts"],
    ]);
  });

  test("digest off: the landing reads Overview, and still goes to /comms", () => {
    // The page stays reachable as a soft-gated overview, so the tab renames
    // rather than disappearing — it must not advertise a digest the program
    // can't draft.
    const strip = commsTabs(SLUG, "digest", { ...on, digestEnabled: false });
    expect(strip.items[0]).toEqual({
      key: "digest",
      label: "Overview",
      href: "/demo/comms",
    });
  });

  test("a flagged-off tab is absent, never a link that 404s", () => {
    const strip = commsTabs(SLUG, "digest", {
      ...on,
      announcementsEnabled: false,
      shiftsEnabled: false,
    });
    expect(shape(strip)).toEqual([["Digest", "/demo/comms"]]);
  });
});

describe("Settings (was SettingsTabs)", () => {
  test("Seasons points at the rollover page", () => {
    expect(shape(settingsTabs(SLUG, "program"))).toEqual([
      ["Program", "/demo/settings"],
      ["Members", "/demo/settings/members"],
      ["Seasons", "/demo/settings/rollover"],
      ["Export & Data", "/demo/settings/export"],
    ]);
  });
});

describe("Competition children (was CompetitionTabs)", () => {
  test("leads with the way back to the hub, then the four editing routes", () => {
    const strip = competitionTabs(SLUG, COMP, "packet");
    expect(strip.back).toEqual({
      href: "/demo/competitions/c-1",
      label: "← Comp week",
    });
    expect(shape(strip)).toEqual([
      ["Attendance", "/demo/competitions/c-1/attendance"],
      ["Itinerary", "/demo/competitions/c-1/itinerary"],
      ["Meals", "/demo/competitions/c-1/meals"],
      ["Packet", "/demo/competitions/c-1/packet"],
    ]);
  });

  test("the back link is not a tab — it never highlights", () => {
    const strip = competitionTabs(SLUG, COMP, "packet");
    expect(strip.items.some((i) => i.href === strip.back?.href)).toBe(false);
  });
});

// The events calendar's Month/Week switch (spec 005 Wave 11 / T159) was the
// last strip in the app still built by hand, out of `.settings-tabs` — the
// pre-redesign class this module exists to have removed. Two views of one
// route, so what has to hold is that the ref rides along: switching shape must
// keep the month you were looking at, not snap you back to today.
describe("Events calendar (was the last hand-rolled strip)", () => {
  test("both views, each keeping the reference date", () => {
    expect(shape(eventViewTabs(SLUG, "month", "2026-03-07"))).toEqual([
      ["Month", "/demo/events?view=month&ref=2026-03-07"],
      ["Week", "/demo/events?view=week&ref=2026-03-07"],
    ]);
  });

  test("the active view is the one highlighted", () => {
    const strip = eventViewTabs(SLUG, "week", "2026-03-07");
    expect(strip.active).toBe("week");
    expect(strip.items.filter((i) => i.key === strip.active)).toHaveLength(1);
  });
});

describe("every strip is well-formed", () => {
  const strips: [string, SubTabStrip][] = [
    ["roster", rosterTabs(SLUG, "import", true)],
    ["treasury", treasuryTabs(SLUG, "budget")],
    ["costumes", costumeTabs(SLUG, "checkout")],
    [
      "comms",
      commsTabs(SLUG, "shifts", {
        digestEnabled: true,
        announcementsEnabled: true,
        shiftsEnabled: true,
      }),
    ],
    ["settings", settingsTabs(SLUG, "export")],
    ["competition", competitionTabs(SLUG, COMP, "meals")],
    ["events", eventViewTabs(SLUG, "week", "2026-03-07")],
  ];

  test("keys are unique and the active key is one of them", () => {
    for (const [name, strip] of strips) {
      const keys = strip.items.map((i) => i.key);
      expect(new Set(keys).size, name).toBe(keys.length);
      expect(keys, name).toContain(strip.active);
    }
  });

  test("every href is a program-scoped in-app path", () => {
    for (const [name, strip] of strips) {
      for (const item of strip.items) {
        expect(item.href.startsWith(`/${SLUG}/`), `${name}:${item.key}`).toBe(
          true,
        );
      }
    }
  });
});
