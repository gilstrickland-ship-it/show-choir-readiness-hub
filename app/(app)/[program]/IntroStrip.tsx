import Link from "next/link";
import {
  isStripCollapsed,
  setStripCollapsed,
  type GuideState,
  type StripSurfaceKey,
} from "@/lib/guide";

// Intro strips (spec 003 §3). A calm one-line orientation under the heading of
// the eight complex surfaces: what this screen is, plus one bolded "First:"
// action. Server component — its only interactivity is the "Got it" form posting
// to the guarded setStripCollapsed action (per-member state on
// program_members.guide_state). Voice: plain, warm, zero jargon; each strip is
// ≤2 sentences and never duplicates the page's own empty-state copy.
//
// Visibility is decided here from the member's stored state: shown when the strip
// is not collapsed, OR whenever the page is opened with ?help=1 (the re-trigger).
// The caller gates on the `guide` flag + a real membership before rendering, so a
// flag-off program, a support view, or a signed-out visitor never sees it.

interface StripCopy {
  // The "what this is" sentences (no jargon, ≤2 sentences).
  lead: string;
  // The single next action, rendered bolded after "First: ".
  first: string;
  // When true, the whole strip is editor coaching (its lead assumes you can act),
  // so it is hidden entirely from read-only viewers rather than shown lead-only.
  // Default (undefined): the lead is viewer-safe, so read-only viewers still see
  // it — only the "First:" imperative is dropped.
  hideForReadOnly?: boolean;
}

// The eight strips (spec §3). Copy held here beside the component that renders it.
const STRIP_COPY: Record<StripSurfaceKey, StripCopy> = {
  treasury: {
    lead: "Every dollar in or out is one line here — nothing is ever deleted; a mistake is voided and re-entered, and the whole board can see the books.",
    first: "add today's most recent transaction.",
  },
  budget: {
    lead: "This is your season's plan — your own income and expense categories, each with a planned amount that the ledger is measured against.",
    first:
      "sketch your big expenses first; costumes, travel, and choreography are the usual three.",
  },
  itinerary_editor: {
    lead: "This schedule is the one families see. Publish it once, then keep it current — any change reaches their phones the moment you save.",
    first: "add the call time, then build out the rest of the day.",
    // Lead is written to the editor ("Publish it once", "the moment you save"),
    // so a read-only viewer sees nothing here rather than a half-relevant note.
    hideForReadOnly: true,
  },
  packet_review: {
    lead: "The AI read the host's packet and drafted these times for you to check. Nothing reaches a family until you accept them and publish the itinerary.",
    first:
      "compare each row to the source on the left and fix anything flagged.",
  },
  trip: {
    lead: "Load buses and rooms by tapping a student onto a group; counts and capacity fill in as you go, and deactivating a student frees their seat automatically.",
    first:
      "add your buses — and rooms, if it's an overnight — then start placing students.",
  },
  hosting_event: {
    lead: "Everything to run your own invitational lives here — visiting schools, the running order, and the day-of documents that print straight from it.",
    first: "add each visiting school, then generate the schedule from them.",
  },
  import: {
    lead: "Bring the spreadsheet you already have. Charms and CutTime exports work as-is, and any health or medical column is refused automatically.",
    first: "choose your file and check the preview before anything saves.",
  },
  digest: {
    lead: "The AI drafts a weekly note to families from what actually happened. You read, edit, and approve it — nothing sends on its own.",
    first:
      "draft this week, then edit it to sound like you before you approve.",
  },
};

// A small "?" affordance that sits beside the page heading and re-opens the strip
// (?help=1) even after it's been dismissed. Rendered by each page next to its h1.
export function HelpDot({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="help-dot"
      title="What is this page?"
      aria-label="What is this page?"
    >
      ?
    </Link>
  );
}

export function IntroStrip({
  surfaceKey,
  programId,
  selfPath,
  guideState,
  help,
  canWrite = true,
}: {
  surfaceKey: StripSurfaceKey;
  programId: string;
  // The page's own clean path (no querystring) — where "Got it" returns to.
  selfPath: string;
  guideState: GuideState;
  // True when the page was opened with ?help=1 (forces the strip, never clears
  // stored state).
  help: boolean;
  // Whether the viewer can act on this surface (reuses each page's own
  // role-based write check). Read-only viewers never see the "First:" imperative;
  // editor-coaching strips (hideForReadOnly) hide entirely. Defaults to true so
  // callers that don't pass it keep the full editor strip.
  canWrite?: boolean;
}) {
  const collapsed = isStripCollapsed(guideState, surfaceKey);
  if (collapsed && !help) return null;

  const copy = STRIP_COPY[surfaceKey];
  // A read-only viewer never sees editor coaching: strips whose lead assumes you
  // can act hide outright; the rest keep their viewer-safe lead but drop the
  // "First:" action they cannot take.
  if (!canWrite && copy.hideForReadOnly) return null;
  return (
    <div className="intro-strip">
      <p className="intro-strip-copy">
        {copy.lead}
        {canWrite && (
          <>
            {" "}
            <strong>First: {copy.first}</strong>
          </>
        )}
      </p>
      <form action={setStripCollapsed} className="intro-strip-dismiss">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="key" value={surfaceKey} />
        <input type="hidden" name="redirectTo" value={selfPath} />
        <button type="submit" className="button-link secondary">
          Got it
        </button>
      </form>
    </div>
  );
}
