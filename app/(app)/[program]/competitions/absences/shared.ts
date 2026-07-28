import type { FlashMap } from "@/lib/flash";

// The absence queue's URL contract (spec 005 Wave 10 / T157). One section — the
// queue is a single list with a banner above it — but it goes through lib/flash
// like every other surface, so `?ok=constructor` resolves to nothing rather than
// walking up Object.prototype, and a duplicated `?ok=a&ok=b` reads as absent.
//
// It replaces `?done=confirmed|dismissed` plus a separate `?error=`, each with
// its own render branch. The wording is unchanged on purpose: "Absence
// confirmed" is what a director has read here since the queue shipped.

export type AbsenceSection = "queue";

export type AbsenceOkKey = "confirmed" | "dismissed";
export type AbsenceErrorKey = "failed" | "gone";

const ABSENCE_OK: FlashMap<AbsenceOkKey, AbsenceSection> = {
  confirmed: {
    section: "queue",
    message: "Absence confirmed — attendance marked absent.",
  },
  dismissed: { section: "queue", message: "Request dismissed." },
};

const ABSENCE_ERROR: FlashMap<AbsenceErrorKey, AbsenceSection> = {
  failed: {
    section: "queue",
    message:
      "Something went wrong resolving that request — it was not updated. Try again.",
  },
  gone: { section: "queue", message: "That request was already resolved." },
};

// An unrecognized `?error=` still says something out loud: this queue is the
// only path a parent's report takes into attendance, and a silent failure means
// a family is told nothing while staff believe it was handled.
export const ABSENCE_FLASH_MAPS = {
  ok: ABSENCE_OK,
  error: ABSENCE_ERROR,
  fallbackSection: "queue" as const,
};
