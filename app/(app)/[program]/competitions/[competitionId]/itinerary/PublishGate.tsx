import Link from "next/link";
import { publishItinerary, unpublishItinerary } from "./actions";

// The parent-visibility gate (invariant §9.3), unchanged in behaviour and moved
// here whole so the page stops being 600 lines (spec 005 T156 / RQ-6b).
//
// Three facts this component exists to keep true:
//
//   1. PUBLISHING IS CONFIRMED. The button is a link to `?confirm=publish`,
//      which renders a box saying what publishing costs; only that box holds a
//      form that posts. Nothing here can publish in one tap.
//   2. PUBLISHING IS NOT A FREEZE. A published itinerary stays editable in
//      place (T055) — schedules drift on competition day — so the only thing
//      publish changes is whether families can see it. The line under the
//      button says so, because "live" is the part that surprises people.
//   3. PUBLISHING MAKES A PUBLIC URL. publishItinerary auto-mints a broadcast
//      share link (actions.ts) — a page anyone can open with no login, no
//      account, no invitation. The confirm box never said so: a director could
//      publish believing they had flipped a switch for families and not know a
//      public address now existed. It says all three things now — who can see
//      it, what gets created, and exactly what that address opens — because a
//      confirmation that omits the irreversible half is not a confirmation.

export function PublishGate({
  programId,
  slug,
  competitionId,
  itineraryId,
  status,
  confirmPublish,
  canAnnounce,
  hasLiveShareLink,
  selfHref,
}: {
  programId: string;
  slug: string;
  competitionId: string;
  itineraryId: string;
  status: "draft" | "published";
  // `?confirm=publish` — the second step, and the only one that can post.
  confirmPublish: boolean;
  // Is a broadcast link ALREADY live for this competition? publishItinerary
  // mints one only when none is (actions.ts), and unpublishing does not revoke
  // the old one — so "a public address is created" is true in one case and
  // "the one you already have stays live" in the other. The confirm box must
  // say whichever is actually about to happen.
  hasLiveShareLink: boolean;
  // Does /comms/announcements actually exist for this program? Both flags gate
  // it (spec 005 US9-4), and a nudge that sends a director to a 404 is worse
  // than no nudge at all.
  canAnnounce: boolean;
  selfHref: string;
}) {
  const hidden = (
    <>
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="itineraryId" value={itineraryId} />
    </>
  );

  if (status === "published") {
    return (
      <div className="stack">
        <p className="muted">
          This itinerary is live to families — anything you save shows on their
          page immediately.
          {canAnnounce ? " Send an announcement if a time moves." : ""}
        </p>
        {hasLiveShareLink && (
          <p className="muted">
            Unpublishing also blanks the public broadcast link: the address keeps
            resolving, but it stops showing these times. Revoke it in Settings →
            Share links to kill the address itself.
          </p>
        )}
        <form action={unpublishItinerary}>
          {hidden}
          <button type="submit" className="secondary">
            Unpublish (back to a draft)
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="stack">
      {confirmPublish ? (
        <div className="stack confirm-box">
          <p>Publish this itinerary? Three things happen:</p>
          <ul>
            <li>
              Families see these times immediately on their own link, and it
              stays live — any edit you save later reaches them right away.
            </li>
            <li>
              {hasLiveShareLink ? (
                <>
                  The <strong>public web address</strong> you already made for
                  this schedule keeps working
                </>
              ) : (
                <>
                  A <strong>public web address</strong> is created for this
                  schedule
                </>
              )}{" "}
              — anyone you send it to can open it with no login. It shows the
              times only: it does not open the parent packet, so no bus, room or
              volunteer names travel with it. Revoke it any time in Settings →
              Share links.
            </li>
            <li>
              The parent packet can be generated, and families can download it
              from their own personal link.
            </li>
          </ul>
          <form action={publishItinerary} className="row-inline">
            {hidden}
            <button type="submit">Confirm publish</button>
            <Link href={selfHref}>Cancel</Link>
          </form>
        </div>
      ) : (
        <>
          <p className="muted">
            Nobody outside your staff can see these times yet.
          </p>
          <p>
            <Link
              href={`${selfHref}?confirm=publish`}
              className="button-link accent"
            >
              Publish itinerary…
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
