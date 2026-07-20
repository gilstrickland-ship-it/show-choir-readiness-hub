import Link from "next/link";

// Sub-navigation for the comms surface (§7 redesign). Digest is the landing
// (/comms) — the AI draft awaiting approval plus recently-sent history and the
// staffing/deliverability asides. Announcements (/comms/announcements) is the
// immediate-send composer + full history. Shifts (/comms/shifts) is the
// volunteer roster, shown only when the `shifts` flag is on so a hidden feature
// never offers a dead link. Rendered with the shared `.subtabs` display-type
// underline strip (matches People/Money/Wardrobe/Settings).
export type CommsTab = "digest" | "announcements" | "shifts";

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
      <strong key={key} aria-current="page">{label}</strong>
    ) : (
      <Link key={key} href={href}>
        {label}
      </Link>
    );

  return (
    <div className="subtabs">
      {tab("digest", base, "Digest")}
      {tab("announcements", `${base}/announcements`, "Announcements")}
      {shiftsEnabled && tab("shifts", `${base}/shifts`, "Shifts")}
    </div>
  );
}
