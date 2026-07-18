import Link from "next/link";

// Shared bits for the tokenized parent surface (§8a). The three-link footer is
// on every page so parents learn one pattern; guardian pages get the family-only
// "report an absence" link, share (browse) pages do not.

export function TokenFooter({
  token,
  kind,
}: {
  token: string;
  kind: "guardian" | "share";
}) {
  const base = `/t/${token}`;
  return (
    <footer
      style={{
        marginTop: "2rem",
        paddingTop: "1rem",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexWrap: "wrap",
        gap: "1rem",
        fontSize: "0.9rem",
      }}
    >
      <Link href={`${base}/itinerary`}>Itinerary</Link>
      <Link href={`${base}/signup`}>Volunteer signup</Link>
      {kind === "guardian" && <Link href={`${base}/absence`}>Report an absence</Link>}
    </footer>
  );
}
