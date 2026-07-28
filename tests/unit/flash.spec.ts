// ============================================================================
// Unit tests — the shared after-a-write message contract (spec 005 Wave 8 /
// T142) and the two surfaces that adopted it in this wave.
// ----------------------------------------------------------------------------
// This is the boundary between a hand-typed (or hostile) URL and what a page
// renders, so it is tested as a boundary: an unrecognized code renders nothing
// (or, where a silent failure would be worse, says so out loud), a prototype key
// never resolves to a function, and an array-typed param never 500s the page.
//
// The host center's own contract is pinned separately in hosting-shared.spec.ts
// — it kept its public functions, so that spec is also the proof that moving
// their bodies onto these helpers changed nothing.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  oneParam,
  flashFrom,
  flashSection,
  readFlash,
  type FlashMap,
} from "@/lib/flash";
import {
  SHIFT_FLASH_MAPS,
  shiftErrorSection,
  isRowShiftError,
  shiftAnchor,
  type ShiftErrorKey,
  type ShiftOkKey,
} from "@/app/(app)/[program]/comms/shifts/shared";
import {
  LEDGER_FLASH_MAPS,
  ledgerErrorSection,
  isRowLedgerError,
  entryAnchor,
  type LedgerErrorKey,
} from "@/app/(app)/[program]/treasury/flash";
import {
  EVENTS_FLASH_MAPS,
  EVENT_FLASH_MAPS,
  type EventsOkKey,
  type EventsErrorKey,
  type EventErrorKey,
} from "@/app/(app)/[program]/events/shared";

const PROTOTYPE_KEYS = [
  "constructor",
  "toString",
  "hasOwnProperty",
  "__proto__",
  "valueOf",
];

type Section = "top" | "bottom";
const MAP: FlashMap<"a" | "b", Section> = {
  a: { section: "top", message: "A happened." },
  b: { section: "bottom", message: "B happened." },
};

describe("oneParam", () => {
  test("returns a single string value", () => {
    expect(oneParam({ ok: "a" }, "ok")).toBe("a");
  });

  test("an absent param is null", () => {
    expect(oneParam({}, "ok")).toBeNull();
  });

  test("a DUPLICATED param reads as absent, not as a joined string", () => {
    // Next hands back an array for ?ok=a&ok=b. Coercing it would look up
    // "a,b" — harmless — but the same value reaches code that indexes objects
    // and slices ids, so it is refused at the door instead.
    expect(oneParam({ ok: ["a", "b"] }, "ok")).toBeNull();
  });
});

describe("flashFrom", () => {
  test("resolves a known code to its section and message", () => {
    expect(flashFrom(MAP, "a")).toEqual({ section: "top", message: "A happened." });
  });

  test("null for absent, empty, or unrecognized codes", () => {
    expect(flashFrom(MAP, null)).toBeNull();
    expect(flashFrom(MAP, "")).toBeNull();
    expect(flashFrom(MAP, "nope")).toBeNull();
  });

  test("rejects Object.prototype keys rather than walking the prototype", () => {
    for (const key of PROTOTYPE_KEYS) expect(flashFrom(MAP, key)).toBeNull();
  });
});

describe("flashSection", () => {
  test("is the same answer the reader gets", () => {
    expect(flashSection(MAP, "a")).toBe(flashFrom(MAP, "a")?.section);
    expect(flashSection(MAP, "b")).toBe(flashFrom(MAP, "b")?.section);
  });
});

