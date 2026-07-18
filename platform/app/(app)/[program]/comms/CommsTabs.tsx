import Link from "next/link";

// Sub-navigation for the comms surface (§8): Announcements (immediate sends) and
// Digest (weekly AI draft/review — T025). Mirrors the settings/competition
// tabbed idiom; the active tab renders as <strong>.
export type CommsTab = "announcements" | "digest";

export function CommsTabs({
  slug,
  active,
}: {
  slug: string;
  active: CommsTab;
}) {
  const base = `/${slug}/comms`;
  return (
    <div className="settings-tabs">
      {active === "announcements" ? (
        <strong>Announcements</strong>
      ) : (
        <Link href={base}>Announcements</Link>
      )}
      {active === "digest" ? (
        <strong>Digest</strong>
      ) : (
        <Link href={`${base}/digest`}>Digest</Link>
      )}
    </div>
  );
}
