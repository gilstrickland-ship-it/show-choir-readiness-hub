import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { flashFrom, oneParam } from "@/lib/flash";
import { loadMealData } from "@/lib/pdf/queries";
import { SubTabs } from "../../../SubTabs";
import { competitionTabs } from "@/lib/subnav";
import { saveMealNote } from "./actions";

// Meal count (T031, §9 / §1.7 / US4). Staff screen: per-ensemble headcount for a
// competition, where meals = attendance expected + partial (partial counts as
// attending — a student present for part of the day still eats; see loadMealData),
// and only absent students are excluded. A NON-health logistics note (vendor,
// serving time) is editable by director/admin and prints on the meal PDF. The
// same loadMealData feeds this screen and the `meal` PDF, so they never diverge.
//
// Spec 005 T157 gave it the page head and the message convention every other
// surface has; the counts, the rule behind them and the PDF are unchanged.

// One section here — the page has a single message area — but the lookup is the
// app's shared one, because the code rides in the URL: `?ok=constructor` would
// otherwise walk up Object.prototype and hand React a function to render, and
// `?ok=a&ok=b` arrives as an ARRAY (spec 005 T143a).
const OK = {
  saved: { section: "page", message: "Note saved." },
} as const;

// The note is what the caterer is told — a pickup time, a vendor, a serving
// window — and it prints on the meal PDF somebody carries to the bus. "Note
// saved." used to be said over an unchecked write, so a refused one (an
// archived season, a seat that may not write) looked exactly like a saved one
// and the change was gone by the next page load.
const ERR = {
  save: {
    section: "page",
    message: "Couldn't save that note. It has not changed — try again.",
  },
} as const;

export default async function MealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const sp = await searchParams;
  const ok = flashFrom(OK, oneParam(sp, "ok"));
  const err = flashFrom(ERR, oneParam(sp, "error"));

  const supabase = await createClient();
  // Confirm the competition exists in this program (RLS-scoped) → clean 404.
  const { data: compRow } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compRow as { id: string; name: string } | null;
  if (!comp) notFound();

  const data = await loadMealData(supabase, competitionId);
  if (!data) notFound();

  const eyebrow = [
    comp.name,
    data.date ? formatDateInTz(`${data.date}T12:00:00Z`, tz) : "no date set",
  ].join(" · ");

  return (
    <section className="stack">
      <SubTabs strip={competitionTabs(slug, competitionId, "meals")} />

      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Meal count</h1>
        </div>
        <div className="page-head-actions">
          <a
            href={`/api/pdf/meal?competition=${competitionId}`}
            className="button-link"
          >
            Meal count (PDF)
          </a>
        </div>
      </div>

      {ok && <p className="alert-ok">{ok.message}</p>}
      {err && <p className="alert-error">{err.message}</p>}

      <p>
        <strong>{data.totalAttending}</strong> meals needed ·{" "}
        {data.totalAbsent} not coming
      </p>
      <p className="muted">
        A meal is counted for every student marked <strong>expected</strong> or{" "}
        <strong>part of the day</strong> — a student there for only part of the
        day still eats. Only students marked <strong>absent</strong> are left
        out. Change who is going on the{" "}
        <Link href={`/${slug}/competitions/${competitionId}/attendance`}>
          Attendance tab
        </Link>
        .
      </p>

      <h2>By ensemble</h2>
      <table className="members">
        <thead>
          <tr>
            <th>Ensemble</th>
            <th>Meals</th>
            <th>Not coming</th>
          </tr>
        </thead>
        <tbody>
          {data.ensembles.map((e, i) => (
            <tr key={i}>
              <td>{e.ensembleName}</td>
              <td>
                <strong>{e.attending}</strong>
              </td>
              <td className="muted">{e.absent}</td>
            </tr>
          ))}
          {data.ensembles.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                Nobody is on the list yet. Say which ensembles are going on the
                competition page.
              </td>
            </tr>
          )}
          <tr>
            <td>
              <strong>Total meals needed</strong>
            </td>
            <td>
              <strong>{data.totalAttending}</strong>
            </td>
            <td className="muted">{data.totalAbsent}</td>
          </tr>
        </tbody>
      </table>

      <h2>Note for the caterer</h2>
      <p className="muted">
        Vendor, serving time, pickup location — logistics only. Do not enter
        health, dietary, or medical information; that lives outside this system.
        This note prints on the meal count PDF.
      </p>
      {canWrite ? (
        <form action={saveMealNote} className="stack">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <textarea
            name="meal_note"
            aria-label="Note for the caterer"
            rows={3}
            defaultValue={data.mealNote ?? ""}
            placeholder="e.g. Boxed lunches from Jimmy's — served in cafeteria at 12:30, pick up at north door."
          />
          <button type="submit">Save note</button>
        </form>
      ) : data.mealNote ? (
        <p>{data.mealNote}</p>
      ) : (
        <p className="muted">No note yet.</p>
      )}

      <h2>Not coming ({data.absentNames.length})</h2>
      {data.absentNames.length === 0 ? (
        <p className="muted">Everyone is expected.</p>
      ) : (
        <ul>
          {data.absentNames.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
