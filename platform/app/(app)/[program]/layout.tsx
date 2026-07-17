import Link from "next/link";
import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { NAV, isNavItemVisible } from "@/lib/nav";
import { signOut } from "@/app/auth/actions";

// Tenant shell (server layout). Resolves program + active membership + role +
// active season and evaluates flags once via getTenantContext() (cached — pages
// call the same helper without a second round-trip). Nav is role-aware and
// flag-gated: flagged-off or role-forbidden items are omitted server-side, never
// hidden with CSS (Constitution VIII).

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  admin: "Admin",
  treasurer: "Treasurer",
  costume_manager: "Costume manager",
  board_member: "Board member",
};

export default async function ProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);

  const items = NAV.filter((item) => isNavItemVisible(item, role, flags));

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <Link href={`/${slug}/dashboard`}>{program.name}</Link>
          <span className="shell-meta">
            {brand.name}
            {season ? ` · ${season.label}` : ""}
          </span>
        </div>
        <div className="shell-account">
          <span className="badge">{ROLE_LABELS[role] ?? role}</span>
          <form action={signOut}>
            <button type="submit" className="linklike">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <nav className="shell-nav" aria-label="Program navigation">
        {items.map((item) => (
          <Link key={item.slot} href={`/${slug}/${item.slot}`}>
            {item.label}
          </Link>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  );
}
