"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Mobile bottom tab bar ("Today Mobile" design ref, §9 of the redesign
// handoff). Client component for the same reason as ShellNav: the active state
// needs the current pathname. Receives the layout's already role/flag-filtered
// nav items and regroups them into the five-slot mobile IA — Today · Season ·
// People · Money · More — so a role that can't see a surface never gets its
// tab. Everything not promoted to a tab lives in the More sheet; the sheet is
// the only client state here and closes itself on navigation.

const TAB_SLOTS: readonly string[] = [
  "dashboard",
  "competitions",
  "roster",
  "treasury",
];

// Mobile-IA labels for existing slots (routes unchanged; the Season page will
// take over the `competitions` tab target when it lands).
const MOBILE_LABELS: Record<string, string> = {
  dashboard: "Today",
  competitions: "Season",
  roster: "People",
  treasury: "Money",
  costumes: "Wardrobe",
};

export function MobileNav({
  slug,
  items,
}: {
  slug: string;
  items: { slot: string; label: string }[];
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
  const more = items.filter((i) => !TAB_SLOTS.includes(i.slot));
  const moreActive = more.some((i) => isActive(i.slot));

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {tabs.map((item) => (
        <Link
          key={item.slot}
          href={`/${slug}/${item.slot}`}
          aria-current={isActive(item.slot) ? "page" : undefined}
        >
          {MOBILE_LABELS[item.slot] ?? item.label}
        </Link>
      ))}
      {more.length > 0 && (
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
                  {MOBILE_LABELS[item.slot] ?? item.label}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </nav>
  );
}
