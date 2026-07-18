import Link from "next/link";

// Sub-navigation for the roster surface (Directory / Ensembles / Import / Size
// fields). The active tab renders as <strong> (no link), mirroring the
// settings-tabs idiom. Import + Size fields are director/admin-only surfaces, so
// those tabs are shown only when `canWrite`.
export type RosterTab = "directory" | "ensembles" | "import" | "settings";

export function RosterTabs({
  slug,
  active,
  canWrite,
}: {
  slug: string;
  active: RosterTab;
  canWrite: boolean;
}) {
  const tab = (key: RosterTab, href: string, label: string) =>
    active === key ? (
      <strong key={key} aria-current="page">{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="settings-tabs">
      {tab("directory", `/${slug}/roster`, "Directory")}
      {tab("ensembles", `/${slug}/roster/ensembles`, "Ensembles")}
      {canWrite && tab("import", `/${slug}/roster/import`, "Import")}
      {canWrite && tab("settings", `/${slug}/roster/settings`, "Size fields")}
    </div>
  );
}
