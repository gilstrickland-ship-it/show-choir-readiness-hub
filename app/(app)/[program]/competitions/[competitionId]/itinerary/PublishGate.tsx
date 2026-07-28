import Link from "next/link";
import { publishItinerary, unpublishItinerary } from "./actions";

// The parent-visibility gate (invariant §9.3), unchanged in behaviour and moved
// here whole so the page stops being 600 lines (spec 005 T156 / RQ-6b).
//
// Two facts this component exists to keep true:
//
//   1. PUBLISHING IS CONFIRMED. The button is a link to `?confirm=publish`,
//      which renders a box saying what publishing costs; only that box holds a
//      form that posts. Nothing here can publish in one tap.
//   2. PUBLISHING IS NOT A FREEZE. A published itinerary stays editable in
//      place (T055) — schedules drift on competition day — so the only thing
//      publish changes is whether families can see it. The line under the
//      button says so, because "live" is the part that surprises people.

export function PublishGate({
  programId,
  slug,
  competitionId,
  itineraryId,
  status,
  confirmPublish,
  canAnnounce,
  selfHref,
}: {
  programId: string;
  slug: string;
  competitionId: string;
  itineraryId: string;
  status: "draft" | "published";
  // `?confirm=publish` — the second step, and the only one that can post.
  confirmPublish: boolean;
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
          <p>
            Publish this itinerary? Families see it immediately, and it stays
            live — any edit you save later reaches them right away. Publishing
            also unlocks packet generation.
          </p>
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
