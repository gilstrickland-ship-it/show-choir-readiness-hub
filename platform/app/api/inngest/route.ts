import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { packetParseFn } from "@/lib/inngest/functions/packet-parse";
import {
  digestDraftCron,
  digestReminderCron,
} from "@/lib/inngest/functions/digest";

// Inngest serve handler (§10). Registers the packet/parse function plus the two
// weekly digest crons (draft on Sun, reminder on Wed — never auto-send, T025).
// More functions (announcement/send, competition/seed, season/rollover-nudge)
// land in later phases and are added to this array. Without INNGEST_SIGNING_KEY
// the endpoint still mounts for local dev; production signing is env-driven.

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [packetParseFn, digestDraftCron, digestReminderCron],
});