describe("readFlash", () => {
  test("reads ok and error independently — both can be present", () => {
    const flash = readFlash({ ok: "a", error: "b" }, { ok: MAP, error: MAP });
    expect(flash.ok?.message).toBe("A happened.");
    expect(flash.error?.message).toBe("B happened.");
  });

  test("without a fallback section, an unknown error renders nothing", () => {
    // The host center and the trip page: an unrecognized code is a URL someone
    // typed, not a failure that happened.
    const flash = readFlash({ error: "nope" }, { error: MAP });
    expect(flash.error).toBeNull();
  });

  test("with a fallback section, an unknown error still says something", () => {
    // Money and shifts: a stale or renamed code means a write really did fail.
    const flash = readFlash<Section>(
      { error: "nope" },
      { error: MAP, fallbackSection: "top" },
    );
    expect(flash.error).toEqual({
      section: "top",
      message: "Something went wrong.",
    });
  });

  test("the fallback fires only when a code was actually present", () => {
    const flash = readFlash<Section>({}, { error: MAP, fallbackSection: "top" });
    expect(flash.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const SHIFT_OK_KEYS: ShiftOkKey[] = [
  "created",
  "suggested",
  "saved",
  "deleted",
  "signed",
  "cancelled",
];

const SHIFT_ERROR_KEYS: ShiftErrorKey[] = [
  "title",
  "season",
  "save",
  "attach",
  "share",
  "row_title",
  "in_use",
  "name",
  "shift",
];

describe("shifts: five toast params collapse into one ?ok=", () => {
  test("every key resolves to a message in the page banner", () => {
    for (const key of SHIFT_OK_KEYS) {
      const entry = flashFrom(SHIFT_FLASH_MAPS.ok, key);
      expect(entry?.message ?? "", key).not.toBe("");
      expect(entry?.section, key).toBe("page");
    }
  });

  test("the values the old params carried are not keys", () => {
    // `?created=1`, `?saved=1`, `?signed=1` — the page read the PRESENCE of
    // five params. It now reads one `?ok=<key>`, so the old values resolve to
    // nothing and a stale bookmark prints no toast rather than the wrong one.
    for (const stale of ["1", "created=1", "3"]) {
      expect(flashFrom(SHIFT_FLASH_MAPS.ok, stale), stale).toBeNull();
    }
  });
});

describe("shifts: each error names the control that failed", () => {
  test("the create drawer owns its own refusals", () => {
    for (const key of ["title", "season", "save", "attach"] as ShiftErrorKey[]) {
      expect(shiftErrorSection(key), key).toBe("drawer");
      expect(isRowShiftError(key), key).toBe(false);
    }
  });

  test("a row's Edit panel and its add-a-name box are told apart", () => {
    expect(shiftErrorSection("row_title")).toBe("panel");
    expect(shiftErrorSection("in_use")).toBe("panel");
    // A failed signup must NOT spring the Edit panel open.
    expect(shiftErrorSection("name")).toBe("signup");
    expect(shiftErrorSection("shift")).toBe("signup");
    for (const key of ["row_title", "in_use", "name", "shift"] as ShiftErrorKey[]) {
      expect(isRowShiftError(key), key).toBe(true);
    }
  });

  test("the two title refusals say the same sentence from different homes", () => {
    // Same rule, two forms. They shared one code before, which is why the page
    // had to infer the home from whether `?edit=` was present.
    const drawer = flashFrom(SHIFT_FLASH_MAPS.error, "title");
    const panel = flashFrom(SHIFT_FLASH_MAPS.error, "row_title");
    expect(drawer?.message).toBe(panel?.message);
    expect(drawer?.section).not.toBe(panel?.section);
  });

  test("every key carries a non-empty message", () => {
    for (const key of SHIFT_ERROR_KEYS) {
      expect(flashFrom(SHIFT_FLASH_MAPS.error, key)?.message ?? "", key).not.toBe(
        "",
      );
    }
  });

  test("an unknown code still speaks, in the page banner", () => {
    const flash = readFlash({ error: "gone_stale" }, SHIFT_FLASH_MAPS);
    expect(flash.error).toEqual({
      section: "page",
      message: "Something went wrong.",
    });
  });

  test("the row anchor is the id the card renders", () => {
    expect(shiftAnchor("s-1")).toBe("shift-s-1");
  });
});

// ---------------------------------------------------------------------------

const LEDGER_ERROR_KEYS: LedgerErrorKey[] = [
  "entry",
  "entry_tag",
  "entry_season",
  "entry_line",
  "entry_competition",
  "entry_trip",
  "receipt_type",
  "receipt_upload",
  "reconcile",
  "void",
  "void_reason",
  "void_missing",
  "void_already",
  "void_archived",
  "categorize",
  "categorize_already",
  "categorize_voided",
  "categorize_missing",
  "categorize_archived",
  "categorize_line",
];

describe("the ledger's contract", () => {
  test("every key carries a non-empty message and a home", () => {
    for (const key of LEDGER_ERROR_KEYS) {
      const entry = flashFrom(LEDGER_FLASH_MAPS.error, key);
      expect(entry?.message ?? "", key).not.toBe("");
      expect(["page", "row"], key).toContain(entry?.section);
    }
  });

  test("what happens to an entry belongs to that entry's fix panel", () => {
    for (const key of LEDGER_ERROR_KEYS) {
      const rowOwned = key.startsWith("void") || key.startsWith("categorize");
      expect(isRowLedgerError(key), key).toBe(rowOwned);
      expect(ledgerErrorSection(key), key).toBe(rowOwned ? "row" : "page");
    }
  });

  test("a money failure is never silent", () => {
    // The one place the fallback matters most: a treasurer who sees nothing
    // assumes the write landed.
    const flash = readFlash({ error: "renamed_in_a_later_wave" }, LEDGER_FLASH_MAPS);
    expect(flash.error?.message).toBe("Something went wrong.");
    expect(flash.error?.section).toBe("page");
  });

  test("?ok=saved is the one success key, in the page banner", () => {
    expect(flashFrom(LEDGER_FLASH_MAPS.ok, "saved")).toEqual({
      section: "page",
      message: "Saved.",
    });
    expect(flashFrom(LEDGER_FLASH_MAPS.ok, "1")).toBeNull();
  });

  test("the row anchor is the id the fix panel renders", () => {
    expect(entryAnchor("e-1")).toBe("fix-e-1");
  });

  test("rejects Object.prototype keys on both maps", () => {
    for (const key of PROTOTYPE_KEYS) {
      expect(flashFrom(LEDGER_FLASH_MAPS.ok, key)).toBeNull();
      expect(flashFrom(LEDGER_FLASH_MAPS.error, key)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

const EVENTS_ERROR_KEYS: EventsErrorKey[] = [
  "title",
  "starts",
  "season",
  "dates",
  "ensemble",
  "save",
];

const EVENT_ERROR_KEYS: EventErrorKey[] = [
  "title",
  "dates",
  "ensemble",
  "save",
  "delete",
];

describe("the events surface's contract (spec 005 Wave 11)", () => {
  test("the calendar has one message area: the panel that does the writing", () => {
    for (const key of EVENTS_ERROR_KEYS) {
      const entry = flashFrom(EVENTS_FLASH_MAPS.error, key);
      expect(entry?.message ?? "", key).not.toBe("");
      expect(entry?.section, key).toBe("add");
    }
    for (const key of ["created", "created_repeat"] as EventsOkKey[]) {
      expect(flashFrom(EVENTS_FLASH_MAPS.ok, key)?.section, key).toBe("add");
    }
  });

  test("the old ?created=<count> values are not keys", () => {
    // The page used to read `?created=12` and print the number. The twelve new
    // events are on the calendar directly above the message, so the count went
    // with the param — and a stale bookmark now prints nothing rather than
    // "Added 12 event(s)" over a calendar with none.
    for (const stale of ["1", "12", "0"]) {
      expect(flashFrom(EVENTS_FLASH_MAPS.ok, stale), stale).toBeNull();
    }
  });

  test("one event's page tells a refused save from a refused delete", () => {
    for (const key of ["title", "dates", "ensemble", "save"] as EventErrorKey[]) {
      expect(flashFrom(EVENT_FLASH_MAPS.error, key)?.section, key).toBe(
        "details",
      );
    }
    // A delete that didn't happen must not spring the edit panel open — it
    // belongs to the box that asked for it.
    expect(flashFrom(EVENT_FLASH_MAPS.error, "delete")?.section).toBe("danger");
    expect(flashFrom(EVENT_FLASH_MAPS.ok, "saved")?.section).toBe("details");
  });

  test("every key on both pages carries a non-empty message", () => {
    for (const key of EVENT_ERROR_KEYS) {
      expect(flashFrom(EVENT_FLASH_MAPS.error, key)?.message ?? "", key).not.toBe(
        "",
      );
    }
  });

  test("an unrecognized code renders nothing on either page", () => {
    // No fallback section here, deliberately: unlike money, an events code that
    // no longer resolves is a URL someone typed, not a write that failed.
    expect(readFlash({ error: "nope" }, EVENTS_FLASH_MAPS).error).toBeNull();
    expect(readFlash({ error: "nope" }, EVENT_FLASH_MAPS).error).toBeNull();
  });

  test("a duplicated param never 500s and never resolves", () => {
    expect(readFlash({ ok: ["created", "save"] }, EVENTS_FLASH_MAPS).ok).toBeNull();
  });

  test("rejects Object.prototype keys on all four maps", () => {
    for (const key of PROTOTYPE_KEYS) {
      expect(flashFrom(EVENTS_FLASH_MAPS.ok, key)).toBeNull();
      expect(flashFrom(EVENTS_FLASH_MAPS.error, key)).toBeNull();
      expect(flashFrom(EVENT_FLASH_MAPS.ok, key)).toBeNull();
      expect(flashFrom(EVENT_FLASH_MAPS.error, key)).toBeNull();
    }
  });
});
