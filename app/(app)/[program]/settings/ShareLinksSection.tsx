import type { PageFlash } from "@/lib/flash";
import { SHARE_RESOURCE_LABELS, type ActiveShareLink } from "@/lib/tokens";
import { formatDateInTz } from "@/lib/datetime";
import { Flash } from "../Flash";
import { revokeShareLinkAction } from "./actions";
import { SETTINGS_ANCHOR, type SettingsSection } from "./shared";

// Settings § Share links (FR-002 / §8a; spec 005 Wave 13 / T164) — every
// read-only broadcast URL this program has handed out, and the one control that
// takes one back.
//
// The vocabulary is ShareLinkCard's, deliberately: that card is where a link is
// MADE (an itinerary, a season's volunteer signup, the season calendar feed) and
// it tells the director "the URL is only shown once at creation — regenerate to
// get a fresh copyable link (the old one stops working). Active links are listed
// in Settings → Share links." This is that list, so it says the same thing in
// the same words rather than inventing a second explanation of the same rule.
//
// Tokens are stored as a hash and nothing else, so a URL is knowable at exactly
// one moment — the instant it is minted. That is why this page lists metadata
// and never a link: there is no "show it to me again" to build.
//
// Revoking is one click and takes effect immediately. It sits in `.table-action`
// so it is pinned to the right edge of the scroll port on a phone rather than
// starting several hundred pixels into a table nobody has scrolled (T143b).

export function ShareLinksSection({
  programId,
  slug,
  tz,
  flash,
  links,
  unavailable,
  labelFor,
}: {
  programId: string;
  slug: string;
  tz: string;
  flash: PageFlash<SettingsSection>;
  links: ActiveShareLink[];
  // The listing having FAILED, which is not the same fact as an empty listing:
  // "Nothing is shared right now. Anyone outside your staff sees nothing" is a
  // privacy assurance, and it must never be made out of a read that did not
  // happen (lib/tokens activeShareLinks).
  unavailable: boolean;
  // What the link is OF — a competition name, a season label — resolved by the
  // page, which is the half that can query.
  labelFor: (link: ActiveShareLink) => string | null;
}) {
  const summary = unavailable
    ? "Couldn't be read"
    : links.length === 0
      ? "None handed out"
      : `${links.length} live link${links.length === 1 ? "" : "s"}`;

  return (
    <section id={SETTINGS_ANCHOR.share} className="panel stack">
      <div className="travel-section-head">
        <h2>Share links</h2>
        <span className="travel-section-summary">{summary}</span>
      </div>
      <Flash flash={flash} section="share" />
      <p className="muted">
        Read-only links you have handed out — a competition&apos;s times, a
        season&apos;s open shifts, a calendar feed. Anyone with one can open it
        with no login. Each opens only the thing it is named after: an itinerary
        link shows the schedule and nothing else — never the parent packet, which
        lists students against bus and room assignments and is only ever reachable
        from a family&apos;s own personal link.
      </p>
      <p className="muted">
        For privacy a link&apos;s URL is shown only once, when it is made, so it
        can&apos;t be listed here; make a new one from the itinerary, shifts or
        season page to get a copyable URL again. Revoking a link here makes its
        URL stop working immediately.
      </p>

      {unavailable ? (
        <p className="alert-error">
          The list of live links couldn&apos;t be read just now. This is not the
          same as there being none — reload before you rely on it.
        </p>
      ) : links.length === 0 ? (
        <p className="muted">
          Nothing is shared right now. Anyone outside your staff sees nothing
          until you make a link.
        </p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>Link</th>
              <th>Made</th>
              <th>Stops working</th>
              <th className="table-action">
                <span className="muted">Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => {
              const subject = labelFor(l);
              const kind = SHARE_RESOURCE_LABELS[l.resource] ?? l.resource;
              return (
                <tr key={l.id}>
                  <td>
                    {kind}
                    {subject ? <span className="muted"> · {subject}</span> : null}
                  </td>
                  <td className="muted">{formatDateInTz(l.created_at, tz)}</td>
                  <td className="muted">
                    {l.expires_at ? formatDateInTz(l.expires_at, tz) : "Never"}
                  </td>
                  <td className="table-action">
                    <form action={revokeShareLinkAction}>
                      <input type="hidden" name="programId" value={programId} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="shareLinkId" value={l.id} />
                      <button
                        type="submit"
                        className="linklike danger"
                        aria-label={`Revoke the ${kind.toLowerCase()} link${
                          subject ? ` for ${subject}` : ""
                        }`}
                      >
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
