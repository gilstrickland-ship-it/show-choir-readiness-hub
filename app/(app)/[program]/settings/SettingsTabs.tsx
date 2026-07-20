import Link from "next/link";

// Sub-navigation for the Settings surface (§8 redesign). Four tabs — Program /
// Members / Seasons / Export & Data — mapping to the existing routes (Seasons is
// the season-rollover page). Rendered with the shared `.subtabs` display-type
// underline strip (matches Comms/People/Money/Wardrobe). Every settings page
// renders this so the active tab always highlights consistently.
export type SettingsTab = "program" | "members" | "seasons" | "export";

export function SettingsTabs({
  slug,
  active,
}: {
  slug: string;
  active: SettingsTab;
}) {
  const base = `/${slug}/settings`;
  const tab = (key: SettingsTab, href: string, label: string) =>
    active === key ? (
      <strong key={key} aria-current="page">{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="subtabs">
      {tab("program", base, "Program")}
      {tab("members", `${base}/members`, "Members")}
      {tab("seasons", `${base}/rollover`, "Seasons")}
      {tab("export", `${base}/export`, "Export & Data")}
    </div>
  );
}
