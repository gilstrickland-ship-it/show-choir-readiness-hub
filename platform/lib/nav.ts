import type { FlagKey } from "@/lib/flags";
import type { Role } from "@/lib/auth";

// Single source for tenant navigation + per-surface role access. The layout
// renders nav from this; each domain page re-derives its own role gate from the
// same constants so a hidden item is also an unreachable URL (defense in depth).
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
  flag?: FlagKey; // undefined = always exposed (not flag-gated)
  roles?: readonly Role[]; // undefined = visible to every role
}

export const NAV: readonly NavItem[] = [
  { slot: "dashboard", label: "Dashboard" },
  { slot: "roster", label: "Roster", roles: ROSTER_ROLES },
  { slot: "costumes", label: "Costumes", flag: "costumes", roles: COSTUMES_ROLES },
  { slot: "competitions", label: "Competitions", flag: "competitions" },
  { slot: "events", label: "Events", flag: "events" },
  { slot: "travel", label: "Travel", flag: "travel" },
  { slot: "treasury", label: "Treasury", flag: "treasury", roles: TREASURY_ROLES },
  { slot: "comms", label: "Comms", flag: "comms", roles: COMMS_ROLES },
  { slot: "settings", label: "Settings", roles: SETTINGS_ROLES },
];

// A nav item is visible when its flag (if any) is on AND the role is allowed.
export function isNavItemVisible(
  item: NavItem,
  role: Role,
  flags: Record<FlagKey, boolean>,
): boolean {
  if (item.flag && !flags[item.flag]) return false;
  if (item.roles && !item.roles.includes(role)) return false;
  return true;
}
