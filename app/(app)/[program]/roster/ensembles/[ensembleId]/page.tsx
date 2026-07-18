import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { addMember, updateMember, removeMember } from "../actions";

// Season-scoped membership management for one ensemble (T007). Add/remove
// students for the active season, set role (performer/band/crew/manager) and
// voice_part. A student can belong to multiple ensembles in the same season.

const MEMBER_ROLE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "performer", label: "Performer" },
  { value: "band", label: "Band" },
  { value: "crew", label: "Crew" },
  { value: "manager", label: "Manager" },
];

interface MemberRow {
  id: string;
  student_id: string;
  role: string;
  voice_part: string | null;
  students: { first_name: string; last_name: string; status: string } | null;
}

export default async function EnsembleMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; ensembleId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug, ensembleId } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) notFound();
  const canWrite = ROSTER_WRITE_ROLES.includes(role);
  const { saved, error } = await searchParams;

  const supabase = await createClient();
  const { data: ensembleData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("id", ensembleId)
    .eq("program_id", program.id)
    .maybeSingle();
  const ensemble = ensembleData as { id: string; name: string } | null;
  if (!ensemble) notFound();

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/roster/ensembles`}>← Ensembles</Link>
      </p>
      <h1>{ensemble.name} — members</h1>

      {!season ? (
        <p className="muted">
          No active season. Set one active in Settings to manage membership.
        </p>
      ) : (
        <EnsembleMembers
          slug={slug}
          programId={program.id}
          ensembleId={ensembleId}
          seasonId={season.id}
          seasonLabel={season.label}
          canWrite={canWrite}
          saved={saved}
          error={error}
        />
      )}
    </section>
  );
}

async function EnsembleMembers({
  slug,
  programId,
  ensembleId,
  seasonId,
  seasonLabel,
  canWrite,
  saved,
  error,
}: {
  slug: string;
  programId: string;
  ensembleId: string;
  seasonId: string;
  seasonLabel: string;
  canWrite: boolean;
  saved?: string;
  error?: string;
}) {
  const supabase = await createClient();

  const { data: memberData } = await supabase
    .from("ensemble_members")
    .select("id, student_id, role, voice_part, students(first_name, last_name, status)")
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .eq("ensemble_id", ensembleId);
  const members = (memberData as MemberRow[] | null) ?? [];
  members.sort((a, b) => {
    const an = `${a.students?.last_name ?? ""} ${a.students?.first_name ?? ""}`;
    const bn = `${b.students?.last_name ?? ""} ${b.students?.first_name ?? ""}`;
    return an.localeCompare(bn);
  });

  // Active students not already in this ensemble for the season → the add picker.
  const memberIds = new Set(members.map((m) => m.student_id));
  const { data: studentData } = await supabase
    .from("students")
    .select("id, first_name, last_name")
    .eq("program_id", programId)
    .eq("status", "active")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  const addable = ((studentData as
    | { id: string; first_name: string; last_name: string }[]
    | null) ?? []).filter((s) => !memberIds.has(s.id));

  return (
    <>
      <p className="muted">Season: {seasonLabel}</p>

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "duplicate" && (
        <p className="alert-error">That student is already in this ensemble this season.</p>
      )}
      {error === "member" && <p className="alert-error">Couldn&apos;t update membership.</p>}

      <table className="members">
        <thead>
          <tr>
            <th>Student</th>
            <th>Role</th>
            <th>Voice part</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                <Link href={`/${slug}/roster/${m.student_id}`}>
                  {m.students?.last_name}, {m.students?.first_name}
                </Link>
                {m.students?.status === "inactive" && <span className="muted"> (inactive)</span>}
              </td>
              {canWrite ? (
                <td colSpan={2}>
                  <form action={updateMember} className="row-inline">
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="ensembleId" value={ensembleId} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <select name="role" defaultValue={m.role} aria-label="Role">
                      {MEMBER_ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      name="voice_part"
                      defaultValue={m.voice_part ?? ""}
                      placeholder="Soprano 1, Tenor, …"
                      aria-label="Voice part"
                    />
                    <button type="submit" className="secondary">
                      Save
                    </button>
                  </form>
                </td>
              ) : (
                <>
                  <td>{m.role}</td>
                  <td>{m.voice_part ?? "—"}</td>
                </>
              )}
              {canWrite && (
                <td>
                  <form action={removeMember}>
                    <input type="hidden" name="programId" value={programId} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="ensembleId" value={ensembleId} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <button type="submit" className="linklike danger">
                      Remove
                    </button>
                  </form>
                </td>
              )}
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 4 : 3} className="muted">
                No members yet this season.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h2>Add a member</h2>
          {addable.length === 0 ? (
            <p className="muted">Every active student is already in this ensemble.</p>
          ) : (
            <form action={addMember} className="stack">
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="ensembleId" value={ensembleId} />
              <input type="hidden" name="seasonId" value={seasonId} />
              <div className="row-inline">
                <label>
                  Student
                  <select name="studentId" required>
                    {addable.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.last_name}, {s.first_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Role
                  <select name="role" defaultValue="performer">
                    {MEMBER_ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Voice part
                  <input type="text" name="voice_part" placeholder="Soprano 1, Tenor, …" />
                </label>
              </div>
              <button type="submit">Add to ensemble</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
