import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { packetParseFn } from "@/lib/inngest/functions/packet-parse";
import {
  digestDraftCron,
  digestReminderCron,
} from "@/lib/inngest/functions/digest";
import { exportAllFn } from "@/lib/inngest/functions/export";
import { rolloverNudgeCron } from "@/lib/inngest/functions/rollover-nudge";
import { announcementSendFn } from "@/lib/inngest/functions/announcement";
import { digestSendFn } from "@/lib/inngest/functions/digest-send";

// Inngest serve handler (§10). Registers every background function: packet/parse,
// the weekly digest crons (draft on Sun, reminder on Wed — never auto-send,
// T025), async export-all (T036), the spring rollover-nudge cron (T037), and the
// announcement/digest send jobs (T038). Without INNGEST_SIGNING_KEY the endpoint
// still mounts for local dev; production signing is env-driven.

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    packetParseFn,
    digestDraftCron,
    digestReminderCron,
    exportAllFn,
    rolloverNudgeCron,
    announcementSendFn,
    digestSendFn,
  ],
});
