import Link from "next/link";

// The digest's state on the Comms landing (spec 005 US9-1) — a STATUS card and
// nothing more: where the week's digest stands, and one link to the one place
// that acts on it. Approve, discard, edit, send and history live in the
// workspace at /comms/digest and nowhere else, so a director never has to
// remember which of two pages holds the button.
//
// Constitution IV is why this card can only ever be a link: approving an
// AI-written message and sending it to every family are two deliberate human
// acts, taken where the whole draft is on screen and readable. A one-click
// "Approve & send" on a landing page — under a 280-character preview — is
// exactly the shape that principle forbids, and it is what this card replaces.

export type DigestState = "off" | "draft" | "approved" | "clear";

export function DigestStatus({
  slug,
  state,
  canManage,
  canCompose,
}: {
  slug: string;
  state: DigestState;
  // DIGEST_WRITE_ROLES (director/admin). Other comms seats read the state but
  // are not offered a workspace they cannot act in.
  canManage: boolean;
  // ANNOUNCEMENT_WRITE_ROLES *and* the `announcements` flag — the only case
  // where the digest-off card can honestly point at another way to reach
  // families right now.
  canCompose: boolean;
}) {
  const workspace = `/${slug}/comms/digest`;

  // Digest off (prep tier): unchanged behavior — a compact not-enabled card that
  // points at announcements as the sending tool. Comms is a soft gate, so we
  // don't 404; we just stop advertising a draft flow the program can't run.
  if (state === "off") {
    return (
      <div className="digest-card empty">
        <h2>Weekly digest</h2>
        <p className="muted">
          The weekly digest isn&apos;t enabled for this program.
          {canCompose
            ? " To reach families now, send an announcement — it goes out immediately."
            : ""}
        </p>
        {canCompose && (
          <Link
            href={`/${slug}/comms/announcements`}
            className="button-link secondary"
          >
            + New announcement
          </Link>
        )}
      </div>
    );
  }

  if (state === "draft") {
    return (
      <div className="digest-card">
        <div className="digest-card-head">
          <h2>Weekly digest</h2>
          <span className="chip warn">Draft — awaiting your approval</span>
        </div>
        <p className="muted">
          AI-drafted from this week&apos;s events, itinerary, and open shifts.
          Nothing reaches a family until you read it and approve it.
        </p>
        {canManage && (
          <Link href={workspace} className="button-link accent">
            Read it &amp; decide →
          </Link>
        )}
      </div>
    );
  }

  if (state === "approved") {
    return (
      <div className="digest-card">
        <div className="digest-card-head">
          <h2>Weekly digest</h2>
          <span className="chip">Approved — not sent yet</span>
        </div>
        <p className="muted">
          You&apos;ve approved this week&apos;s digest. It sits until someone
          sends it — it never goes out on its own.
        </p>
        {canManage && (
          <Link href={workspace} className="button-link accent">
            Open it to send →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="digest-card empty">
      <h2>Weekly digest</h2>
      <p className="muted">
        Nothing waiting. The weekly digest is AI-drafted for a director to read
        and approve — it never sends on its own.
      </p>
      {canManage && (
        <Link href={workspace} className="button-link secondary">
          Open the digest workspace →
        </Link>
      )}
    </div>
  );
}
