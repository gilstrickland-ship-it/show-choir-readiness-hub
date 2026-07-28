// Shared student-status enum + friendly label map for the roster surface. Kept
// here (not in a "use server" module) so pages and the student edit form read one
// source. The stored enum value (students.status, migration 0001) is unchanged;
// only the displayed text differs — the same label-map idiom used across the app
// (lib/treasury.ts, lib/competitions.ts, lib/hosting.ts).

export const STUDENT_STATUSES = ["active", "inactive", "graduated"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  graduated: "Graduated",
};

// Guardian deliverability (guardians.email_status, migration 0001). The stored
// values are unchanged; the labels say what they mean to a director — "bounced"
// is jargon for "this family stopped receiving anything". Read by the student
// page's guardian rows and by /roster/email-issues, so the map lives here.
export const GUARDIAN_EMAIL_STATUSES = ["ok", "bounced", "unsubscribed"] as const;
export type GuardianEmailStatus = (typeof GUARDIAN_EMAIL_STATUSES)[number];

export const GUARDIAN_EMAIL_STATUS_LABELS: Record<GuardianEmailStatus, string> = {
  ok: "Delivering",
  bounced: "Bouncing",
  unsubscribed: "Unsubscribed",
};

// The four groups the student page is read in (spec 005 US10-4). The page links
// to them and the actions send a save back to the one that produced it, so the
// list lives here rather than as a string typed twice in two modules.
export const STUDENT_SECTIONS = ["profile", "sizes", "guardians", "status"] as const;
export type StudentSection = (typeof STUDENT_SECTIONS)[number];

export function isStudentSection(value: string): value is StudentSection {
  return (STUDENT_SECTIONS as readonly string[]).includes(value);
}

// A guardian row's own anchor. The row's Edit panel reopens on
// `?edit=<guardianId>` and the browser is sent to `#guardian-<guardianId>`, so
// a refused save — and the fix link on /roster/email-issues — both land on the
// row that owns them. Built in one place because three modules say it.
export function guardianAnchor(guardianId: string): string {
  return `guardian-${guardianId}`;
}
