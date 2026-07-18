import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { flag, type FlaggableProgram } from "@/lib/flags";
import { draftDigest } from "@/lib/ai/digest-draft";
import { currentWeekOf } from "@/lib/comms";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/tokens";

// Weekly digest crons (§8, Constitution IV). TWO functions, both fan out over
// every program with the `digest` flag on:
//   • digestDraftCron    — Sun 6pm: gather → Claude draft → `draft` status. It
//                          NEVER sends. A director reviews/edits/approves/sends
//                          from the digest UI.
//   • digestReminderCron — Wed 9am: if a draft still sits unapproved, email the
//                          program's director/admin a REMINDER (never the digest).
// Times use TZ-prefixed crons anchored to US Central (pilot programs). Both are
// inert without INNGEST_* infra; the "Draft now" button covers dev/pilot drafting
// and the in-app banner covers the reminder when staff emails can't be resolved.

interface ProgramRow extends FlaggableProgram {
  id: string;
  timezone: string;
}

async function digestPrograms(): Promise<ProgramRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("programs")
    .select("id, timezone, feature_overrides");
  const rows = (data as ProgramRow[] | null) ?? [];
  return rows.filter((p) => flag(p, "digest"));
}

export const digestDraftCron = inngest.createFunction(
  {
    id: "digest-draft-cron",
    name: "Weekly digest draft",
    triggers: [{ cron: "TZ=America/Chicago 0 18 * * 0" }],
  },
  async ({ step }) => {
    const programs = await step.run("load-programs", digestPrograms);
    const results: Array<{ programId: string; status: string }> = [];
    for (const p of programs) {
      const weekOf = currentWeekOf(p.timezone);
      // One step per program so a single failed draft doesn't abort the batch.
      const res = await step.run(`draft-${p.id}`, async () => {
        try {
          const r = await draftDigest(p.id, weekOf);
          return r.status;
        } catch (e) {
          return `error:${e instanceof Error ? e.message : String(e)}`;
        }
      });
      results.push({ programId: p.id, status: res });
    }
    return { drafted: results.length, results };
  },
);

export const digestReminderCron = inngest.createFunction(
  {
    id: "digest-reminder-cron",
    name: "Weekly digest reminder",
    triggers: [{ cron: "TZ=America/Chicago 0 9 * * 3" }],
  },
  async ({ step }) => {
    const reminded = await step.run("remind", async () => {
      const supabase = createAdminClient();
      const programs = await digestPrograms();
      let sent = 0;
      for (const p of programs) {
        // Any draft still awaiting approval?
        const { data: drafts } = await supabase
          .from("digests")
          .select("id, week_of")
          .eq("program_id", p.id)
          .eq("status", "draft");
        const draftRows = (drafts as { id: string; week_of: string }[] | null) ?? [];
        if (draftRows.length === 0) continue;

        // Resolve director/admin emails via program_members → auth. When emails
        // can't be resolved (or email infra is absent), the in-app banner on the
        // comms/digest surface is the reliable reminder — this email is a nicety.
        const { data: members } = await supabase
          .from("program_members")
          .select("user_id")
          .eq("program_id", p.id)
          .in("role", ["director", "admin"])
          .eq("status", "active")
          .not("user_id", "is", null);
        const staffEmails: string[] = [];
        for (const m of (members as { user_id: string }[] | null) ?? []) {
          try {
            const { data: u } = await supabase.auth.admin.getUserById(m.user_id);
            const email = u.user?.email;
            if (email) staffEmails.push(email);
          } catch {
            // ignore — banner covers it.
          }
        }

        const uniqueEmails = Array.from(new Set(staffEmails));
        for (const to of uniqueEmails) {
          const res = await sendEmail({
            to,
            subject: "A weekly digest is waiting for your approval",
            html: `<p>You have ${draftRows.length} weekly digest draft(s) waiting for review and approval. Nothing sends to parents until you approve it.</p>
<p><a href="${appBaseUrl()}">Open the dashboard</a> and go to Comms → Digest to review.</p>`,
          });
          if (res.status === "sent") sent++;
        }
      }
      return sent;
    });
    return { remindersSent: reminded };
  },
);
