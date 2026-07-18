import Link from "next/link";

// Sub-navigation for the costume surface (Inventory / Sets / Assignments /
// Alterations / Checkout). Active tab renders as <strong> (no link), mirroring
// the RosterTabs idiom. All five tabs are read-visible to every costume role
// (board_member reads); write controls inside each page gate on canWrite.
export type CostumeTab =
  | "inventory"
  | "sets"
  | "assignments"
  | "quick-change"
  | "alterations"
  | "checkout";

export function CostumeTabs({
  slug,
  active,
}: {
  slug: string;
  active: CostumeTab;
}) {
  const tab = (key: CostumeTab, href: string, label: string) =>
    active === key ? (
      <strong key={key}>{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="settings-tabs">
      {tab("inventory", `/${slug}/costumes`, "Inventory")}
      {tab("sets", `/${slug}/costumes/sets`, "Sets")}
      {tab("assignments", `/${slug}/costumes/assignments`, "Assignments")}
      {tab("quick-change", `/${slug}/costumes/quick-change`, "Quick change")}
      {tab("alterations", `/${slug}/costumes/alterations`, "Alterations")}
      {tab("checkout", `/${slug}/costumes/checkout`, "Checkout")}
    </div>
  );
}
