import Link from "next/link";
import { brand } from "@/lib/brand";
import { parentSurfaceAvailable, type ResolvedToken } from "@/lib/tokens";
import { UNAVAILABLE_TITLE, UNAVAILABLE_MESSAGE } from "@/lib/public-token";

// Shared bits for the tokenized parent surface (§8a). The footer link list is on
// every page so parents learn one pattern; guardian pages get the family-only
// "report an absence" link, share (browse) pages do not — the guardian/share
// distinction is the token capability boundary and MUST NOT widen here. The
// caption reinforces that the link is personal (§10).
//
// The footer also drops any link whose feature this program has turned off
// (lib/tokens PARENT_SURFACE_FLAGS): the routes refuse on their own, so this is
// courtesy rather than security — but sending a parent to a page that can only
// say "not available" is a dead end nobody needs to walk into.

type Resolved = NonNullable<ResolvedToken>;

export function TokenFooter({
  token,
  resolved,
}: {
  token: string;
  resolved: Resolved;
}) {
  const base = `/t/${token}`;
  const kind = resolved.kind;
  const can = (surface: Parameters<typeof parentSurfaceAvailable>[1]) =>
    parentSurfaceAvailable(resolved.program, surface);

  return (
    <footer className="token-footer">
      {can("itinerary") && <Link href={`${base}/itinerary`}>Itinerary →</Link>}
      {can("signup") && (
        <Link href={`${base}/signup`}>Volunteer signup →</Link>
      )}
      {kind === "guardian" && can("absence") && (
        <Link href={`${base}/absence`}>Report an absence →</Link>
      )}
      {can("welcome") && (
        <Link href={`${base}?welcome=1`}>How this page works →</Link>
      )}
      <span className="token-footer-cap">
        {kind === "guardian"
          ? `${brand.name} · this link is personal to your family`
          : `${brand.name} · read-only shared link`}
      </span>
    </footer>
  );
}

// The calm refusal a VALID token gets when its program has that feature off
// (Constitution VIII, and the rule in lib/tokens). The footer stays, so the
// parent is one tap from whatever their program does share with families.
export function TokenUnavailable({
  token,
  resolved,
}: {
  token: string;
  resolved: Resolved;
}) {
  return (
    <section className="stack">
      <h1>{UNAVAILABLE_TITLE}</h1>
      <p className="muted">{UNAVAILABLE_MESSAGE}</p>
      <p className="muted">
        Your link still works — the links below go to everything else.
      </p>
      <TokenFooter token={token} resolved={resolved} />
    </section>
  );
}
