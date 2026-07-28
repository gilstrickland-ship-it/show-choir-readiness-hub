import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/lib/roster/ensembles";
import { MemberRow, type MemberListRow } from "./MemberRow";
import { AddMember } from "./AddMember";

// Season-scoped membership management for one ensemble (T007). Add/remove
// students for the active season, set what they do here (performer/band/crew/
// manager) and their voice part. A student can belong to multiple ensembles in
// the same season.
//
// Wave 6 gave it the same idioms as the ensembles list: "+ Add member" is a
// drawer off the page head, and role / voice part / remove moved into a
// row-local Edit panel.

// Messages the page owns — the add drawer and a row that vanished under us.
const ERR: Record<string, string> = {
  member: "Couldn't update the placement. Check the details and try again.",
  duplicate: "That student is already in this ensemble this season.",
  member_gone:
    "That placement is no longer in this ensemble. Reload the page and try again.",
};

// Messages that belong to ONE row. They arrive with `?edit=<memberId>`, which is
// also what reopens that row's panel.
const ROW_ERR: Record<string, string> = {
  member: "Couldn't update the placement. Check the details and try again.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function EnsembleMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; ensembleId: string }>;
  // Next hands back an ARRAY for a duplicated param (?edit=a&edit=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, ensembleId } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();
  const { data: ensembleData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("id", ensembleId)
    .eq("program_id", program.id)
    .maybeSingle();
  const ensemble = ensembleData as { id: string; name: string } | null;
  if (!ensemble) notFound();

  if (!season) {
    return (
      <section className="stack">
        <p>
          <Link href={`/${slug}/roster/ensembles`}>← Ensembles</Link>
        </p>
        <h1>{ensemble.name}</h1>
        <p className="muted">
          No active season, so there is nobody to place yet.{" "}
          <Link href={`/${slug}/settings/rollover`}>Start a season</Link> and this
          page fills in.
        </p>
      </section>
    );
  }

  const { data: memberData } = await supabase
    .from("ensemble_members")
    .select("id, student_id, role, voice_part, students(first_name, last_name, status)")
    .eq("program_id", program.id)
    .eq("season_id", season.id)
    .eq("ensemble_id", ensembleId);
  const members = (memberData as MemberListRow[] | null) ?? [];
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
    .eq("program_id", program.id)
    .eq("status", "active")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  const activeStudents =
    (studentData as { id: string; first_name: string; last_name: string }[] | null) ??
    [];
  const addable = activeStudents.filter((s) => !memberIds.has(s.id));

  const errorCode = one("error");
  const openId = canWrite ? one("edit") : null;
  const rowError = openId ? message(ROW_ERR, errorCode) : null;
  const pageError = openId ? null : message(ERR, errorCode);
  const addOpen =
    canWrite && !openId && (errorCode === "member" || errorCode === "duplicate");
  const confirmRemoveId = one("confirm") === "remove" ? openId : null;

  // What this ensemble is made of, said in the eyebrow rather than left for the
  // reader to count.
  const byRole = new Map<string, number>();
  for (const m of members) {
    byRole.set(m.role, (byRole.get(m.role) ?? 0) + 1);
  }
  const eyebrow = [
    season.label,
    `${members.length} member${members.length === 1 ? "" : "s"}`,
    ...Array.from(byRole.entries()).map(
      ([r, n]) => `${n} ${(MEMBER_ROLE_LABELS[r as MemberRole] ?? r).toLowerCase()}`,
    ),
  ].join(" · ");

  return (
    <section className="stack people">
      <p>
        <Link href={`/${slug}/roster/ensembles`}>← Ensembles</Link>
      </p>
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">{ensemble.name}</h1>
        </div>
        {canWrite && (
          <div className="page-head-actions">
            <AddMember
              programId={program.id}
              slug={slug}
              ensembleId={ensembleId}
              seasonId={season.id}
              addable={addable}
              open={addOpen}
              error={addOpen ? message(ERR, errorCode) : null}
            />
          </div>
        )}
      </div>

      {one("saved") && <p className="alert-ok">Saved.</p>}
      {pageError && <p className="alert-error">{pageError}</p>}

      <table className="members">
        <thead>
          <tr>
            <th>Student</th>
            <th>What they do</th>
            <th>Voice part</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <MemberRow
              key={m.id}
              programId={program.id}
              slug={slug}
              ensembleId={ensembleId}
              member={m}
              canWrite={canWrite}
              open={openId === m.id}
              confirmRemove={confirmRemoveId === m.id}
              error={openId === m.id ? rowError : null}
            />
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 4 : 3} className="muted">
                {activeStudents.length === 0
                  ? "No students on the roster yet."
                  : `Nobody in this ensemble for ${season.label} yet.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="page-foot">
        Membership is per season — placing someone here does not change any other
        season, and next season starts empty until you fill it.
      </p>
    </section>
  );
}
