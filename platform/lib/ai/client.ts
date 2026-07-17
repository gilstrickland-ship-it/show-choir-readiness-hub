import Anthropic from "@anthropic-ai/sdk";

// Lazy, server-only Anthropic client (Constitution IV, cost telemetry from day
// one). Never constructed at module load — verification (typecheck/build/unit)
// must never touch the network or require ANTHROPIC_API_KEY. The client is built
// on first real use inside a server action / Inngest function.
//
// Model: PACKET_PARSE_MODEL env override, else claude-opus-4-8 (the packet-parse
// default). No temperature/top_p — those are rejected on Opus 4.8; determinism is
// steered by prompt + low effort.

export const DEFAULT_PACKET_PARSE_MODEL = "claude-opus-4-8";

export function packetParseModel(): string {
  return process.env.PACKET_PARSE_MODEL || DEFAULT_PACKET_PARSE_MODEL;
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!cached) {
    cached = new Anthropic({ apiKey: key });
  }
  return cached;
}
