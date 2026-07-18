import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES, ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { formatDateInTz } from "@/lib/datetime";
import { createCompetition } from "./actions";

// Competitions list + create (§5, T012). All roles read (the flag is the gate);
// director/admin create. Dates render in the program timezone (Constitution VII).

interface CompRow {
  id: string;
  name: string;
  host_school: string | null;
  date: string | null;
  status: "planned" | "confirmed" | "done";
  ensemble_id: string | null;
}

interface EnsembleRow {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  confirmed: "Confirmed",
  done: "Done",
};

export default async function CompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name, host_school, date, status, ensemble_id")
    .eq("program_id", program.id)
    .order("date", { ascending: true, nullsFirst: false });
  const competitions = (compData as CompRow[] | null) ?? [];

  const ensembleName = new Map<string, string>();
  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];
  for (const e of ensembles) ensembleName.set(e.id, e.name);

  // Pending parent absence requests → review-queue nudge for staff who can edit
  // attendance.
  const canReviewAbsences = ATTENDANCE_WRITE_ROLES.includes(role);
  let pendingAbsences = 0;
  if (canReviewAbsences) {
    const { count } = await supabase
      .from("absence_requests")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("status", "pending");
    pendingAbsences = count ?? 0;
  }

  return (
    <section className="stack">
      <h1>Competitions</h1>

      {canReviewAbsences && (
        <p>
          <Link href={`/${slug}/competitions/absences`}>
            Absence requests
            {pendingAbsences > 0 && (
              <span className="badge" style={{ marginLeft: "0.4rem" }}>
                {pendingAbsences} pending
              </span>
            )}
          </Link>
        </p>
      )}

      {error === "name" && <p className="alert-error">A competition needs a name.</p>}
      {error === "season" && (
        <p className="alert-error">Activate a season before adding competitions.</p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      {!season && (
        <p className="muted">
          No active season — competitions are season-scoped and can&apos;t be added yet.
        </p>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Date</th>
            <th>Host</th>
            <th>Ensemble</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {competitions.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/${slug}/competitions/${c.id}`}>{c.name}</Link>
              </td>
              <td>{c.date ? formatDateInTz(`${c.date}T12:00:00Z`, program.timezone) : "—"}</td>
              <td>{c.host_school ?? "—"}</td>
              <td>
                {c.ensemble_id ? (
                  <span className="chip">{ensembleName.get(c.ensemble_id) ?? "?"}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <span className="badge">{STATUS_LABEL[c.status]}</span>
              </td>
            </tr>
          ))}
          {competitions.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No competitions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && season && (
        <>
          <h2>Add a competition</h2>
          <form action={createCompetition} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" required placeholder="Show Choir Nationals" />
              </label>
              <label>
                Date
                <input type="date" name="date" />
              </label>
              <label>
                Ensemble
                <select name="ensemble_id" defaultValue="">
                  <option value="">— (none / whole program)</option>
                  {ensembles.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue="planned">
                  <option value="planned">Planned</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="done">Done</option>
                </select>
              </label>
            </div>
            <div className="row-inline">
              <label>
                Host school
                <input type="text" name="host_school" />
              </label>
              <label>
                Venue address
                <input type="text" name="venue_address" />
              </label>
              <label>
                showchoir.com URL
                <input type="url" name="showchoir_com_url" />
              </label>
            </div>
            <p className="muted">
              Creating a competition seeds attendance (everyone expected) for the
              selected ensemble.
            </p>
            <button type="submit">Add competition</button>
          </form>
        </>
      )}
    </section>
  );
}
