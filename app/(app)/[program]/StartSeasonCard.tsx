import Link from "next/link";
import type { Role } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import type { ReturnSurface } from "@/lib/return-path";
import { createClient } from "@/lib/supabase/server";
import { defaultSeasonLabel } from "@/lib/seasons";
import { startFirstSeason } from "./settings/rollover/actions";

// "Start your season" (spec 005 US3) — what a program with no active season sees,
// in place of the alert that used to send a brand-new director into a six-step
// ROLLOVER wizard. Three shapes, decided by data and seat:
//   • no seasons yet + a settings seat → one field, one submit, done.
//   • no seasons yet + any other seat  → who to ask.
//   • seasons exist but none is active → Settings, because WHICH one should be
//     active is a human decision this card has no business guessing.
//
// Every season-scoped surface renders THIS, not its own sentence (T143g). Money,
// Commitments, Assignments and one ensemble's page each used to write their own
// "No active season — Start a season" pointing at /settings/rollover, which is
// SETTINGS_ROLES-only: a treasurer, a costume manager or a board member who
// followed it was turned away by <Restricted>. The seat check that stops that
// already lives here, so `context` is the only thing a surface still owns — the
// one clause that says why THIS page is empty.
//
// Server component. It runs its own head-count so the pages that render it stay
// one line each, and it is only rendered when there is no active season.

const SEASON_ERROR: Record<string, string> = {
  label: "Give the season a name, like 2026-27.",
  exists:
    "This program already has a season — choose the active one in Settings.",
  create: "Couldn't start the season. Try again.",
  activate:
    "The season was created but couldn't be made active. Finish it in Settings.",
};

// The code rides in the URL, so the lookup has to be a lookup and not a walk up
// Object.prototype — ?seasonError=constructor would otherwise hand React a
// function to render. Anything unrecognized gets the generic message.
function seasonErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(SEASON_ERROR, code)
    ? SEASON_ERROR[code]
    : SEASON_ERROR.create;
}

export async function StartSeasonCard({
  slug,
  programId,
  role,
  timezone,
  from,
  error,
  context,
}: {
  slug: string;
  programId: string;
  role: Role;
  timezone: string;
  // Which surface to return to — an allow-listed key the action resolves to a
  // path server-side, never a URL from the browser (lib/return-path).
  from: ReturnSurface;
  error?: string | null;
  // One clause naming why this particular page is empty, e.g. "Ledger entries
  // are season-scoped." Rendered ahead of the pointer in every shape.
  context?: string;
}) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("seasons")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const seasonCount = count ?? 0;
  const message = seasonErrorMessage(error);

  // Seasons exist, just none active — a real choice, made in Settings. This is
  // also where a failed submit lands when the season got created but not
  // activated, so the message renders here too rather than nowhere.
  //
  // Settings is director/admin only, so a treasurer or a board member reading
  // Today was told to go and do something her seat cannot do, on a link that
  // turns her away when she follows it (spec 005 T160). Same fact, addressed to
  // the person actually reading it — which is what the no-seasons branch below
  // has always done.
  if (seasonCount > 0) {
    const canChoose = SETTINGS_ROLES.includes(role);
    return (
      <>
        {message && <p className="alert-error">{message}</p>}
        <p className="alert-error">
          No active season yet. {context ? `${context} ` : ""}
          {canChoose ? (
            <>
              <Link href={`/${slug}/settings/rollover`}>
                Choose which season is active
              </Link>{" "}
              in Settings.
            </>
          ) : (
            "Your director picks which season is the active one."
          )}
        </p>
      </>
    );
  }

  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <div className="confirm-box stack" style={{ width: "100%" }}>
        <h2>No season yet</h2>
        {context && <p className="muted">{context}</p>}
        <p className="muted">
          Your director needs to start the season. Until then there is no season
          for the roster, the calendar or the money to hang on.
        </p>
      </div>
    );
  }

  return (
    <div className="confirm-box stack" style={{ width: "100%" }}>
      <h2>Start your season</h2>
      {message && <p className="alert-error">{message}</p>}
      {context && <p className="muted">{context}</p>}
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
