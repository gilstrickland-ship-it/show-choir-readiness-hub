// Single source for SUB-navigation — the strip of sibling routes inside a nav
// slot (spec 005 Wave 8 / T142). lib/nav.ts is the same idea one level up.
//
// There were six of these, one component per surface, each a ~40-line copy of
// the same closure: build an href, render the active one as <strong
// aria-current="page"> and the rest as <Link>, wrap the lot in a div. Six copies
// of a rule is how a rule drifts, and it had: five of them wrapped in `.subtabs`
// while the competition strip still wrapped in `.settings-tabs`, the class the
// redesign replaced — so one surface's tabs were a different size, weight and
// case from every other surface's. Now the RENDERING lives in one component
// (app/(app)/[program]/SubTabs.tsx) and each surface contributes only what is
// genuinely its own: which routes, what they're called, and who may see them.
//
// Each builder takes its `active` key, so the compiler checks the highlighted
// tab against that surface's own union rather than against `string` — a typo
// used to render a strip with nothing highlighted at all.

export interface SubTabItem {
  key: string;
  label: string;
  href: string;
}

export interface SubTabStrip {
  active: string;
  items: SubTabItem[];
  // A strip may lead with a way OUT of the group (the competition children's
  // "← Comp week"). It is not a tab: it never highlights and it is not part of
  // the `active` union.
  back?: { href: string; label: string };
}

// Roster (People) — Directory / Ensembles / Import / Size fields. Import and
// Size fields are director/admin surfaces, so those tabs appear only for a
// writer: a board member reading the directory is never shown a link to a page
// that would turn her away.
export type RosterTab = "directory" | "ensembles" | "import" | "settings";

export function rosterTabs(
  slug: string,
  active: RosterTab,
  canWrite: boolean,
): SubTabStrip {
  const base = `/${slug}/roster`;
  return {
    active,
    items: [
      { key: "directory", label: "Directory", href: base },
      { key: "ensembles", label: "Ensembles", href: `${base}/ensembles` },
      ...(canWrite
        ? [
            { key: "import", label: "Import", href: `${base}/import` },
            { key: "settings", label: "Size fields", href: `${base}/settings` },
          ]
        : []),
    ],
  };
}

// Money — Ledger / Budget / Budget vs Actual / Reports. Every tab is
// read-visible to all TREASURY_ROLES (board_member reads); the write controls
// inside each page gate on canWrite, not the strip.
export type TreasuryTab = "ledger" | "budget" | "bva" | "reports";

export function treasuryTabs(slug: string, active: TreasuryTab): SubTabStrip {
  const base = `/${slug}/treasury`;
  return {
    active,
    items: [
      { key: "ledger", label: "Ledger", href: base },
      { key: "budget", label: "Budget", href: `${base}/budget` },
      { key: "bva", label: "Budget vs Actual", href: `${base}/budget-vs-actual` },
      { key: "reports", label: "Reports", href: `${base}/reports` },
    ],
  };
}

// Wardrobe — the costume manager's four real jobs, in the order the job happens:
// keep the inventory, decide who wears what, get it altered, hand it out on comp
// day (spec 005 US13). Alterations is the landing (it lives at /costumes)
// because it is the queue this seat works every week. All four are read-visible
// to every costume role (board_member reads); write controls gate on canWrite.
export type CostumeTab =
  | "inventory"
  | "assignments"
  | "alterations"
  | "checkout";

export function costumeTabs(slug: string, active: CostumeTab): SubTabStrip {
  const base = `/${slug}/costumes`;
  return {
    active,
    items: [
      { key: "inventory", label: "Inventory", href: `${base}/inventory` },
      { key: "assignments", label: "Assignments", href: `${base}/assignments` },
      { key: "alterations", label: "Alterations", href: base },
      { key: "checkout", label: "Checkout", href: `${base}/checkout` },
    ],
  };
}

