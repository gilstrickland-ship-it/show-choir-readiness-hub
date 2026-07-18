import Link from "next/link";

// Sub-navigation for the comms surface (§8): Announcements (immediate sends),
// Shifts (volunteer signups — T024), and Digest (weekly AI draft/review — T025).
// Mirrors the settings/competition tabbed idiom; the active tab renders as
// <strong>. The Shifts tab shows only when the `shifts` flag is on for the
// program (`shiftsEnabled`), so a hidden feature never offers a dead link.
export type CommsTab = "announcements" | "shifts" | "digest";

export function CommsTabs({
  slug,
  active,
  shiftsEnabled = true,
}: {
  slug: string;
  active: CommsTab;
  shiftsEnabled?: boolean;
}) {
  const base = `/${slug}/comms`;
  const tab = (key: CommsTab, href: string, label: string) =>
    active === key ? (
      <strong key={key}>{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="settings-tabs">
      {tab("announcements", base, "Announcements")}
      {shiftsEnabled && tab("shifts", `${base}/shifts`, "Shifts")}
      {tab("digest", `${base}/digest`, "Digest")}
    </div>
  );
}
