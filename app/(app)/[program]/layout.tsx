import Link from "next/link";
import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { NAV, isNavItemVisible, SETTINGS_ROLES } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/auth";
import { signOut } from "@/app/auth/actions";
import { ShellNav } from "./ShellNav";
import { MobileNav } from "./MobileNav";

// Tenant shell (server layout). Resolves program + active membership + role +
// active season and evaluates flags once via getTenantContext() (cached — pages
// call the same helper without a second round-trip). Nav is role-aware and
// flag-gated: flagged-off or role-forbidden items are omitted server-side, never
// hidden with CSS (Constitution VIII). ROLE_LABELS is shared from lib/auth.

export default async function ProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags, isSupport } = await getTenantContext(slug);

  const items = NAV.filter((item) => isNavItemVisible(item, role, flags));

  // Settings left the main nav for the header's right cluster (redesign IA).
  // Support views (synthetic board_member seat) never expose it.
  const showSettings = !isSupport && SETTINGS_ROLES.includes(role);

  return (
    <div className="shell">
      {isSupport && (
        <div className="support-banner" role="status">
          {brand.name} support is viewing <strong>{program.name}</strong> in
          read-only mode. Nothing you see here can be changed from this session.
        </div>
      )}
      <header className="shell-header">
        <div className="shell-brand">
          <Link href={`/${slug}/dashboard`}>{program.name}</Link>
          <span className="shell-meta">
            {brand.name}
            {season ? ` · ${season.label}` : ""}
          </span>
        </div>
        <ShellNav
          slug={slug}
          items={items.map(({ slot, label }) => ({ slot, label }))}
        />
        <div className="shell-account">
          <span className="badge">
            {isSupport ? `${brand.name} support` : (ROLE_LABELS[role] ?? role)}
          </span>
          {showSettings && (
            <Link href={`/${slug}/settings`} className="shell-settings-link">
              Settings
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="linklike">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
      <MobileNav
        slug={slug}
        items={items.map(({ slot, label }) => ({ slot, label }))}
        showSettings={showSettings}
      />
    </div>
  );
}
