import { Inngest } from "inngest";

// Inngest client (§10). Events are typed so the packet/parse trigger is
// discoverable. The client is inert without INNGEST_EVENT_KEY — in dev/pilot
// without Inngest infra, the upload action falls back to running the parse
// inline via runPacketParse() (see lib/ai/packet-parse.ts). Feature-flag checks
// still gate exposure; a job for a program with packet_parse off no-ops.

export type Events = {
  "packet/parse": {
    data: {
      parseId: string;
      programId: string;
      competitionId: string;
    };
  };
  "export/all": {
    data: {
      jobId: string;
      programId: string;
    };
  };
  "announcement/send": {
    data: {
      programId: string;
      announcementId: string;
      seasonId: string | null;
      ensembleId: string | null;
      subject: string;
      bodyMd: string;
    };
  };
  "digest/send": {
    data: {
      programId: string;
      digestId: string;
      seasonId: string | null;
    };
  };
};

// App id is brand-neutral (Constitution IX) — the working codename lives only in
// lib/brand.ts. Override with INNGEST_APP_ID if a deployment needs a specific id.
export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID ?? "platform",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type PacketParseEventData = Events["packet/parse"]["data"];

// True when Inngest is actually configured; the upload action uses this to decide
// between enqueue (event key present) and inline fallback (absent).
export function inngestEnabled(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY);
}
