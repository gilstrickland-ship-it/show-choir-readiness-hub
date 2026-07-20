import Link from "next/link";

// Sub-navigation for the treasury surface (Ledger / Budget / Budget vs Actual /
// Reports). Active tab renders as <strong> (no link), mirroring RosterTabs /
// CostumeTabs. Every tab is read-visible to all TREASURY_ROLES (board_member
// reads); write controls inside each page gate on canWrite (treasurer only).
export type TreasuryTab = "ledger" | "budget" | "bva" | "reports";

export function TreasuryTabs({
  slug,
  active,
}: {
  slug: string;
  active: TreasuryTab;
}) {
  const tab = (key: TreasuryTab, href: string, label: string) =>
    active === key ? (
      <strong key={key} aria-current="page">{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="subtabs">
      {tab("ledger", `/${slug}/treasury`, "Ledger")}
      {tab("budget", `/${slug}/treasury/budget`, "Budget")}
      {tab("bva", `/${slug}/treasury/budget-vs-actual`, "Budget vs Actual")}
      {tab("reports", `/${slug}/treasury/reports`, "Reports")}
    </div>
  );
}
