import Link from "next/link";

// Sub-navigation for the heavy full-list editing routes under a competition
// (Attendance / Itinerary / Meals / Packet). Since the season-workflow redesign
// the competition landing page is a one-page command center (no tabs); these
// routes hold the deep editing flows and get a "← Comp week" link back to it
// plus tabs to move between one another. The active tab renders as <strong>.
export type CompetitionTab =
  | "attendance"
  | "itinerary"
  | "meals"
  | "packet";

export function CompetitionTabs({
  slug,
  competitionId,
  active,
}: {
  slug: string;
  competitionId: string;
  active: CompetitionTab;
}) {
  const base = `/${slug}/competitions/${competitionId}`;
  const tab = (key: CompetitionTab, href: string, label: string) =>
    active === key ? (
      <strong key={key} aria-current="page">
        {label}
      </strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="settings-tabs">
      <Link href={base} className="comp-tab-back">
        ← Comp week
      </Link>
      {tab("attendance", `${base}/attendance`, "Attendance")}
      {tab("itinerary", `${base}/itinerary`, "Itinerary")}
      {tab("meals", `${base}/meals`, "Meals")}
      {tab("packet", `${base}/packet`, "Packet")}
    </div>
  );
}
