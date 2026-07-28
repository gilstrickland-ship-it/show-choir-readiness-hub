"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { programPath } from "@/lib/return-path";

// Accept a membership invite. The invited program_members row is read/written
// with the service-role client because the invitee is not yet a member and RLS
// would (correctly) hide the row from them. The security check is explicit here:
// the signed-in user's verified email must equal the row's invited_email. On
// success the row flips invited → active and is linked to the auth user.
export async function acceptInvite(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("inviteId") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/invite/${inviteId}`)}`);
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
    redirect(`/invite/${inviteId}?error=1`);
  }

  const { error } = await admin
    .from("program_members")
    .update({ status: "active", user_id: user.id })
    .eq("id", inviteId)
    .eq("status", "invited");

  if (error) {
    redirect(`/invite/${inviteId}?error=1`);
  }

  const program = member.program as unknown as { slug: string } | null;
  redirect((program && programPath(program.slug, "dashboard")) || "/");
}
