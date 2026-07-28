import type { FlagKey } from "@/lib/flags";
import type { Role } from "@/lib/auth";

// Single source for tenant navigation + per-surface role access. The layout
// renders nav from this; each domain page re-derives its own role gate from the
// same constants (defense in depth). A role-hidden surface is still not reachable
// by an authenticated member who types/bookmarks its URL: instead of leaking
// data it renders a data-free <Restricted> notice (app/(app)/[program]/Restricted)
// that names the owning seats — acceptable because the viewer is already an
// authenticated member of this program. FLAG-hidden surfaces are different: they
// keep hard-404ing via requireFlag() so a program with a feature disabled never
// learns the feature exists (Constitution VIII, tenant isolation).
//
// Role visibility follows the §2 permission matrix and the task's explicit
// carve-outs: treasury is visible to director/admin/treasurer/board_member
// (costume_manager has no money access); comms is hidden from board_member
// (board is read-only and does not manage shifts/announcements/digest).

// director is the school-staff seat, admin the booster seat — identical
// capabilities today (§2), so settings-class surfaces gate on both.
export const SETTINGS_ROLES: readonly Role[] = ["director", "admin"];

// Roster (§2 matrix "Roster CRUD"): director/admin write, board_member reads.
// treasurer and costume_manager have no roster-directory access — the costume
// surface reads student sizes through its own screens, not this one.
export const ROSTER_ROLES: readonly Role[] = ["director", "admin", "board_member"];
export const ROSTER_WRITE_ROLES: readonly Role[] = ["director", "admin"];

export const COSTUMES_ROLES: readonly Role[] = [
  "director",
  "admin",
  "costume_manager",
  "board_member",
];

export const TREASURY_ROLES: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
  "board_member",
];

export const COMMS_ROLES: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
  "costume_manager",
];

// Hosting (Wave I host-mode, §I1 matrix). Nav-visible to director/admin (write)
// and board_member (read-only, mirroring the treasury/board posture); write is
// director/admin only, re-checked in server actions (I2). treasurer and
// costume_manager get neither nav nor write — hosting is not their surface.
export const HOSTING_ROLES: readonly Role[] = ["director", "admin", "board_member"];
export const HOSTING_WRITE_ROLES: readonly Role[] = ["director", "admin"];

export interface NavItem {
  slot: string;
  label: string;
  flag?: FlagKey; // single-flag gate: hidden unless this flag is on
  // Any-of flag gate: visible when ANY listed flag is on (union surfaces like
  // Season, which absorbs competitions + events + travel + archive). Mutually
  // exclusive with `flag` in practice — an item uses one or the other.
  flagsAny?: readonly FlagKey[];
  roles?: readonly Role[]; // undefined = visible to every role
}

// Task-oriented IA (season-workflow redesign): six slots, each mapping to a
// staff job-to-be-done rather than a data module. Settings leaves the nav for
// the header's right cluster (SETTINGS_ROLES-gated there). Season is a real
// slot that absorbs the old Competitions/Events/Travel/History lists behind an
// any-of flag gate; the old routes stay live (still flag/role-gated) but drop
// out of the nav.
export const NAV: readonly NavItem[] = [
  { slot: "dashboard", label: "Today" },
  {
    slot: "season",
    label: "Season",
    flagsAny: ["competitions", "events", "travel", "archive"],
  },
  { slot: "roster", label: "People", roles: ROSTER_ROLES },
  { slot: "treasury", label: "Money", flag: "treasury", roles: TREASURY_ROLES },
  { slot: "costumes", label: "Wardrobe", flag: "costumes", roles: COSTUMES_ROLES },
  { slot: "comms", label: "Comms", flag: "comms", roles: COMMS_ROLES },
  // Host-mode: its own slot behind the `hosting` flag (default off). Visible to
  // director/admin/board_member; hard-404s via requireFlag when the flag is off.
  { slot: "hosting", label: "Hosting", flag: "hosting", roles: HOSTING_ROLES },
];

// A nav item is visible when its flag gate passes (single `flag` on, OR any of
// `flagsAny` on) AND the role is allowed. An item with neither flag field is
// always flag-visible.
export function isNavItemVisible(
  item: NavItem,
  role: Role,
  flags: Record<FlagKey, boolean>,
): boolean {
  if (item.flag && !flags[item.flag]) return false;
  if (item.flagsAny && !item.flagsAny.some((f) => flags[f])) return false;
  if (item.roles && !item.roles.includes(role)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mobile tab bar (spec 005 Wave 8 / T141)
// ---------------------------------------------------------------------------
// The phone gets four tabs plus a More sheet. Which four is a RANKING over the
// items this viewer can actually see, not a fixed list of slots: the bar used to
// name dashboard/season/roster/costumes outright and simply drop any of them the
// role couldn't see, without backfilling — so a treasurer, whose entire job is
// Money, got "Today · Season · More" and had to open a sheet to reach the one
// surface she came for. Ranking and taking the first four gives her Money as a
// tab and leaves a director's bar byte-identical, because a director sees every
// item and the first four in this order are the four that were hardcoded.
//
// The order is a PHONE order, deliberately not NAV's: Wardrobe outranks Money
// because costume checkout and quick-change are hallway jobs done standing up,
// while the ledger is a desk task. Every NAV slot appears here — a slot missing
// from this list would silently rank last, which is how a new surface would come
// to be unreachable on a phone; the unit spec asserts the two lists agree.
export const MOBILE_TAB_ORDER: readonly string[] = [
  "dashboard",
  "season",
  "roster",
  "costumes",
  "treasury",
  "comms",
  "hosting",
];

// Four tabs + More = the five-slot bar the design ref calls for.
export const MOBILE_TAB_COUNT = 4;

// Split already-filtered nav items into the tab bar and the More sheet. Callers
// pass the SAME list the desktop nav renders (layout filters it once through
// isNavItemVisible), so a seat can never get a mobile tab for a surface its
// desktop nav hides. The sheet keeps NAV order — it is a list you read, not a
// bar you aim at — while the bar takes the ranked first four.
export function splitMobileNav<T extends { slot: string }>(
  items: readonly T[],
): { tabs: T[]; more: T[] } {
  const rank = (slot: string): number => {
    const i = MOBILE_TAB_ORDER.indexOf(slot);
    return i === -1 ? MOBILE_TAB_ORDER.length : i;
  };
  const tabs = [...items]
    .sort((a, b) => rank(a.slot) - rank(b.slot))
    .slice(0, MOBILE_TAB_COUNT);
  const promoted = new Set(tabs.map((t) => t.slot));
  return { tabs, more: items.filter((i) => !promoted.has(i.slot)) };
}
