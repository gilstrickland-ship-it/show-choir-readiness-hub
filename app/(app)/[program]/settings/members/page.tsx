import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_ROLES } from "@/lib/nav";
import type { Role } from "@/lib/auth";
import { inviteMember, reRoleMember, removeMember } from "../actions";
import { SettingsTabs } from "../SettingsTabs";

const ROLE_OPTIONS: readonly { value: Role; label: string }[] = [
  { value: "director", label: "Director" },
  { value: "admin", label: "Admin" },
  { value: "treasurer", label: "Treasurer" },
  { value: "costume_manager", label: "Costume manager" },
  { value: "board_member", label: "Board member" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
);

interface MemberRow {
  id: string;
  role: Role;
  status: "invited" | "active" | "removed";
  invited_email: string | null;
  user_id: string | null;
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    invited?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const { invited, saved, error } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase
    .from("program_members")
    .select("id, role, status, invited_email, user_id")
    .eq("program_id", program.id)
    .in("status", ["active", "invited"])
    .order("status", { ascending: true });
  const members = (data as MemberRow[] | null) ?? [];

  // profiles has no FK from program_members (both point at auth.users), so it
  // can't be embedded — resolve display names in a second query and map by
  // user_id. RLS lets a member read profiles of co-members in the same program.
  const userIds = members
    .map((m) => m.user_id)
    .filter((id): id is string => id !== null);
  const nameByUserId = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of (profiles as { id: string; full_name: string | null }[] | null) ?? []) {
      nameByUserId.set(p.id, p.full_name);
    }
  }

  // Full invite link to copy when email delivery isn't configured.
  let inviteLink: string | null = null;
  if (invited) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "https";
    inviteLink = `${proto}://${host}/invite/${invited}`;
  }

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Settings</p>
          <h1 className="page-h1">Members</h1>
        </div>
      </div>

      <SettingsTabs slug={slug} active="members" />

      {saved && <p className="alert-ok">Saved.</p>}
      {invited && (
        <div className="alert-ok stack">
          <span>
            Invite created. Share this link with the invitee:
            <br />
            <code className="invite-link">{inviteLink}</code>
          </span>
          <span className="muted">
            If they&apos;ve never set a password, tell them to open the link, choose
            &ldquo;Email me a sign-in link,&rdquo; and enter{" "}
            <strong>this exact email address</strong> — the sign-in link lets them
            in without a password.
          </span>
        </div>
      )}
      {error === "last_director" && (
        <p className="alert-error">
          A program must keep at least one director. Assign another director first.
        </p>
      )}
      {error === "invite" && (
        <p className="alert-error">Enter a valid email and role.</p>
      )}
      {(error === "role" || error === "remove") && (
        <p className="alert-error">Couldn&apos;t update that member.</p>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th>Role</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                {(m.user_id ? nameByUserId.get(m.user_id) : null) ??
                  m.invited_email ??
                  "—"}
                {m.status === "invited" && m.invited_email && (
                  <span className="muted"> (invited)</span>
                )}
              </td>
              <td>{m.status}</td>
              <td>
                <form action={reRoleMember} className="row-inline">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <select name="role" defaultValue={m.role} aria-label="Role">
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="secondary">
                    Update
                  </button>
                </form>
              </td>
              <td>
                <form action={removeMember}>
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <button type="submit" className="linklike danger">
                    Remove
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Invite a member</h2>
      <p className="muted">
        Staff and board only. {ROLE_LABEL.director} and {ROLE_LABEL.admin} share
        the same abilities; {ROLE_LABEL.board_member} is read-only.
      </p>
      <form action={inviteMember} className="stack">
        <input type="hidden" name="programId" value={program.id} />
        <input type="hidden" name="slug" value={slug} />
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="admin">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Send invite</button>
      </form>
    </section>
  );
}
