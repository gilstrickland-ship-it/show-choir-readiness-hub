import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES, ATTENDANCE_WRITE_ROLES } from "@/lib/competitions";
import { formatDateInTz, formatDateTimeInTz } from "@/lib/datetime";
import { createCompetition, attachPacket } from "./actions";

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

  // Unattached inbound packets (§14.3, T026): host-packet documents forwarded by
  // email that landed without a competition. A director attaches each to a
  // competition, which then runs the parse pipeline.
  interface UnattachedDoc {
    id: string;
    storage_path: string;
    created_at: string;
  }
  let unattached: UnattachedDoc[] = [];
  if (canWrite) {
    const { data: docData } = await supabase
      .from("documents")
      .select("id, storage_path, created_at")
      .eq("program_id", program.id)
      .eq("kind", "host_packet")
      .is("competition_id", null)
      .order("created_at", { ascending: false });
    unattached = (docData as UnattachedDoc[] | null) ?? [];
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

      {canWrite && unattached.length > 0 && (
        <div className="stack confirm-box" style={{ width: "100%" }}>
          <h2>Unattached packets</h2>
          <p className="muted">
            {unattached.length} host packet{unattached.length === 1 ? "" : "s"}{" "}
            arrived by email forward. Attach each to a competition to parse it.
          </p>
          {unattached.map((doc) => (
            <form key={doc.id} action={attachPacket} className="row-inline">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="documentId" value={doc.id} />
              <span className="muted">
                {doc.storage_path.split("/").pop()} ·{" "}
                {formatDateTimeInTz(doc.created_at, program.timezone)}
              </span>
              <select name="competitionId" defaultValue="" required aria-label="Attach to competition">
                <option value="">— choose competition —</option>
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="secondary">
                Attach &amp; parse
              </button>
            </form>
          ))}
        </div>
      )}

      {error === "attach" && (
        <p className="alert-error">Couldn&apos;t attach the packet. Pick a competition and try again.</p>
      )}
      {error === "name" && <p className="alert-error">A competition needs a name.</p>}
      {error === "ensemble" && (
        <p className="alert-error">Pick an ensemble for the competition.</p>
      )}
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

      {canWrite && season && ensembles.length === 0 && (
        <div className="stack">
          <h2 id="add">Add a competition</h2>
          <p className="muted">
            A competition attaches to an ensemble so it can seed attendance, meals,
            and checkout.{" "}
            <Link href={`/${slug}/roster/ensembles`}>Create an ensemble first</Link>.
          </p>
        </div>
      )}

      {canWrite && season && ensembles.length > 0 && (
        <>
          <h2 id="add">Add a competition</h2>
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
                <select name="ensemble_id" defaultValue="" required>
                  <option value="" disabled>
                    — choose ensemble —
                  </option>
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
              Two groups performing at the same event? Create one competition per
              ensemble.
            </p>
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
