import Link from "next/link";
import type { ReactNode } from "react";
import type { MintableShareResource } from "@/lib/tokens";

// The app's ONE mint/rotate card for a broadcast share link (spec 005 Wave 8 /
// T142). Three surfaces mint one — the season calendar, a published itinerary,
// the open-shifts page — and each carried its own ~40-line copy of the same
// three-state block: the URL you can only see now, the link that is already
// live, the link that does not exist yet.
//
// The privacy flow is the reason this block is shaped the way it is, and it is
// preserved exactly. Tokens are stored as a hash and nothing else, so the raw
// URL is knowable at exactly one moment — the instant it is minted — and it
// rides back on the redirect to be shown once. There is no "show me the link
// again": rotating is the only way to get a copyable URL, and rotating retires
// the old one. Every state below says so in the words its surface already used,
// because a director reading "regenerate" needs to know what it costs.
//
// What is shared is the SHAPE; the words stay per-resource, in the map below,
// so a calendar feed can explain Google and Apple while a signup page explains
// that parents claim shifts from their own family link and not from this one.

interface ShareLinkCopy {
  // The card's heading, or null when its container already titles it (the
  // season page's "📅 Subscribe in your calendar" disclosure).
  title: string | null;
  // The one-time view: intro copy plus however many URLs this resource hands
  // back (the calendar feed hands back two — the same feed as https and webcal).
  fresh: (subject: string, urls: string[]) => ReactNode;
  // A link is already live and its URL is gone for good.
  live: (subject: string, settingsHref: string) => ReactNode;
  // No link yet — the pitch for making one.
  none: ReactNode;
  // The button, before and after there is a live link.
  makeLabel: string;
  rotateLabel: string;
}

// A one-time URL, shown in the same monospace-ish block on all three surfaces.
function ShareUrl({ url }: { url: string }) {
  return <code style={{ wordBreak: "break-all" }}>{url}</code>;
}

const COPY: Record<MintableShareResource, ShareLinkCopy> = {
  season_calendar: {
    title: null,
    fresh: (subject, urls) => (
      <>
        <p className="muted">
          A live calendar feed of {subject} — every competition, event, and trip.
          Copy it now (for privacy the URL is shown only this once). It stays
          current all season — new comps and time changes appear automatically.
        </p>
        <p className="muted">
          <strong>Google Calendar:</strong> use the https link (Other calendars →
          From URL).
        </p>
        <ShareUrl url={urls[0]} />
        <p className="muted">
          <strong>Apple Calendar:</strong> the webcal link opens Subscribe
          directly.
        </p>
        <ShareUrl url={urls[1]} />
      </>
    ),
    live: (subject, settingsHref) => (
      <p className="muted">
        A season calendar link is active for {subject}. For privacy the URL is
        only shown once at creation — regenerate to get a fresh copyable link
        (the old one stops working). Active links are listed in{" "}
        <Link href={settingsHref}>Settings → Share links</Link>.
      </p>
    ),
    none: (
      <p className="muted">
        Create a live calendar feed of the whole season. Paste it into Google
        Calendar (<strong>Other calendars → From URL</strong>) or Apple Calendar
        — it updates itself as the season changes, so you never re-enter a date.
      </p>
    ),
    makeLabel: "Create calendar link",
    rotateLabel: "Regenerate calendar link",
  },

  itinerary: {
    title: "Broadcast link",
    fresh: (_subject, urls) => (
      <>
        <p className="muted">
          A read-only link to this itinerary — copy it now (for privacy the URL
          is shown only this once):
        </p>
        <ShareUrl url={urls[0]} />
      </>
    ),
    live: (_subject, settingsHref) => (
      <p className="muted">
        A broadcast link is active for this itinerary. For your privacy the URL
        is only shown once at creation — regenerate to get a fresh copyable link
        (the old one stops working). Active links are listed in{" "}
        <Link href={settingsHref}>Settings → Share links</Link>.
      </p>
    ),
    none: (
      <p className="muted">
        No broadcast link yet. Generate a read-only link to share this itinerary
        with anyone.
      </p>
    ),
    makeLabel: "Create broadcast link",
    rotateLabel: "Regenerate broadcast link",
  },

  signup_page: {
    title: "Open shifts anyone can browse",
    fresh: (subject, urls) => (
      <>
        <p className="muted">
          One page listing the open shifts for {subject}, that anyone with the
          link can read. Copy it now — for privacy the URL is shown only this
          once (parents claim shifts from their own family link, not from here):
        </p>
        <ShareUrl url={urls[0]} />
      </>
    ),
    live: (subject, settingsHref) => (
      <p className="muted">
        A link is live for {subject}. The URL is only shown once, when it&apos;s
        made — make a new one to get a copyable link again (the old one stops
        working). Live links are listed in{" "}
        <Link href={settingsHref}>Settings → Share links</Link>.
      </p>
    ),
    none: (
      <p className="muted">
        No link yet. Make one and anyone you send it to can read this
        season&apos;s open shifts — a booster newsletter, a class group.
      </p>
    ),
    makeLabel: "Make the link",
    rotateLabel: "Make a new link",
  },
};

export function ShareLinkCard({
  resource,
  programId,
  slug,
  subject,
  resourceIdField,
  action,
  liveCount,
  freshUrls,
  message,
}: {
  resource: MintableShareResource;
  programId: string;
  slug: string;
  // What the link is OF, in the surface's own words — a season label, mostly.
  // The resources whose copy doesn't name it ignore it.
  subject: string;
  // The id the mint action needs, under the field name that action reads.
  resourceIdField: { name: string; value: string };
  // The surface's own mint/rotate server action. Each resource has exactly one,
  // and it lives with the surface that owns the resource — this card renders the
  // form, it does not decide who may mint.
  action: (formData: FormData) => Promise<void>;
  // How many links are live for this resource right now. Metadata only: the
  // URLs are not knowable, which is the whole point.
  liveCount: number;
  // The freshly minted URL(s), knowable only on the redirect that follows a
  // mint. Empty/absent every other time.
  freshUrls?: readonly string[] | null;
  // A section-local message (the calendar card's mint failures), rendered above
  // the states so it lands inside the card that produced it.
  message?: ReactNode;
}) {
  const copy = COPY[resource];
  const live = liveCount > 0;
  const fresh = freshUrls && freshUrls.length > 0 ? [...freshUrls] : null;
  const settingsHref = `/${slug}/settings`;

  return (
    <div className="confirm-box stack share-link-card">
      {message}
      {copy.title && <h2>{copy.title}</h2>}
      {fresh
        ? copy.fresh(subject, fresh)
        : live
          ? copy.live(subject, settingsHref)
          : copy.none}
      <form action={action}>
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="slug" value={slug} />
        <input
          type="hidden"
          name={resourceIdField.name}
          value={resourceIdField.value}
        />
        <button type="submit" className="secondary">
          {live ? copy.rotateLabel : copy.makeLabel}
        </button>
      </form>
    </div>
  );
}
