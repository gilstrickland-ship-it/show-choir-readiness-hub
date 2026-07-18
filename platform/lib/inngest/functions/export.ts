import { inngest } from "@/lib/inngest/client";
import type { Events } from "@/lib/inngest/client";
import { runExportJob } from "@/lib/export-run";

// Inngest function for async export-all (§13.2, T036). Thin wrapper: the real
// work lives in runExportJob() so the direct server-action fallback (when
// Inngest is not configured) runs the exact same code path. The job row is left
// in a terminal state (done/failed) either way.

export const exportAllFn = inngest.createFunction(
  {
    id: "export-all",
    name: "Build program export",
    triggers: [{ event: "export/all" }],
  },
  async ({ event, step }) => {
    const { jobId, programId } = event.data as Events["export/all"]["data"];
    const status = await step.run("run-export-job", () => runExportJob(jobId, programId));
    return { jobId, status };
  },
);
