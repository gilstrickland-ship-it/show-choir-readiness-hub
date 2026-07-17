import Link from "next/link";

// Sub-navigation for a single competition (Overview / Attendance / Itinerary /
// Packet), mirroring the roster tabbed idiom. The active tab renders as <strong>.
export type CompetitionTab = "overview" | "attendance" | "itinerary" | "packet";

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
      <strong key={key}>{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="settings-tabs">
      {tab("overview", base, "Overview")}
      {tab("attendance", `${base}/attendance`, "Attendance")}
      {tab("itinerary", `${base}/itinerary`, "Itinerary")}
      {tab("packet", `${base}/packet`, "Packet")}
    </div>
  );
}
