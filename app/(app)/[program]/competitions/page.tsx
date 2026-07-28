import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  COMPETITION_WRITE_ROLES,
  COMPETITION_STATUS_LABELS,
  ATTENDANCE_WRITE_ROLES,
  competitionEnsembleMap,
  type CompetitionStatus,
} from "@/lib/competitions";
import { formatDateInTz, formatDateTimeInTz } from "@/lib/datetime";
import { Flash } from "../Flash";
import { readFlash } from "@/lib/flash";
import { COMP_LIST_FLASH_MAPS, type CompListSection } from "./shared";
import { createCompetition, attachPacket } from "./actions";

// Competitions list + create (§5, T012). All roles read (the flag is the gate);
// director/admin create. Dates render in the program timezone (Constitution VII).
// A competition can include one OR MORE ensembles (Feature 004) — participation
// lives in the competition_ensembles junction.
//
// Spec 005 T157 left this page its two distinct jobs and moved the third one
// off it. Adding a competition is Season's job now (Wave 1 made the "+ Add"
// drawer the place you add things), so the page head sends you there and the
// every-field form stays at `#add` as the drawer's "More options →" target —
// the same shape Events and Travel already have. What no other surface owns
// stays: attaching an emailed host packet to a competition, and the nudge to a
// waiting absence queue.

interface CompRow {
  id: string;
  name: string;
  host_school: string | null;
  date: string | null;
  status: CompetitionStatus;
}

interface EnsembleRow {
  id: string;
  name: string;
}

interface UnattachedDoc {
  id: string;
  storage_path: string;
  created_at: string;
}

export default async function CompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?error=a&error=b), so the
  // read goes through lib/flash — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const sp = await searchParams;
  const flash = readFlash<CompListSection>(sp, COMP_LIST_FLASH_MAPS);

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name, host_school, date, status")
    .eq("program_id", program.id)
    .order("date", { ascending: true, nullsFirst: false });
  const competitions = (compData as CompRow[] | null) ?? [];

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];
  const ensembleName = new Map(ensembles.map((e) => [e.id, e.name]));

  // Participating ensembles per competition (junction, one batched read).
  const compEnsembles = await competitionEnsembleMap(
    supabase,
    program.id,
    competitions.map((c) => c.id),
  );

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

  const eyebrow = [
    `${competitions.length} competition${competitions.length === 1 ? "" : "s"}`,
    season ? season.label : "No active season",
  ].join(" · ");

  // Both message sections are conditional — the attach box only exists while a
  // packet is waiting, the create form only for a writer with a season and an
  // ensemble. A message addressed to a block that isn't on the page would render
  // nowhere at all, so it falls back to a banner (the shifts-page contract).
  const showAdd = canWrite && !!season && ensembles.length > 0;
  const showPackets = canWrite && unattached.length > 0;
  const stranded =
    (flash.error?.section === "add" && !showAdd) ||
    (flash.error?.section === "packets" && !showPackets);

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">Competitions</h1>
        </div>
        {canWrite && (
          <div className="page-head-actions">
            <Link
              href={`/${slug}/season?add=comp`}
              className="button-link accent"
            >
              + Add a competition
            </Link>
          </div>
        )}
      </div>

      {stranded && <p className="alert-error">{flash.error!.message}</p>}

      {canReviewAbsences && pendingAbsences > 0 && (
        <p>
          <Link href={`/${slug}/competitions/absences`}>
            {pendingAbsences} absence request
            {pendingAbsences === 1 ? "" : "s"} waiting for you →
          </Link>
        </p>
      )}
      {canReviewAbsences && pendingAbsences === 0 && (
        <p className="muted">
          <Link href={`/${slug}/competitions/absences`}>
            Absence requests
          </Link>{" "}
          — nothing waiting.
        </p>
      )}

      {/* A host packet somebody emailed in, with no competition on it yet. Only
          a director sees this, and only while one is actually waiting. */}
      {showPackets && (
        <div className="stack confirm-box" id="packets">
          <h2>Packets that arrived by email</h2>
          <p className="muted">
            {unattached.length} host packet{unattached.length === 1 ? "" : "s"}{" "}
            {unattached.length === 1 ? "was" : "were"} forwarded in. Say which
            competition each one belongs to and we&apos;ll read it for you.
          </p>
          <Flash flash={flash} section="packets" />
          {unattached.map((doc) => (
            <form key={doc.id} action={attachPacket} className="row-inline">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="documentId" value={doc.id} />
              <span className="muted">
                {doc.storage_path.split("/").pop()} ·{" "}
                {formatDateTimeInTz(doc.created_at, tz)}
              </span>
              <select
                name="competitionId"
                defaultValue=""
                required
                aria-label="Attach to competition"
              >
                <option value="">— choose competition —</option>
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="secondary">
                Attach &amp; read it
              </button>
            </form>
          ))}
        </div>
      )}

      {!season && (
        <p className="muted">
          No active season, so nothing can be added yet — competitions belong to
          a season.
        </p>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Date</th>
            <th>Host</th>
            <th>Who is going</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {competitions.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/${slug}/competitions/${c.id}`}>{c.name}</Link>
              </td>
              <td>
                {c.date ? formatDateInTz(`${c.date}T12:00:00Z`, tz) : "—"}
              </td>
              <td>{c.host_school ?? "—"}</td>
              <td>
                {(compEnsembles.get(c.id) ?? []).length > 0 ? (
                  <span className="row-inline">
                    {(compEnsembles.get(c.id) ?? []).map((eid) => (
                      <span className="chip" key={eid}>
                        {ensembleName.get(eid) ?? "?"}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <span className="badge">
                  {COMPETITION_STATUS_LABELS[c.status]}
                </span>
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

      {/* The every-field form. The quick way to add a competition is the "+ Add"
          drawer on Season (two fields); this is what its "More options →" link
          opens, so `#add` has to keep working. */}
      {canWrite && season && ensembles.length === 0 && (
        <div className="stack">
          <h2 id="add">Add a competition</h2>
          <p className="muted">
            A competition attaches to an ensemble so it can seed attendance,
            meals, and checkout.{" "}
            <Link href={`/${slug}/roster/ensembles`}>
              Create an ensemble first
            </Link>
            .
          </p>
        </div>
      )}

      {showAdd && (
        <div className="stack">
          <h2 id="add">Add a competition</h2>
          <p className="muted">
            Every field, for when you already have the host&apos;s details. Just
            a name and a date?{" "}
            <Link href={`/${slug}/season?add=comp`}>
              Add it from Season in two fields →
            </Link>
          </p>
          <Flash flash={flash} section="add" />
          <form action={createCompetition} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <div className="row-inline">
              <label>
                Name
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Show Choir Nationals"
                />
              </label>
              <label>
                Date
                <input type="date" name="date" />
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
            <fieldset className="stack">
              <legend>Who is going</legend>
              <div className="row-inline">
                {ensembles.map((e) => (
                  <label key={e.id} className="checkbox-inline">
                    <input type="checkbox" name="ensemble_ids" value={e.id} />
                    {e.name}
                  </label>
                ))}
              </div>
            </fieldset>
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
              Sending more than one group? Tick every ensemble attending — one
              competition covers them all, and attendance, meals, and travel span
              the whole roster. A student in two of them is counted once.
            </p>
            <button type="submit">Add competition</button>
          </form>
        </div>
      )}
    </section>
  );
}
