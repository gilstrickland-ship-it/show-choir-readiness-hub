import { guardianLinks } from "@/lib/tokens";
import type { FlaggableProgram } from "@/lib/flags";

// The one-time display of a family's links (§8a). Only the hash of a token is
// ever stored, so the raw value is knowable exactly once — at mint time, on the
// redirect that lands here. It is shown, copied, and never recoverable again,
// which is why the copy says so out loud.
//
// Two paths reach it: "Reset this family's links" (which revoked the old ones,
// so these are the only links that work), and "Send family links" on a
// deployment with no mail provider configured (append-only, so the family's
// earlier links still work too). The wording differs because the consequence
// does.
//
// The list is whatever this program has turned on, for the same reason the
// emailed footer is (lib/tokens guardianLinks): handing staff a URL to copy into
// a message to a family, when the page behind it can only say "not available",
// wastes both their time.

export function FreshLinks({
  token,
  program,
  emailedNoKey,
}: {
  token: string;
  program: FlaggableProgram;
  emailedNoKey: boolean;
}) {
  const { links } = guardianLinks(token, program);

  // Every family page off — there is no link to hand over at all, and a box that
  // says "copy each link below" above nothing is worse than saying so.
  if (links.length === 0) {
    return (
      <div className="confirm-box stack" style={{ width: "100%" }}>
        <strong>No family links to copy.</strong>
        <p className="muted">
          This program has no family pages turned on, so a family link has
          nowhere to go. The family&apos;s links start working again as soon as
          one is turned back on.
        </p>
      </div>
    );
  }

  return (
    <div className="confirm-box stack" style={{ width: "100%" }}>
      <strong>
        {emailedNoKey
          ? "Family links ready (email not sent)."
          : "Family links ready."}
      </strong>
      <p className="muted">
        {emailedNoKey
          ? "Email isn't set up for this deployment, so nothing was sent. Copy each link below into a message to the family — they work now, and any links the family already had still work too."
          : "These links appear once. Copy each one into a message to the family — they work now, and they replaced every link previously emailed to this family."}
      </p>
      {links.map((link) => (
        <label className="stack" key={link.surface}>
          {link.label} link
          <input
            type="text"
            readOnly
            value={link.url}
            aria-label={`${link.label} link`}
          />
        </label>
      ))}
    </div>
  );
}
