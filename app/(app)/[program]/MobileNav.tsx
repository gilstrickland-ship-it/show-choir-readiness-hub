"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Mobile bottom tab bar ("Today Mobile" design ref, §9 of the redesign
// handoff). Client component for the same reason as ShellNav: the active state
// needs the current pathname. Receives the layout's already role/flag-filtered
// nav items (with their new task-oriented labels) and regroups them into the
// five-slot mobile IA — Today · Season · People · Wardrobe · More — so a role
// that can't see a surface never gets its tab. Wardrobe is promoted over Money
// because costume checkout / quick-change are phone-first hallway jobs; Money
// (treasury) is a desk task and drops into the More sheet. Everything not
// promoted to a tab lives in that sheet, plus a Settings entry when the role
// allows it (it left the desktop nav for the header). The sheet is the only
// client state here and closes itself on navigation.

const TAB_SLOTS: readonly string[] = [
  "dashboard",
  "season",
  "roster",
  "costumes",
];

export function MobileNav({
  slug,
  programId,
  items,
  showSettings,
  showGuideReopen,
  reopenGuide,
}: {
  slug: string;
  programId: string;
  items: { slot: string; label: string }[];
  showSettings: boolean;
  showGuideReopen: boolean;
  // The guarded "reopen guide" server action, passed from the server layout —
  // a client component may not import an inline "use server" module directly.
  reopenGuide: (formData: FormData) => Promise<void>;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet whenever navigation happens.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const isActive = (slot: string) => {
    const href = `/${slug}/${slot}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const tabs = TAB_SLOTS.flatMap((slot) => {
    const item = items.find((i) => i.slot === slot);
    return item ? [item] : [];
  });
  // Everything not promoted to a tab, plus Settings when the role allows it.
  const more = items.filter((i) => !TAB_SLOTS.includes(i.slot));
  if (showSettings) more.push({ slot: "settings", label: "Settings" });
  const moreActive = more.some((i) => isActive(i.slot));

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {tabs.map((item) => (
        <Link
          key={item.slot}
          href={`/${slug}/${item.slot}`}
          aria-current={isActive(item.slot) ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
      {(more.length > 0 || showGuideReopen) && (
        <>
          <button
            type="button"
            className="mobile-nav-more"
            aria-expanded={moreOpen}
            aria-current={moreActive ? "true" : undefined}
            onClick={() => setMoreOpen((open) => !open)}
          >
            More
          </button>
          {moreOpen && (
            <div className="mobile-nav-sheet" role="menu">
              {more.map((item) => (
                <Link
                  key={item.slot}
                  role="menuitem"
                  href={`/${slug}/${item.slot}`}
                  aria-current={isActive(item.slot) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
              {showGuideReopen && (
                <form action={reopenGuide}>
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <button type="submit" role="menuitem">
                    Getting started
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </nav>
  );
}
