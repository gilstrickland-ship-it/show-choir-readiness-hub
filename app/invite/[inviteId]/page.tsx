import Link from "next/link";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "@/app/auth/actions";
import { acceptInvite } from "./actions";

// Invite acceptance. The invite link is /invite/<program_members.id>. The row is
// read with the service-role client (the invitee isn't a member yet). Flow:
//   not signed in → prompt sign-in, returning here afterward
//   signed in, wrong email → explain the mismatch, offer sign-out
//   signed in, matching email → accept button (server action)

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  admin: "Admin",
  treasurer: "Treasurer",
  costume_manager: "Costume manager",
  board_member: "Board member",
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ inviteId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { inviteId } = await params;
  const { error } = await searchParams;

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("program_members")
    .select("id, role, status, invited_email, program:programs(name)")
    .eq("id", inviteId)
    .maybeSingle();

  if (!member || member.status !== "invited") {
    return (
      <main className="auth">
        <h1>Invite unavailable</h1>
        <p className="muted">
          This invite has already been used or is no longer valid. Ask your
          program director to send a new one.
        </p>
      </main>
    );
  }

  const program = member.program as unknown as { name: string } | null;
  const roleLabel = ROLE_LABELS[member.role] ?? member.role;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="auth">
        <h1>Join {program?.name ?? brand.name}</h1>
        <p>
          You&apos;ve been invited as <strong>{roleLabel}</strong>. Sign in as{" "}
          <strong>{member.invited_email}</strong> to accept.
        </p>
        <p className="muted">
          If you&apos;ve never set a password, choose &ldquo;Email me a sign-in
          link&rdquo; on the next screen and enter{" "}
          <strong>{member.invited_email}</strong> — the link signs you in without a
          password.
        </p>
        <p>
          <Link
            href={`/sign-in?redirect=${encodeURIComponent(`/invite/${inviteId}`)}`}
          >
            Sign in to continue
          </Link>
        </p>
      </main>
    );
  }

  const matches =
    (user.email ?? "").toLowerCase() ===
    (member.invited_email ?? "").toLowerCase();

  if (!matches) {
    return (
      <main className="auth">
        <h1>Wrong account</h1>
        <p>
          This invite is for <strong>{member.invited_email}</strong>, but
          you&apos;re signed in as <strong>{user.email}</strong>.
        </p>
        <form action={signOut}>
          <button type="submit" className="secondary">
            Sign out and switch accounts
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="auth">
      <h1>Join {program?.name ?? brand.name}</h1>
      <p>
        You&apos;ve been invited as <strong>{roleLabel}</strong>, signed in as{" "}
        {user.email}.
      </p>
      {error && (
        <p className="alert-error">
          We couldn&apos;t accept this invite. It may have been revoked.
        </p>
      )}
      <form action={acceptInvite}>
        <input type="hidden" name="inviteId" value={inviteId} />
        <button type="submit">Accept invite</button>
      </form>
    </main>
  );
}
