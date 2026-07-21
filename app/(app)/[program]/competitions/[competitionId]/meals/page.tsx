import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { loadMealData } from "@/lib/pdf/queries";
import { CompetitionTabs } from "../CompetitionTabs";
import { saveMealNote } from "./actions";

// Meal count (T031, §9 / §1.7 / US4). Staff screen: per-ensemble headcount for a
// competition, where meals = attendance expected + partial (partial counts as
// attending — a student present for part of the day still eats; see loadMealData),
// and only absent students are excluded. A NON-health logistics note (vendor,
// serving time) is editable by director/admin and prints on the meal PDF. The
// same loadMealData feeds this screen and the `meal` PDF, so they never diverge.

export default async function MealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const sp = await searchParams;

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

  return (
    <section className="stack">
      <CompetitionTabs slug={slug} competitionId={competitionId} active="meals" />
      <h1>Meal count</h1>

      {sp.saved && <p className="alert-ok">Saved.</p>}

      <p className="muted">
        {data.date ? formatDateInTz(`${data.date}T12:00:00Z`, tz) : "No date set"} ·{" "}
        <strong>{data.totalAttending}</strong> meals needed · {data.totalAbsent}{" "}
        absent ·{" "}
        <a href={`/api/pdf/meal?competition=${competitionId}`}>Download meal count (PDF)</a>
      </p>
      <p className="muted">
        A meal is counted for every student marked <strong>expected</strong> or{" "}
        <strong>partial</strong> — a student there for only part of the day still
        eats. Only <strong>absent</strong> students are excluded. Set attendance on
        the{" "}
        <Link href={`/${slug}/competitions/${competitionId}/attendance`}>
          Attendance tab
        </Link>
        .
      </p>

      <h2>Headcount by ensemble</h2>
      <table className="members">
        <thead>
          <tr>
            <th>Ensemble</th>
            <th>Meals</th>
            <th>Absent</th>
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
                No attendance recorded yet. Seed attendance from the competition page.
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

      <h2>Logistics note</h2>
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
            aria-label="Meal note for families"
            rows={3}
            defaultValue={data.mealNote ?? ""}
            placeholder="e.g. Boxed lunches from Jimmy's — served in cafeteria at 12:30, pick up at north door."
          />
          <button type="submit">Save note</button>
        </form>
      ) : data.mealNote ? (
        <p>{data.mealNote}</p>
      ) : (
        <p className="muted">No logistics note yet.</p>
      )}

      <h2>Absent ({data.absentNames.length})</h2>
      {data.absentNames.length === 0 ? (
        <p className="muted">No absences recorded.</p>
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
