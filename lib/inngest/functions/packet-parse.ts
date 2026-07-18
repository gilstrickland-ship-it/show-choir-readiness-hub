import { inngest, type PacketParseEventData } from "@/lib/inngest/client";
import { runPacketParse } from "@/lib/ai/packet-parse";

// Inngest function for the packet/parse pipeline (§5). Thin wrapper: the real
// work lives in runPacketParse() so the direct server-action fallback runs the
// exact same code path. Retries are Inngest's; the row is left in a terminal
// state (review/failed) either way.

export const packetParseFn = inngest.createFunction(
  {
    id: "packet-parse",
    name: "Parse host packet",
    triggers: [{ event: "packet/parse" }],
  },
  async ({ event, step }) => {
    const { parseId } = event.data as PacketParseEventData;
    const status = await step.run("run-packet-parse", () =>
      runPacketParse(parseId),
    );
    return { parseId, status };
  },
);
