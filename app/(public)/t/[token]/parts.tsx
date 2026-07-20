import Link from "next/link";
import { brand } from "@/lib/brand";

// Shared bits for the tokenized parent surface (§8a). The footer link list is on
// every page so parents learn one pattern; guardian pages get the family-only
// "report an absence" link, share (browse) pages do not — the guardian/share
// distinction is the token capability boundary and MUST NOT widen here. The
// caption reinforces that the link is personal (§10).

export function TokenFooter({
  token,
  kind,
}: {
  token: string;
  kind: "guardian" | "share";
}) {
  const base = `/t/${token}`;
  return (
    <footer className="token-footer">
      <Link href={`${base}/itinerary`}>Itinerary →</Link>
      <Link href={`${base}/signup`}>Volunteer signup →</Link>
      {kind === "guardian" && (
        <Link href={`${base}/absence`}>Report an absence →</Link>
      )}
      <span className="token-footer-cap">
        {kind === "guardian"
          ? `${brand.name} · this link is personal to your family`
          : `${brand.name} · read-only shared link`}
      </span>
    </footer>
  );
}
