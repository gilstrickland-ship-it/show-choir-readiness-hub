import type { FlashMap } from "@/lib/flash";

// The events surface's URL contract (spec 005 Wave 11 / T159), written the way
// every other surface writes one since T142: one `?ok=` and one `?error=`, each
// key naming the section that owns the message, resolved through lib/flash's
// prototype-safe lookup.
//
// What it replaces: the calendar declared `?created=<n>` plus five `?error=`
// branches rendered in a pile under the page title, and the detail page
// declared `?saved` plus four more of its own — ten hand-rolled render branches
// across two files, none of them beside the form that produced them. The count
// went with them: a repeat's twelve new events are on the calendar a line below
// the message, so the message does not need to say twelve (the same reasoning
// that retired host-mode's `?shifted=20&dir=later`).

// ---------------------------------------------------------------------------
// Calendar page. One message area: the add panel, which is where every write
// this page can make comes from.
// ---------------------------------------------------------------------------

export type EventsSection = "add";

export type EventsOkKey = "created" | "created_repeat";

// `starts` is emitted by createEvent for BOTH of its callers now. An event with
// no start time renders on neither the calendar nor the season spine, so a
// start is what makes an event findable at all — the Season drawer already
// required one, and this page allowing it was how you added an event and then
// could not find it anywhere.
export type EventsErrorKey =
  | "title"
  | "starts"
  | "season"
  | "dates"
  | "ensemble"
  | "save";

const EVENTS_OK: FlashMap<EventsOkKey, EventsSection> = {
  created: { section: "add", message: "Event added." },
  created_repeat: {
    section: "add",
    message:
      "Added every week you asked for. Each one is its own event you can change or delete.",
  },
};

const EVENTS_ERROR: FlashMap<EventsErrorKey, EventsSection> = {
  title: { section: "add", message: "An event needs a title." },
  starts: { section: "add", message: "An event needs a start date and time." },
  season: {
    section: "add",
    message: "Start your season before adding events.",
  },
  dates: { section: "add", message: "The end time is before the start." },
  ensemble: {
    section: "add",
    message: "Pick who this event is for from the groups listed.",
  },
  save: { section: "add", message: "Couldn't save. Try again." },
};

export const EVENTS_FLASH_MAPS = { ok: EVENTS_OK, error: EVENTS_ERROR } as const;

// ---------------------------------------------------------------------------
// One event's page. Two message areas, because it holds two different kinds of
// write: changing the event, and deleting it.
// ---------------------------------------------------------------------------

export type EventSection = "details" | "danger";

export type EventOkKey = "saved";

export type EventErrorKey =
  | "title"
  | "dates"
  | "ensemble"
  | "save"
  | "delete";

const EVENT_OK: FlashMap<EventOkKey, EventSection> = {
  saved: { section: "details", message: "Saved." },
};

const EVENT_ERROR: FlashMap<EventErrorKey, EventSection> = {
  title: { section: "details", message: "An event needs a title." },
  dates: { section: "details", message: "The end time is before the start." },
  ensemble: {
    section: "details",
    message: "Pick who this event is for from the groups listed.",
  },
  save: { section: "details", message: "Couldn't save. Try again." },
  delete: {
    section: "danger",
    message: "Couldn't delete this event. Try again.",
  },
};

export const EVENT_FLASH_MAPS = { ok: EVENT_OK, error: EVENT_ERROR } as const;
