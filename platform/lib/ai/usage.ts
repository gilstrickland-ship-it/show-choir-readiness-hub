// AI token-usage logging (Constitution IV — "token usage is logged per program
// from day one"). The schema carries no dedicated ai_usage table (and this phase
// adds no migrations), so usage is emitted as a single structured log line per
// call, tagged with program + prompt version + model. In production this lands in
// the platform's log drain / Sentry breadcrumbs where per-program cost can be
// aggregated; it is intentionally cheap and never throws.
//
// (Packet parse additionally persists its usage inside packet_parses.raw_output;
// the digest row has no jsonb column, so this structured log is its record.)

export interface AiUsage {
  programId: string;
  feature: "packet-parse" | "digest-draft";
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}

export function logAiUsage(usage: AiUsage): void {
  try {
    console.info(
      "ai.usage " +
        JSON.stringify({
          program_id: usage.programId,
          feature: usage.feature,
          model: usage.model,
          prompt_version: usage.promptVersion,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          at: new Date().toISOString(),
        }),
    );
  } catch {
    // never let telemetry break a draft.
  }
}