// Comms — the landing (what needs attention), the announcement composer, the
// volunteer roster.
//
// Every flag gate here is a REQUIRED field: a hidden feature must never offer a
// link that 404s, and a default-true prop is how two of the five call sites came
// to advertise a digest their program can't draft. Required fields make the
// compiler ask the question at every call site — keep them required.
//
// When `digest` is off (prep tier), /comms stays reachable as a soft-gated
// overview — existing drafts remain reviewable — so the landing tab reads
// "Overview" rather than advertising a digest the program can't draft.
export type CommsTab = "digest" | "announcements" | "shifts";

export function commsTabs(
  slug: string,
  active: CommsTab,
  flags: {
    digestEnabled: boolean;
    announcementsEnabled: boolean;
    shiftsEnabled: boolean;
  },
): SubTabStrip {
  const base = `/${slug}/comms`;
  return {
    active,
    items: [
      {
        key: "digest",
        label: flags.digestEnabled ? "Digest" : "Overview",
        href: base,
      },
      ...(flags.announcementsEnabled
        ? [
            {
              key: "announcements",
              label: "Announcements",
              href: `${base}/announcements`,
            },
          ]
        : []),
      ...(flags.shiftsEnabled
        ? [{ key: "shifts", label: "Shifts", href: `${base}/shifts` }]
        : []),
    ],
  };
}

// Settings — Program / Members / Seasons / Export & Data. Seasons is the
// season-rollover page. Every settings page renders this so the active tab
// always highlights consistently.
export type SettingsTab = "program" | "members" | "seasons" | "export";

export function settingsTabs(slug: string, active: SettingsTab): SubTabStrip {
  const base = `/${slug}/settings`;
  return {
    active,
    items: [
      { key: "program", label: "Program", href: base },
      { key: "members", label: "Members", href: `${base}/members` },
      { key: "seasons", label: "Seasons", href: `${base}/rollover` },
      { key: "export", label: "Export & Data", href: `${base}/export` },
    ],
  };
}

// Events — Month / Week. The one strip whose items are two VIEWS of a single
// route rather than two sibling routes: the calendar is the same page either
// way and `?view=` is only which shape of it you asked for. It belongs here
// anyway, because that difference is invisible to the person reading it — it is
// the same "one of these, and you are on this one" control — and because the
// events calendar was the last surface still building that control by hand out
// of `.settings-tabs`, the pre-redesign class T142 removed everywhere else, so
// its tabs rendered smaller, lighter and in sentence case than the app's.
//
// `ref` rides along so switching shape keeps the month or the week you were
// looking at instead of snapping back to today.
export type EventViewTab = "month" | "week";

export function eventViewTabs(
  slug: string,
  active: EventViewTab,
  refKey: string,
): SubTabStrip {
  const base = `/${slug}/events`;
  return {
    active,
    items: [
      { key: "month", label: "Month", href: `${base}?view=month&ref=${refKey}` },
      { key: "week", label: "Week", href: `${base}?view=week&ref=${refKey}` },
    ],
  };
}

// The heavy full-list editing routes under a competition. Since the
// season-workflow redesign the competition landing is a one-page command center
// (no tabs); these routes hold the deep editing flows and get a way back to it
// plus tabs to move between one another.
export type CompetitionTab = "attendance" | "itinerary" | "meals" | "packet";

export function competitionTabs(
  slug: string,
  competitionId: string,
  active: CompetitionTab,
): SubTabStrip {
  const base = `/${slug}/competitions/${competitionId}`;
  return {
    active,
    back: { href: base, label: "← Comp week" },
    items: [
      { key: "attendance", label: "Attendance", href: `${base}/attendance` },
      { key: "itinerary", label: "Itinerary", href: `${base}/itinerary` },
      { key: "meals", label: "Meals", href: `${base}/meals` },
      { key: "packet", label: "Packet", href: `${base}/packet` },
    ],
  };
}
