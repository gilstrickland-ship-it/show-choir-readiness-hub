"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { programPath } from "@/lib/return-path";
import type { InviteErrorKey } from "./shared";

// /invite is not under the [program] segment, so the value this path interpolates
// is the invite id rather than a slug. It is still a POSTED value, so it is
// checked before it is put in a URL: a uuid, or nothing. Anything else means the
// form did not come from the page, and there is no invite to return to — the
// sign-in router is where such a request belongs (spec 005 T143a / T165).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invitePath(inviteId: string): string | null {
  return UUID.test(inviteId) ? `/invite/${inviteId}` : null;
}

function inviteFail(inviteId: string, key: InviteErrorKey): string {
  const base = invitePath(inviteId);
  return base ? `${base}?error=${key}` : "/launch";
}

// Accept a membership invite. The invited program_members row is read/written
// with the service-role client because the invitee is not yet a member and RLS
// would (correctly) hide the row from them. The security check is explicit here:
// the signed-in user's verified email must equal the row's invited_email. On
// success the row flips invited → active and is linked to the auth user, keeping
// the role the director chose when they sent it.
export async function acceptInvite(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("inviteId") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const back = invitePath(inviteId);
    redirect(
      back ? `/sign-in?redirect=${encodeURIComponent(back)}` : "/sign-in",
    );
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("program_members")
    .select("id, status, invited_email, program:programs(slug)")
    .eq("id", inviteId)
    .maybeSingle();

  const invitedEmail = (member?.invited_email ?? "").toLowerCase();
  const userEmail = (user.email ?? "").toLowerCase();

  if (
    !member ||
    member.status !== "invited" ||
    !invitedEmail ||
    invitedEmail !== userEmail
  ) {
    redirect(inviteFail(inviteId, "accept"));
  }

  const { error } = await admin
    .from("program_members")
    .update({ status: "active", user_id: user.id })
    .eq("id", inviteId)
    .eq("status", "invited");

  if (error) {
    redirect(inviteFail(inviteId, "accept"));
  }

  const program = member.program as unknown as { slug: string } | null;
  redirect((program && programPath(program.slug, "dashboard")) || "/");
}
