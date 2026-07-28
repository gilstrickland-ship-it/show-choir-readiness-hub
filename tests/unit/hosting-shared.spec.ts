// ============================================================================
// Unit tests — the host command center's URL contract (spec 005 Wave 7 / US11)
// ----------------------------------------------------------------------------
// The event page used to declare EIGHT search params that existed only to print
// a toast (`saved`, `created`, `school_saved`, `school_removed`, `slot_saved`,
// `slot_removed`, `generated`, `shifted`, plus `dir` decorating the last one).
// They collapse into one `?ok=` and one `?error=`, resolved through the two
// lookups pinned here. They are the boundary between a hand-typed (or hostile)
// URL and what the page renders, so: an unrecognized code must render nothing, a
// prototype key must not resolve to a function, and every key must name the
// section that will show it — because that same answer is what the actions use
// to pick the anchor they scroll to.
//
// Pure functions only; no DB, no network (runs under vitest.unit.config.ts).
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  hostOk,
  hostError,
  hostOkSection,
  hostErrorSection,
  HOST_ANCHOR,
  type HostOkKey,
  type HostErrorKey,
} from "@/app/(app)/[program]/hosting/[eventId]/shared";

// Every key an action may put on the URL, spelled out so a key added to the map
// without a home section — or removed while an action still emits it — fails
// here rather than rendering a blank message in production.
const OK_KEYS: HostOkKey[] = [
  "created",
  "saved",
  "school_saved",
  "school_removed",
  "slot_saved",
  "slot_removed",
  "generated",
  "shifted_later",
  "shifted_earlier",
];

const ERROR_KEYS: HostErrorKey[] = [
  "archived",
  "name",
  "enddate",
  "save",
  "school_name",
  "school_missing",
  "school_save",
  "school",
  "slot_missing",
  "start",
  "noschools",
  "delta",
  "slot_save",
];

const PROTOTYPE_KEYS = [
  "constructor",
  "toString",
  "hasOwnProperty",
  "__proto__",
  "valueOf",
];

describe("hostOk", () => {
  test("resolves the eight collapsed toasts to a section and a message", () => {
    expect(hostOk("created")).toEqual({
      section: "overview",
      message: "Invitational created.",
    });
    expect(hostOk("saved")?.section).toBe("overview");
    expect(hostOk("school_saved")?.section).toBe("schools");
    expect(hostOk("school_removed")?.section).toBe("schools");
    expect(hostOk("slot_saved")?.section).toBe("schedule");
    expect(hostOk("slot_removed")?.section).toBe("schedule");
    expect(hostOk("generated")?.section).toBe("schedule");
  });

  test("the shift's direction rides in the key, replacing ?shifted=&dir=", () => {
    // The size of the shift is no longer a param: the new times render a line
    // below the message. The direction is what confirms the sign that was typed.
    expect(hostOk("shifted_later")?.message).toContain("later");
    expect(hostOk("shifted_earlier")?.message).toContain("earlier");
    expect(hostOk("shifted_later")?.section).toBe("schedule");
    expect(hostOk("shifted_earlier")?.section).toBe("schedule");
    // The old params resolve to nothing at all.
    expect(hostOk("shifted")).toBeNull();
    expect(hostOk("dir")).toBeNull();
  });

  test("every key carries a non-empty message", () => {
    for (const key of OK_KEYS) {
      expect(hostOk(key)?.message ?? "").not.toBe("");
    }
  });

  test("returns null for an absent or unrecognized code", () => {
    expect(hostOk(null)).toBeNull();
    expect(hostOk("")).toBeNull();
    expect(hostOk("not_a_code")).toBeNull();
    // The pre-Wave-7 params are gone, not aliased.
    expect(hostOk("school_removed=1")).toBeNull();
  });

  test("rejects Object.prototype keys rather than walking the prototype", () => {
    // ?ok=constructor would otherwise hand React a function to render.
    for (const key of PROTOTYPE_KEYS) expect(hostOk(key)).toBeNull();
  });
});

describe("hostError", () => {
  test("routes each failure to the section that owns what failed", () => {
    expect(hostError("name")?.section).toBe("overview");
    expect(hostError("enddate")?.section).toBe("overview");
    expect(hostError("archived")?.section).toBe("overview");
    expect(hostError("save")?.section).toBe("overview");
    expect(hostError("school_name")?.section).toBe("schools");
    expect(hostError("school_missing")?.section).toBe("schools");
    expect(hostError("school_save")?.section).toBe("schools");
    // Picking a school for a SLOT fails in the schedule, not in the school list.
    expect(hostError("school")?.section).toBe("schedule");
    expect(hostError("slot_missing")?.section).toBe("schedule");
    expect(hostError("start")?.section).toBe("schedule");
    expect(hostError("noschools")?.section).toBe("schedule");
    expect(hostError("delta")?.section).toBe("schedule");
    expect(hostError("slot_save")?.section).toBe("schedule");
  });

  test("every key carries a non-empty message", () => {
    for (const key of ERROR_KEYS) {
      expect(hostError(key)?.message ?? "").not.toBe("");
    }
  });

  test("returns null for an absent or unrecognized code", () => {
    expect(hostError(null)).toBeNull();
    expect(hostError("")).toBeNull();
    expect(hostError("not_a_code")).toBeNull();
  });

  test("rejects Object.prototype keys rather than walking the prototype", () => {
    for (const key of PROTOTYPE_KEYS) expect(hostError(key)).toBeNull();
  });
});

describe("the two halves of the contract agree", () => {
  // The actions ask the map which section a key belongs to when they build the
  // redirect; the page asks the same map when it renders. These must be the same
  // answer, or a message scrolls to one section and renders in another.
  test("hostOkSection matches what hostOk resolves", () => {
    for (const key of OK_KEYS) {
      expect(hostOkSection(key)).toBe(hostOk(key)?.section);
    }
  });

  test("hostErrorSection matches what hostError resolves", () => {
    for (const key of ERROR_KEYS) {
      expect(hostErrorSection(key)).toBe(hostError(key)?.section);
    }
  });

  test("every section a key names has a page anchor", () => {
    const sections = [
      ...OK_KEYS.map(hostOkSection),
      ...ERROR_KEYS.map(hostErrorSection),
    ];
    for (const section of sections) {
      expect(HOST_ANCHOR[section]).toBeTruthy();
    }
    // All three anchors are reachable — no section is defined and never used.
    expect(new Set(sections)).toEqual(
      new Set(["overview", "schools", "schedule"]),
    );
  });
});
