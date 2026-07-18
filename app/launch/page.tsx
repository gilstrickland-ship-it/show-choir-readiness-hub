import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "@/app/auth/actions";
import { brand } from "@/lib/brand";

// Post-sign-in router. The sign-in flow lands here by default and this page
// decides where the user actually belongs:
//   * one active membership   -> that program's dashboard
//   * several                 -> a chooser
//   * a pending invite for the user's verified email -> the accept-invite page
//   * nothing                 -> an honest "no program yet" screen
//
// Membership lookups use the service-role client because an INVITED membership
// is not readable under RLS (reads require ACTIVE membership) — the queries are
// scoped strictly to the signed-in user's id and verified email.

export const dynamic = "force-dynamic";

interface MembershipRow {
  id: string;
  role: string;
  status: string;
  program: { slug: string; name: string } | null;
}

export default async function LaunchPage() {
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

  if (active.length === 1 && active[0].program) {
    redirect(`/${active[0].program.slug}/dashboard`);
  }

  if (active.length === 0 && user.email) {
    const { data: invitedData } = await admin
      .from("program_members")
      .select("id, role, status, program:programs(slug, name)")
      .eq("status", "invited")
      .ilike("invited_email", user.email);
    const invited = (invitedData ?? []) as unknown as MembershipRow[];
    if (invited.length > 0) {
      redirect(`/invite/${invited[0].id}`);
    }
  }

  if (active.length === 0) {
    return (
      <main className="auth stack">
        <h1>No program yet</h1>
        <p className="muted">
          You&apos;re signed in as {user.email}, but this account isn&apos;t a
          member of any program. If your program uses {brand.name}, ask your
          director to invite this email address from Settings → Members — or
          contact <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
        </p>
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
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {active.map(
          (m) =>
            m.program && (
              <li key={m.id}>
                <Link href={`/${m.program.slug}/dashboard`}>
                  {m.program.name}
                </Link>{" "}
                <span className="muted">({m.role})</span>
              </li>
            ),
        )}
      </ul>
    </main>
  );
}
