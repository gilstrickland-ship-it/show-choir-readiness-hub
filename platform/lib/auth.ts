import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

// Auth + role guards. NOT a 'use server' module — these are plain helpers called
// from server components AND server actions. Server actions re-check role here
// against program_members even though RLS already gates the query, because a
// coarse RLS read policy lets any active member see a row; the fine-grained
// write rule (only treasurer writes the ledger, only director/admin touch
// settings) lives in server actions (Constitution I, defense in depth).

export type Role =
  | "director"
  | "admin"
  | "treasurer"
  | "costume_manager"
  | "board_member";

export type MemberStatus = "invited" | "active" | "removed";

export interface Membership {
  id: string;
  program_id: string;
  user_id: string | null;
  role: Role;
  status: MemberStatus;
  invited_email: string | null;
}

// Current signed-in user, or null. Uses getUser() (verifies the JWT) rather than
// getSession() (trusts the cookie) so authorization never rides on an unverified
// token.
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Active membership for `userId` in `programId`, or null.
export async function getMembership(
  programId: string,
  userId: string,
): Promise<Membership | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("program_members")
    .select("id, program_id, user_id, role, status, invited_email")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return (data as Membership | null) ?? null;
}

// Defense-in-depth guard for server actions: asserts the caller is an active
// member of `programId` holding one of `roles`. Throws on failure — reaching it
// means the UI already hid the control, so a thrown error is the correct
// "should never happen" signal rather than a friendly redirect.
export async function requireRole(
  programId: string,
  roles: readonly Role[],
): Promise<{ user: User; membership: Membership }> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  const membership = await getMembership(programId, user.id);
  if (!membership || !roles.includes(membership.role)) {
    throw new Error("Insufficient role for this action");
  }
  return { user, membership };
}
