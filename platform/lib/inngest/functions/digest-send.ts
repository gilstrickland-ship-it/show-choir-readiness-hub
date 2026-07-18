import { inngest } from "@/lib/inngest/client";
import type { Events } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDigestCore } from "@/lib/comms-send";

// Inngest function for approved-digest sends (§8, §10, T038). Thin wrapper over
// sendDigestCore() (shared with the inline server-action fallback). The core is
// self-contained and idempotent — it re-reads the digest and only sends when it
// is still 'approved', so an Inngest retry never double-sends. Service-role
// client; digest_sends rows and the final 'sent' flip are unchanged.

export const digestSendFn = inngest.createFunction(
  {
    id: "digest-send",
    name: "Send weekly digest",
    triggers: [{ event: "digest/send" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["digest/send"]["data"];
    const counts = await step.run("send-digest", () =>
      sendDigestCore(createAdminClient(), {
        programId: data.programId,
        digestId: data.digestId,
        seasonId: data.seasonId,
      }),
    );
    return { digestId: data.digestId, counts };
  },
);
