import type { FlashMap } from "@/lib/flash";

// /launch's URL contract (spec 005 Wave 13 / T165), in the app's one flash idiom.
//
// This is not cosmetic. The page held its messages in a bare object and read
// them as `ERRORS[error]` with `error` taken straight off the query string — so
// `/launch?error=constructor` resolved to `Object.prototype.constructor`, a
// FUNCTION, which the truthiness check waved through and React was then asked to
// render. lib/flash's lookup goes through `Object.hasOwn` and its `oneParam`
// treats a duplicated `?error=a&error=b` (which arrives as an ARRAY) as absent,
// so both shapes resolve to "no message" instead of a crash.
//
// One section: /launch is a single screen, whichever of its four states it is in.

export type LaunchSection = "page";
export type LaunchErrorKey = "missing" | "create";

const LAUNCH_ERROR: FlashMap<LaunchErrorKey, LaunchSection> = {
  missing: { section: "page", message: "A program needs a name and a time zone." },
  create: {
    section: "page",
    message: "We couldn't create that program. Please try again.",
  },
};

export const LAUNCH_FLASH_MAPS = { error: LAUNCH_ERROR };
