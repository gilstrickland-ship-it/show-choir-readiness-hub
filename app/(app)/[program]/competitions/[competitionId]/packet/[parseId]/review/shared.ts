import { flashSection, type FlashMap } from "@/lib/flash";

// The packet-review screen's URL contract, in the app's one flash idiom
// (lib/flash). It had none: every refusal in ./actions redirected here with
// `?error=itinerary`, and this page rendered no message at all — so a director
// whose accept was refused watched the screen reload unchanged and pressed the
// button again.
//
// One message area (the page), because there is one control.

export type ReviewSection = "page";

export type ReviewErrorKey = "itinerary" | "confirm";

const REVIEW_ERROR: FlashMap<ReviewErrorKey, ReviewSection> = {
  itinerary: {
    section: "page",
    message:
      "Couldn't apply this to the competition's itinerary. Reload the page and try again.",
  },
  // The published-itinerary gate below. Reached by a post that did not carry the
  // confirm — which, since the checkbox is `required`, means the form was not
  // the one this screen rendered.
  confirm: {
    section: "page",
    message:
      "This itinerary is already published, so accepting changes what families see immediately. Tick the confirmation before accepting.",
  },
};

export const REVIEW_FLASH_MAPS = {
  error: REVIEW_ERROR,
  fallbackSection: "page" as const,
};

export function reviewErrorSection(key: ReviewErrorKey): ReviewSection {
  return flashSection(REVIEW_ERROR, key);
}

// The value the confirm checkbox posts when the itinerary is already published.
// A constant rather than a literal in two files: the screen that ASKS and the
// action that REQUIRES it are the two halves of one human-approval boundary
// (Constitution IV), and a typo in either would silently open it.
export const ACCEPT_LIVE_CONFIRM = "live";
