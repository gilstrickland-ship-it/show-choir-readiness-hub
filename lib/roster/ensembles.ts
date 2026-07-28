// Ensemble membership vocabulary, shared by the pages and the server actions.
// Kept out of the "use server" module (which may only export async functions)
// so one list drives the picker, the row, and the action's validation — the
// same label-map idiom used across the app (lib/costumes.ts, lib/treasury.ts).

export const MEMBER_ROLES = ["performer", "band", "crew", "manager"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  performer: "Performer",
  band: "Band",
  crew: "Crew",
  manager: "Manager",
};

export function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}

// A row's Edit panel reopens on `?edit=<id>` and the browser is sent to the
// row's anchor, so a refused save lands inside the panel that produced it.
// Built here because the page and the action both say it.
export function ensembleAnchor(ensembleId: string): string {
  return `ensemble-${ensembleId}`;
}

export function memberAnchor(memberId: string): string {
  return `member-${memberId}`;
}
