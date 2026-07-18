import type { Role } from "@/lib/auth";

// Constants for the events surface (§5a). Kept out of the "use server" actions
// module — a server-actions file may only export async functions, so shared
// constants live here and are imported by both the actions and the pages.
//
// Events write: director/admin (events_write in RLS; §2). All members read.

export const EVENTS_WRITE_ROLES: readonly Role[] = ["director", "admin"];

export const EVENT_KINDS = [
  "rehearsal",
  "fitting",
  "fundraiser",
  "banquet",
  "other",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
