import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { SETTINGS_ROLES } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { readFlash, oneParam } from "@/lib/flash";
import {
  isRolloverScreen,
  rolloverProgress,
  ROLLOVER_STEP_LABELS,
  type RolloverScreen,
} from "@/lib/seasons";
import { SubTabs } from "../../SubTabs";
import { settingsTabs } from "@/lib/subnav";
import { Flash } from "../../Flash";
import { RolloverSteps, rolloverStepCaption } from "./RolloverSteps";
import { StudentsStep } from "./StudentsStep";
import { CostumesStep } from "./CostumesStep";
import { SeasonsTable, type SeasonRow } from "./SeasonsTable";
import { ROLLOVER_ANCHOR, ROLLOVER_FLASH_MAPS, type RolloverSection } from "./shared";
import {
  createRolloverSeason,
  confirmEnsembles,
  activateNewSeason,
} from "./actions";

// Settings → Seasons (§3, §9.4, T028). director/admin. Two things live here:
// the rollover into next year, and the archive that freezes a past season
// read-only.
//
// Rollover-only since spec 005 US3 — starting a FIRST season is one submit on
// the Season/Today card — so nothing here special-cases "you have no seasons".
// What the flow does branch on is whether there is a season to roll FROM, which
// is a real difference a director can see, and since T165 the step indicator
// says so: with nothing to carry across the flow really is two steps, and it now
// counts two rather than numbering its screens 1 and 5.

export default async function RolloverPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?error=a&error=b), so this
  // is typed as what it really is and every read goes through `one()`.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);
  const isDirector = role === "director";
  const tz = program.timezone;

  const stepParam = one("step") ?? "";
  const screen: RolloverScreen = isRolloverScreen(stepParam) ? stepParam : "new";
  const newSeasonId = one("newSeason") ?? "";
  const flash = readFlash<RolloverSection>(sp, ROLLOVER_FLASH_MAPS);

  const supabase = await createClient();

  // All seasons (for the archive table + the wizard's summaries).
  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, label, starts_on, ends_on, is_active, archived_at")
    .eq("program_id", program.id)
    .order("starts_on", { ascending: false, nullsFirst: false })
    .order("label", { ascending: false });
  const seasons = (seasonRows as SeasonRow[] | null) ?? [];
  const newSeason = seasons.find((s) => s.id === newSeasonId) ?? null;

  // Is there anything to carry ACROSS? Counted the same way createRolloverSeason
  // counts it — every season that isn't the one being made — so the indicator
  // promises the path the action will actually take. (Reading the ACTIVE season
  // instead would disagree with it for a program whose only prior season is
  // inactive.)
  const hasPrior = seasons.some((s) => s.id !== newSeasonId);
  const progress = rolloverProgress(screen, hasPrior);

  // Data needed only by the interactive steps.
  const ensembles =
    screen === "ensembles" || screen === "students"
      ? ((
          await supabase
            .from("ensembles")
            .select("id, name, sort_order")
            .eq("program_id", program.id)
            .order("sort_order", { ascending: true })
        ).data as { id: string; name: string; sort_order: number }[] | null) ?? []
      : [];

  const title = progress.finished
    ? "You're rolled over"
    : ROLLOVER_STEP_LABELS[progress.steps[progress.position! - 1].key];

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Settings</p>
          <h1 className="page-h1">Seasons</h1>
        </div>
      </div>

      <SubTabs strip={settingsTabs(slug, "seasons")} />
      <p className="muted">
        Every summer you start the year again: name the new season, say who is
        coming back, and switch the app over. Nothing from the old year is
        deleted — you archive it at the end and it stays readable forever.
      </p>

      {/* --------------------------- The rollover --------------------------- */}
      <section id={ROLLOVER_ANCHOR.wizard} className="panel stack">
        <div className="travel-section-head">
          <h2>{title}</h2>
          <span className="travel-section-summary">
            {rolloverStepCaption(progress)}
          </span>
        </div>
        <RolloverSteps progress={progress} />
        <Flash flash={flash} section="wizard" />

        {season && !progress.finished && (
          <p className="muted">
            Rolling over from <strong>{season.label}</strong>. Your groups come
            along on their own; you choose who is returning, copy your costume set
            names, then switch the app to the new season.
          </p>
        )}

        {screen === "new" && (
          <form action={createRolloverSeason} className="stack settings-form">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <p className="muted">
              Name it the way you say it out loud — most programs write a school
              year, like 2027-28. Dates are optional and you can fill them in
              later. Making it does not switch anything over: your current season
              keeps running until the last step.
            </p>
            <label>
              Season name
              <input type="text" name="label" placeholder="2027-28" required />
            </label>
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
            <button type="submit">Create it and keep going</button>
          </form>
        )}

        {screen === "ensembles" && (
          <form action={confirmEnsembles} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="newSeasonId" value={newSeasonId} />
            <p className="muted">
              Your groups belong to the program, not to one year, so they come
              across on their own — there is nothing to do here but check the
              list. The new season will use these:
            </p>
            <ul>
              {ensembles.map((e) => (
                <li key={e.id}>{e.name}</li>
              ))}
              {ensembles.length === 0 && (
                <li className="muted">
                  No groups yet — you can add them any time from People →
                  Ensembles.
                </li>
              )}
            </ul>
            <button type="submit">Looks right, keep going</button>
          </form>
        )}

        {screen === "students" && (
          <StudentsStep
            slug={slug}
            programId={program.id}
            newSeasonId={newSeasonId}
            fromSeasonId={season?.id ?? null}
            ensembles={ensembles}
            supabase={supabase}
          />
        )}

        {screen === "costumes" && (
          <CostumesStep
            slug={slug}
            programId={program.id}
            newSeasonId={newSeasonId}
            fromSeasonId={season?.id ?? null}
            supabase={supabase}
          />
        )}

        {screen === "activate" && (
          <form action={activateNewSeason} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="newSeasonId" value={newSeasonId} />
            <p className="muted">
              From here on every page shows{" "}
              <strong>{newSeason?.label ?? "the new season"}</strong>
              {season ? (
                <>
                  {" "}
                  instead of <strong>{season.label}</strong>. Nothing in{" "}
                  {season.label} is deleted or changed — it stops being the
                  season the app is working in, and you can archive it next.
                </>
              ) : (
                "."
              )}
            </p>
            <button type="submit">Switch to {newSeason?.label ?? "it"}</button>
          </form>
        )}

        {progress.finished && (
          <div className="stack">
            <p className="alert-ok">
              {newSeason?.label ?? "Your new season"} is now your active season.
            </p>
            <p className="muted">
              One optional last thing: archive the season you just left, in the
              list below. That freezes it read-only — its roster, results and PDFs
              stay browsable in History and in your export, but nothing in it can
              be changed by accident. You can do it now or any time later.
            </p>
            <Link href={`/${slug}/dashboard`}>Go to the dashboard</Link>
          </div>
        )}

        {screen !== "new" && !progress.finished && (
          <p className="muted">
            <Link href={`/${slug}/settings/rollover`}>
              Stop for now — nothing you have done so far is undone
            </Link>
          </p>
        )}
      </section>

      {/* --------------------------- All seasons --------------------------- */}
      <SeasonsTable
        programId={program.id}
        slug={slug}
        tz={tz}
        flash={flash}
        seasons={seasons}
        isDirector={isDirector}
      />
    </section>
  );
}
