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
