import Link from "next/link";
import type { SubTabStrip } from "@/lib/subnav";

// The app's ONE sub-tab strip (spec 005 Wave 8 / T142). Which routes it holds
// and who may see them is `lib/subnav.ts`; this is only how a strip looks and
// what it says to a screen reader.
//
// It replaces six components that each re-implemented these fifteen lines —
// People, Money, Wardrobe, Comms, Settings and the competition children. The
// copies had already drifted: the competition strip still wrapped itself in
// `.settings-tabs`, the pre-redesign class, so its tabs rendered smaller,
// lighter and in sentence case while every other surface's were the display-type
// uppercase strip. One class now, for all six.
//
// The active tab is a <strong>, not a link: there is nowhere to go from the page
// you are on, and a link that navigates to itself is a trap for anyone reading
// by keyboard. `aria-current="page"` is what carries that fact to a screen
// reader, and the CSS underline is what carries it to everyone else.

export function SubTabs({ strip }: { strip: SubTabStrip }) {
  return (
    <div className="subtabs">
      {strip.back && (
        <Link href={strip.back.href} className="comp-tab-back">
          {strip.back.label}
        </Link>
      )}
      {strip.items.map((item) =>
        item.key === strip.active ? (
          <strong key={item.key} aria-current="page">
            {item.label}
          </strong>
        ) : (
          <Link key={item.key} href={item.href}>
            {item.label}
          </Link>
        ),
      )}
    </div>
  );
}
