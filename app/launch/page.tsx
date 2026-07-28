import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "@/app/auth/actions";
import { Flash } from "@/app/(app)/[program]/Flash";
import { brand } from "@/lib/brand";
import { escapeLike } from "@/lib/email";
import { readFlash } from "@/lib/flash";
import { formatTimeZoneLabel, TIMEZONES } from "@/lib/datetime";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { createProgram } from "./actions";
import { LAUNCH_FLASH_MAPS, type LaunchSection } from "./shared";

// Post-sign-in router. The sign-in flow lands here by default and this page
// decides where the user actually belongs:
//   * exactly one active membership AND no pending invites -> that dashboard
//   * several memberships, or any pending invite -> a chooser
//   * no membership, one pending invite -> straight to the accept-invite page
//   * nothing -> an honest "no program yet" screen with a create-a-program form
//
// Membership lookups use the service-role client because an INVITED membership
// is not readable under RLS (reads require ACTIVE membership) — the queries are
// scoped strictly to the signed-in user's id and verified email.
//
// The time zone offered here is lib/datetime's one list — the same one Settings
// offers, so a program cannot be created in a zone Settings can't then show
// (spec 005 Wave 8 unified it; T165 keeps it that way).

export const dynamic = "force-dynamic";

interface MembershipRow {
  id: string;
  role: string;
  status: string;
  program: { slug: string; name: string } | null;
}

export default async function LaunchPage({
  searchParams,
}: {
  // A duplicated param (?error=a&error=b) arrives as an ARRAY, so this is typed
  // as what it really is and the read goes through lib/flash (./shared).
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const flash = readFlash<LaunchSection>(await searchParams, LAUNCH_FLASH_MAPS);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const admin = createAdminClient();

  const { data: activeData } = await admin
    .from("program_members")
    .select("id, role, status, program:programs(slug, name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const active = (activeData ?? []) as unknown as MembershipRow[];

  // Always resolve pending invites for this verified email (F3) — an invite to a
  // second program must be visible even when the user already runs one.
  let invited: MembershipRow[] = [];
  if (user.email) {
    const { data: invitedData } = await admin
      .from("program_members")
      .select("id, role, status, program:programs(slug, name)")
      .eq("status", "invited")
      .ilike("invited_email", escapeLike(user.email));
    invited = (invitedData ?? []) as unknown as MembershipRow[];
  }

  // Straight-to-dashboard only when there is exactly one place to land: one
  // active membership and nothing else waiting for a decision.
  if (active.length === 1 && invited.length === 0 && active[0].program) {
    redirect(`/${active[0].program.slug}/dashboard`);
  }

  // No membership and exactly one pending invite: send them to accept it.
  if (active.length === 0 && invited.length === 1) {
    redirect(`/invite/${invited[0].id}`);
  }

  const createForm = (
    <form action={createProgram} className="stack">
      <label>
        Program name
        <input type="text" name="name" placeholder="Central High Show Choir" required />
      </label>
      <label>
        School name
        <input type="text" name="school_name" placeholder="Central High School" />
      </label>
      <div className="row-inline">
        <label>
          City
          <input type="text" name="city" />
        </label>
        <label>
          State
          <input type="text" name="state" />
        </label>
      </div>
      <label>
        Time zone
        <select name="timezone" defaultValue="America/Chicago" required>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {formatTimeZoneLabel(tz)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Create program</button>
    </form>
  );

  // Nothing yet: an honest empty state that also lets the user get started.
  if (active.length === 0 && invited.length === 0) {
    return (
      <main className="auth stack">
        <h1>Start your program</h1>
        <p className="muted">
          You&apos;re signed in as {user.email}, but this account isn&apos;t a
          member of any program yet. Create one below to become its director — or,
          if your program already uses {brand.name}, ask your director to invite
          this email from Settings → Members, or contact{" "}
          <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
        </p>
        <Flash flash={flash} section="page" />
        {createForm}
        <form action={signOut}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="auth stack">
      <h1>Choose a program</h1>
      <Flash flash={flash} section="page" />

      {active.length > 0 && (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {active.map(
            (m) =>
              m.program && (
                <li key={m.id}>
                  <Link href={`/${m.program.slug}/dashboard`}>
                    {m.program.name}
                  </Link>{" "}
                  <span className="muted">({ROLE_LABELS[m.role as Role] ?? m.role})</span>
                </li>
              ),
          )}
        </ul>
      )}

      {invited.length > 0 && (
        <section className="stack">
          <h2>Pending invites</h2>
          <p className="muted">
            You&apos;ve been invited to {invited.length === 1 ? "a program" : "these programs"}.
            Open an invite to review and accept it.
          </p>
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {invited.map((m) => (
              <li key={m.id}>
                <Link href={`/invite/${m.id}`}>
                  {m.program?.name ?? "A program"}
                </Link>{" "}
                <span className="muted">({ROLE_LABELS[m.role as Role] ?? m.role})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="stack">
        <summary className="people-disclosure">Start a new program</summary>
        <p className="muted">
          Create another program you&apos;ll run — you become its director.
        </p>
        {createForm}
      </details>
    </main>
  );
}
