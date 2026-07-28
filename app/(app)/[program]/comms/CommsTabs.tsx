import Link from "next/link";

// Sub-navigation for the comms surface (§7 redesign). The landing (/comms) is
// the "what needs attention" page — the digest's current state plus the
// staffing/deliverability/signup-link asides. Announcements
// (/comms/announcements) is the immediate-send composer + full history. Shifts
// (/comms/shifts) is the volunteer roster. Rendered with the shared `.subtabs`
// display-type underline strip (matches People/Money/Wardrobe/Settings).
//
// Every tab that has a flag behind it takes that flag as a REQUIRED prop: a
// hidden feature must never offer a link that 404s, and a default-true prop is
// how two of the five call sites came to advertise a digest their program can't
// draft. Required props make the compiler ask the question at every call site.
//
// When the `digest` flag is off (program tier prep), /comms stays reachable as a
// soft-gated overview — existing drafts remain reviewable — so the landing tab
// reads "Overview" rather than advertising a digest the program can't draft.
export type CommsTab = "digest" | "announcements" | "shifts";

export function CommsTabs({
  slug,
  active,
  digestEnabled,
  announcementsEnabled,
  shiftsEnabled,
}: {
  slug: string;
  active: CommsTab;
  digestEnabled: boolean;
  announcementsEnabled: boolean;
  shiftsEnabled: boolean;
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
      {tab("digest", base, digestEnabled ? "Digest" : "Overview")}
      {announcementsEnabled &&
        tab("announcements", `${base}/announcements`, "Announcements")}
      {shiftsEnabled && tab("shifts", `${base}/shifts`, "Shifts")}
    </div>
  );
}
