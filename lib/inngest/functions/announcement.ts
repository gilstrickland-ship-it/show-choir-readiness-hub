import { inngest } from "@/lib/inngest/client";
import type { Events } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAnnouncementCore } from "@/lib/comms-send";

// Inngest function for announcement sends (§8, §10, T038). Thin wrapper: the real
// fan-out lives in sendAnnouncementCore() so the inline server-action fallback
// (no Inngest key) runs the exact same code. Uses the service-role client because
// the job runs outside a user session; every write is program-scoped. Inngest
// gives retry/batching; announcement_sends rows are unchanged.

export const announcementSendFn = inngest.createFunction(
  {
    id: "announcement-send",
    name: "Send announcement",
    triggers: [{ event: "announcement/send" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["announcement/send"]["data"];
    const counts = await step.run("send-announcement", () =>
      sendAnnouncementCore(createAdminClient(), {
        programId: data.programId,
        announcementId: data.announcementId,
        seasonId: data.seasonId,
        ensembleId: data.ensembleId,
        subject: data.subject,
        bodyMd: data.bodyMd,
      }),
    );
    return { announcementId: data.announcementId, ...counts };
  },
);
