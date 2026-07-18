"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Client component by exception (AGENTS server-first rule): the active nav
// state needs the current pathname, which a server layout cannot see —
// layouts don't re-render per navigation. Receives plain {slot,label} pairs;
// role/flag filtering already happened server-side in the layout.

export function ShellNav({
  slug,
  items,
}: {
  slug: string;
  items: { slot: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="shell-nav" aria-label="Program navigation">
      {items.map((item) => {
        const href = `/${slug}/${item.slot}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.slot}
            href={href}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
