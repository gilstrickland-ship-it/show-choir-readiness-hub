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
