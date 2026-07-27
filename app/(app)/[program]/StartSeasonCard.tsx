import Link from "next/link";
import type { Role } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { defaultSeasonLabel } from "@/lib/seasons";
import { startFirstSeason } from "./settings/rollover/actions";

// "Start your season" (spec 005 US3) — what a program with no active season sees
// on Season and on Today, in place of the alert that used to send a brand-new
// director into a six-step ROLLOVER wizard. Three shapes, decided by data and
// seat:
//   • no seasons yet + a settings seat → one field, one submit, done.
//   • no seasons yet + any other seat  → who to ask.
//   • seasons exist but none is active → Settings, because WHICH one should be
//     active is a human decision this card has no business guessing.
// Server component. It runs its own head-count so the two pages that render it
// stay one line each, and it is only rendered when there is no active season.

const SEASON_ERROR: Record<string, string> = {
  label: "Give the season a name, like 2026-27.",
  exists:
    "This program already has a season — choose the active one in Settings.",
  create: "Couldn't start the season. Try again.",
  activate:
    "The season was created but couldn't be made active. Finish it in Settings.",
};

export async function StartSeasonCard({
  slug,
  programId,
  role,
  timezone,
  from,
  error,
}: {
  slug: string;
  programId: string;
  role: Role;
  timezone: string;
  // Which surface to return to — an allow-listed key the action resolves to a
  // path server-side, never a URL from the browser.
  from: "season" | "dashboard";
  error?: string | null;
}) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("seasons")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const seasonCount = count ?? 0;

  // Seasons exist, just none active — a real choice, made in Settings.
  if (seasonCount > 0) {
    return (
      <p className="alert-error">
        No active season yet.{" "}
        <Link href={`/${slug}/settings/rollover`}>
          Choose which season is active
        </Link>{" "}
        in Settings.
      </p>
    );
  }

  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <div className="confirm-box stack" style={{ width: "100%" }}>
        <h2>No season yet</h2>
        <p className="muted">
          Your director needs to start the season. Until then there is no
          calendar to put competitions, events, or trips on.
        </p>
      </div>
    );
  }

  return (
    <div className="confirm-box stack" style={{ width: "100%" }}>
      <h2>Start your season</h2>
      {error && (
        <p className="alert-error">{SEASON_ERROR[error] ?? SEASON_ERROR.create}</p>
      )}
      <p className="muted">
        A season is the school year everything hangs on — your roster, the
        calendar, the money. Name it and you are going.
      </p>
      <form action={startFirstSeason} className="stack">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="from" value={from} />
        <label>
          Season name
          <input
            type="text"
            name="label"
            required
            defaultValue={defaultSeasonLabel(new Date(), timezone)}
          />
        </label>
        {/* Dates are useful later (they bound reports and the archive) and
            nobody knows them on day one, so they stay folded away. */}
        <details className="stack">
          <summary className="muted">Set season dates</summary>
          <div className="row-inline">
            <label>
              Starts on
              <input type="date" name="starts_on" />
            </label>
            <label>
              Ends on
              <input type="date" name="ends_on" />
            </label>
          </div>
          <p className="muted">Optional — you can fill these in any time.</p>
        </details>
        <button type="submit">Start season</button>
      </form>
      <p className="muted">
        Coming from a previous year?{" "}
        <Link href={`/${slug}/settings/rollover`}>
          Roll over from last season
        </Link>{" "}
        instead — that brings your students and costume set names with it.
      </p>
    </div>
  );
}
