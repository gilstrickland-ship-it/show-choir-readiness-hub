import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_ROLES } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { readFlash, oneParam } from "@/lib/flash";
import { inviteMember } from "../actions";
import { SubTabs } from "../../SubTabs";
import { settingsTabs } from "@/lib/subnav";
import { Flash } from "../../Flash";
import { StaffMemberRow, type StaffMember } from "./StaffMemberRow";
import {
  MEMBER_FLASH_MAPS,
  staffMemberAnchor,
  type MemberSection,
} from "../shared";

// Settings § Members (director/admin) — who has a seat in this program.
//
// Spec 005 Wave 13 / T164: the row-edit idiom every table in the app now uses.
// The role dropdown and its Save used to live permanently open in a cell, with
// Remove a tab-stop away in the next one; both are behind one Edit disclosure
// now, and a refusal comes back to the row that produced it rather than to a
// banner at the top of the list.
//
// The last-director guard lives in the actions (a program must never be left
// with nobody who can run it) and its refusal renders inside the panel of the
// row that tried, because that is where the reader is looking.

const ROLE_OPTIONS: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
  "costume_manager",
  "board_member",
];

const MEMBER_COLUMNS = 4;

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // A duplicated param (?edit=a&edit=b) arrives as an ARRAY, so every read goes
  // through lib/flash's `oneParam` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);
  const flash = readFlash<MemberSection>(sp, MEMBER_FLASH_MAPS);

  const openMemberId = one("edit");
  const confirmRemove = one("confirm") === "remove";
  const panelError =
    flash.error?.section === "panel" ? flash.error.message : null;
  const inviteError =
    flash.error?.section === "invite" ? flash.error.message : null;

  const base = `/${slug}/settings/members`;
  const rowHref = (memberId: string, mode: "open" | "close" | "confirm"): string => {
    const anchor = `#${staffMemberAnchor(memberId)}`;
    if (mode === "close") return `${base}${anchor}`;
    const id = encodeURIComponent(memberId);
    return mode === "confirm"
      ? `${base}?edit=${id}&confirm=remove${anchor}`
      : `${base}?edit=${id}${anchor}`;
  };

  const supabase = await createClient();
  const { data } = await supabase
    .from("program_members")
    .select("id, role, status, invited_email, user_id")
    .eq("program_id", program.id)
    .in("status", ["active", "invited"])
    .order("status", { ascending: true });
  const members = (data as StaffMember[] | null) ?? [];

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
  const nameOf = (m: StaffMember): string =>
    (m.user_id ? nameByUserId.get(m.user_id) : null) ?? m.invited_email ?? "—";

  // The invite id rides back on the redirect exactly once, the same way a freshly
  // minted share URL does: it is the one moment the full link is worth showing,
  // because email delivery may not be configured and this is how onboarding still
  // works. `?invited=` is data, not a message.
  const invitedId = one("invited");
  let inviteLink: string | null = null;
  if (invitedId) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "https";
    inviteLink = `${proto}://${host}/invite/${encodeURIComponent(invitedId)}`;
  }

  const activeCount = members.filter((m) => m.status === "active").length;
  const invitedCount = members.filter((m) => m.status === "invited").length;
  const summary =
    members.length === 0
      ? "Nobody yet"
      : `${activeCount} with access${
          invitedCount > 0 ? ` · ${invitedCount} invited` : ""
        }`;

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Settings</p>
          <h1 className="page-h1">Members</h1>
        </div>
      </div>

      <SubTabs strip={settingsTabs(slug, "members")} />

      <div className="travel-section-head">
        <h2>Who has a seat</h2>
        <span className="travel-section-summary">{summary}</span>
      </div>
      <Flash flash={flash} section="page" />
      <p className="muted">
        Staff and board only — parents and students never have accounts.{" "}
        {ROLE_LABELS.director} and {ROLE_LABELS.admin} can do everything;{" "}
        {ROLE_LABELS.board_member} can only read.
      </p>

      {inviteLink && (
        <div className="alert-ok stack">
          <span>
            Invite created. Send this link to the person you invited:
            <br />
            <code className="invite-link">{inviteLink}</code>
          </span>
          <span className="muted">
            If they&apos;ve never set a password, tell them to open the link,
            choose &ldquo;Email me a sign-in link,&rdquo; and enter{" "}
            <strong>this exact email address</strong> — the sign-in link lets them
            in without a password.
          </span>
        </div>
      )}

      <table className="members">
        <thead>
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th>Can do</th>
            <th className="table-action">
              <span className="muted">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <StaffMemberRow
              key={m.id}
              programId={program.id}
              slug={slug}
              member={m}
              name={nameOf(m)}
              open={openMemberId === m.id}
              confirmRemove={openMemberId === m.id && confirmRemove}
              error={openMemberId === m.id ? panelError : null}
              columns={MEMBER_COLUMNS}
              rowHref={rowHref}
            />
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={MEMBER_COLUMNS} className="muted">
                No members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <details className="stack" open={Boolean(inviteError)}>
        <summary className="people-disclosure">Invite someone — {summary}</summary>
        <form action={inviteMember} className="stack settings-form">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          {inviteError && <p className="alert-error">{inviteError}</p>}
          <label>
            Email
            <input type="email" name="email" required />
          </label>
          <label>
            What they can do
            <select name="role" defaultValue="admin">
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Send invite</button>
        </form>
      </details>
    </section>
  );
}
