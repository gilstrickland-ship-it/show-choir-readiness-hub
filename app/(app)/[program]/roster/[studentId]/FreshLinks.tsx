import { guardianLinks } from "@/lib/tokens";

// The one-time display of a family's three links (§8a). Only the hash of a token
// is ever stored, so the raw value is knowable exactly once — at mint time, on
// the redirect that lands here. It is shown, copied, and never recoverable
// again, which is why the copy says so out loud.
//
// Two paths reach it: "Reset this family's links" (which revoked the old ones,
// so these are the only links that work), and "Send family links" on a
// deployment with no mail provider configured (append-only, so the family's
// earlier links still work too). The wording differs because the consequence
// does.

export function FreshLinks({
  token,
  emailedNoKey,
}: {
  token: string;
  emailedNoKey: boolean;
}) {
  const links = guardianLinks(token);
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
      <label className="stack">
        Itinerary link
        <input type="text" readOnly value={links.itinerary} aria-label="Itinerary link" />
      </label>
      <label className="stack">
        Volunteer signup link
        <input type="text" readOnly value={links.signup} aria-label="Volunteer signup link" />
      </label>
      <label className="stack">
        Report-an-absence link
        <input type="text" readOnly value={links.absence} aria-label="Report-an-absence link" />
      </label>
    </div>
  );
}
