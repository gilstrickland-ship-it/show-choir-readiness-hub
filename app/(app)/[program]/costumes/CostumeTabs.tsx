import Link from "next/link";

// Wardrobe sub-navigation — the costume manager's four real jobs, in the order
// the job happens: keep the inventory, decide who wears what, get it altered,
// hand it out on comp day (spec 005 US13).
//
// It was six. "Sets" and "Assignments" were two halves of one job — a set is
// just the grouping assignments hang off — so sets CRUD moved onto Assignments,
// and "Quick change" was never a place you go to DO something: it is a sheet you
// print, so it hangs off Checkout, where comp day actually starts.
//
// Alterations is the landing (it lives at /costumes) because it is the queue
// this seat works every week. Active tab renders as <strong> (no link),
// mirroring the RosterTabs idiom. All four are read-visible to every costume
// role (board_member reads); write controls gate on canWrite.
export type CostumeTab =
  | "inventory"
  | "assignments"
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
      {tab("inventory", `/${slug}/costumes/inventory`, "Inventory")}
      {tab("assignments", `/${slug}/costumes/assignments`, "Assignments")}
      {tab("alterations", `/${slug}/costumes`, "Alterations")}
      {tab("checkout", `/${slug}/costumes/checkout`, "Checkout")}
    </div>
  );
}
