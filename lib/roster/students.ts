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
