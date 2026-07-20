import Link from "next/link";

// Sub-navigation for the Wardrobe surface (Alterations / Inventory / Sets /
// Assignments / Quick change / Checkout). Alterations is the landing tab (lives
// at /costumes); Inventory moved to /costumes/inventory. Active tab renders as
// <strong> (no link), mirroring the RosterTabs idiom. All tabs are read-visible
// to every costume role (board_member reads); write controls gate on canWrite.
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
      <strong key={key} aria-current="page">{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="subtabs">
      {tab("alterations", `/${slug}/costumes`, "Alterations")}
      {tab("inventory", `/${slug}/costumes/inventory`, "Inventory")}
      {tab("sets", `/${slug}/costumes/sets`, "Sets")}
      {tab("assignments", `/${slug}/costumes/assignments`, "Assignments")}
      {tab("quick-change", `/${slug}/costumes/quick-change`, "Quick change")}
      {tab("checkout", `/${slug}/costumes/checkout`, "Checkout")}
    </div>
  );
}
