import { zonedDateKey } from "@/lib/datetime";

// Season naming (spec 005 US3). A season in this domain is a school year, written
// the way directors say it: "2026-27". Which one they mean depends only on when
// they are standing — from August the new school year has begun; before that
// they are still in the one that started last calendar year. So the first-season
// card can pre-fill the field and a new director just presses the button.
//
// Pure functions, resolved on the PROGRAM's calendar rather than the server's
// (Constitution VII), so they are unit-tested directly.

// The month (1–12) a school year turns over. August: auditions and camp are the
// front of the season everywhere this product runs.
const SCHOOL_YEAR_START_MONTH = 8;

// "2026" → "2026-27". Two-digit second year, padded so a century rollover reads
// "2099-00" rather than "2099-0".
export function seasonLabelForStartYear(startYear: number): string {
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

// The season a director standing at `now` in `timeZone` almost certainly means.
export function defaultSeasonLabel(now: Date, timeZone: string): string {
  const key = zonedDateKey(now, timeZone); // YYYY-MM-DD on the program's calendar
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const startYear = month >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
  return seasonLabelForStartYear(startYear);
}

// ---------------------------------------------------------------------------
// Season rollover — where you are in it (spec 005 Wave 13 / T165)
// ---------------------------------------------------------------------------
// The wizard had six screens whose headings numbered themselves "Step 1" …
// "Step 6" in hard-coded strings, and no progress affordance at all — so the
// numbers were the only claim about the shape of the flow, and they were wrong
// twice over. "Step 6" was not a step: it is the finish screen, and archiving
// the old season (what it talks about) is optional and happens in the table
// below it. And a program with nothing to roll FROM skips straight from screen
// one to activation, which the numbering never admitted: it said "Step 5 of"
// nothing, right after "Step 1".
//
// So the sequence is derived from the same fact the action branches on — is
// there a prior season to carry anything across from — and rendered as one
// indicator. Pure, so the arithmetic is unit-tested rather than eyeballed.

export const ROLLOVER_STEPS = [
  "new",
  "ensembles",
  "students",
  "costumes",
  "activate",
] as const;
export type RolloverStep = (typeof ROLLOVER_STEPS)[number];

// Every screen the wizard can be on. "done" is the finish, not a step.
export type RolloverScreen = RolloverStep | "done";

export function isRolloverScreen(value: string): value is RolloverScreen {
  return value === "done" || (ROLLOVER_STEPS as readonly string[]).includes(value);
}

// What each step is called, in the words a director would use out loud.
export const ROLLOVER_STEP_LABELS: Record<RolloverStep, string> = {
  new: "Name the new season",
  ensembles: "Check your groups",
  students: "Say who's coming back",
  costumes: "Bring costume sets across",
  activate: "Switch the app over",
};

// The steps this program actually walks. With no prior season there is nobody to
// carry back, no set names to copy and no groups to confirm, so
// createRolloverSeason sends the director straight to activation — and the
// indicator has to say two, not five, or it counts screens that never appear.
export function rolloverStepKeys(
  hasPriorSeason: boolean,
): readonly RolloverStep[] {
  return hasPriorSeason ? ROLLOVER_STEPS : (["new", "activate"] as const);
}

export type RolloverStepState = "done" | "now" | "todo";

export interface RolloverStepView {
  key: RolloverStep;
  label: string;
  state: RolloverStepState;
}

export interface RolloverProgress {
  // 1-based position of the current step, or null on the finish screen.
  position: number | null;
  total: number;
  steps: RolloverStepView[];
  finished: boolean;
}

export function rolloverProgress(
  screen: RolloverScreen,
  hasPriorSeason: boolean,
): RolloverProgress {
  const keys = rolloverStepKeys(hasPriorSeason);
  const finished = screen === "done";
  const at = finished ? keys.length : keys.indexOf(screen as RolloverStep);
  return {
    position: finished ? null : at + 1,
    total: keys.length,
    finished,
    steps: keys.map((key, i) => ({
      key,
      label: ROLLOVER_STEP_LABELS[key],
      state: i < at ? "done" : i === at ? "now" : "todo",
    })),
  };
}
