import { createAdminClient } from "@/lib/supabase/admin";
import { getAnthropic, packetParseModel } from "@/lib/ai/client";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserText,
  packetParseSchema,
  type PacketParseResult,
} from "@/lib/ai/prompts/packet-parse/v1";

// Core packet-parse worker (Constitution IV — AI draft-only). Extracted here so
// BOTH the Inngest function AND the direct server-action fallback runPacketParse()
// run identical code. Uses the service-role client: the Inngest path has no user
// session, and the fallback path has already re-checked director/admin before
// enqueuing. NEVER call this during verification — it hits Storage + the Claude
// API only at real runtime.

interface ParseRow {
  id: string;
  program_id: string;
  competition_id: string;
  document_id: string;
  status: string;
}

interface DocRow {
  storage_path: string;
}

interface CompRow {
  name: string;
  host_school: string | null;
  date: string | null;
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i + 1).toLowerCase();
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  // Fall back to the first {...} span if the model wrapped prose around it.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

// §5 step 4 validation pass — time-sequence sanity + date match + missing times.
// Annotates only (the parse always goes to review regardless).
export function validateParse(
  parsed: PacketParseResult,
  competitionDate: string | null,
): string[] {
  const issues: string[] = [];

  for (const item of parsed.items) {
    if (!item.starts_at) {
      issues.push(`"${item.title}" has no start time — set it in review.`);
      continue;
    }
    if (competitionDate && !item.starts_at.startsWith(competitionDate)) {
      issues.push(
        `"${item.title}" is dated ${item.starts_at.slice(0, 10)}, not the competition date ${competitionDate}.`,
      );
    }
  }

  // depart < arrive < warmup < perform, where each is present (earliest of kind).
  const earliest = (kind: string): string | null => {
    const times = parsed.items
      .filter((i) => i.kind === kind && i.starts_at)
      .map((i) => i.starts_at as string)
      .sort();
    return times[0] ?? null;
  };
  const sequence: Array<[string, string | null]> = [
    ["depart", earliest("depart")],
    ["arrive", earliest("arrive")],
    ["warmup", earliest("warmup")],
    ["perform", earliest("perform")],
  ];
  const present = sequence.filter(([, t]) => t !== null) as Array<
    [string, string]
  >;
  for (let i = 1; i < present.length; i++) {
    if (present[i][1] < present[i - 1][1]) {
      issues.push(
        `Time order looks off: ${present[i][0]} (${present[i][1].slice(11)}) is before ${present[i - 1][0]} (${present[i - 1][1].slice(11)}).`,
      );
    }
  }

  return issues;
}

async function callClaude(
  base64: string,
  ext: string,
  userText: string,
): Promise<{ result: PacketParseResult; usage: { input: number; output: number }; raw: string }> {
  const anthropic = getAnthropic();
  const model = packetParseModel();

  const fileBlock =
    ext === "pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (IMAGE_TYPES[ext] ?? "image/png") as
              | "image/png"
              | "image/jpeg"
              | "image/webp"
              | "image/gif",
            data: base64,
          },
        };

  let usageIn = 0;
  let usageOut = 0;
  let lastRaw = "";

  // One retry on invalid JSON (§5 step 3). Second attempt nudges toward raw JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix =
      attempt === 0
        ? ""
        : "\n\nYour previous response was not valid JSON matching the schema. Return ONLY the JSON object, with no prose or markdown.";
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text", text: userText + suffix }],
        },
      ],
    });

    usageIn += response.usage.input_tokens;
    usageOut += response.usage.output_tokens;

    const textBlock = response.content.find((b) => b.type === "text");
    lastRaw = textBlock && textBlock.type === "text" ? textBlock.text : "";

    try {
      const json = JSON.parse(stripJsonFences(lastRaw));
      const parsed = packetParseSchema.safeParse(json);
      if (parsed.success) {
        return {
          result: parsed.data,
          usage: { input: usageIn, output: usageOut },
          raw: lastRaw,
        };
      }
    } catch {
      // fall through to retry
    }
  }

  throw new Error("Model did not return valid JSON matching the packet schema.");
}

// Run one parse to completion, mutating the packet_parses row through
// running → review (or failed). Idempotent-ish: safe to re-run a queued/failed
// row. Returns the terminal status.
export async function runPacketParse(
  parseId: string,
): Promise<"review" | "failed"> {
  const supabase = createAdminClient();

  const { data: parseData, error: parseErr } = await supabase
    .from("packet_parses")
    .select("id, program_id, competition_id, document_id, status")
    .eq("id", parseId)
    .maybeSingle();
  const parse = parseData as ParseRow | null;
  if (parseErr || !parse) {
    throw new Error(`packet_parses ${parseId} not found`);
  }

  await supabase
    .from("packet_parses")
    .update({ status: "running", error: null })
    .eq("id", parseId);

  try {
    const [{ data: docData }, { data: compData }] = await Promise.all([
      supabase
        .from("documents")
        .select("storage_path")
        .eq("id", parse.document_id)
        .maybeSingle(),
      supabase
        .from("competitions")
        .select("name, host_school, date")
        .eq("id", parse.competition_id)
        .maybeSingle(),
    ]);
    const doc = docData as DocRow | null;
    const comp = compData as CompRow | null;
    if (!doc || !comp) throw new Error("document or competition missing");

    const { data: file, error: dlErr } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) {
      throw new Error(`could not download ${doc.storage_path}: ${dlErr?.message}`);
    }

    const ext = extOf(doc.storage_path);
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Resolve timezone for the prompt (rendering context only).
    const { data: prog } = await supabase
      .from("programs")
      .select("timezone")
      .eq("id", parse.program_id)
      .maybeSingle();
    const timezone = (prog as { timezone: string } | null)?.timezone ?? "America/Chicago";

    const userText = buildUserText({
      competitionName: comp.name,
      hostSchool: comp.host_school,
      date: comp.date,
      timezone,
    });

    const { result, usage, raw } = await callClaude(base64, ext, userText);
    const issues = validateParse(result, comp.date);

    await supabase
      .from("packet_parses")
      .update({
        status: "review",
        model: packetParseModel(),
        prompt_version: PROMPT_VERSION,
        raw_output: {
          parsed: result,
          issues,
          usage: { input_tokens: usage.input, output_tokens: usage.output },
          raw_text: raw.slice(0, 20000),
        },
        confidence: {
          ambiguities: result.ambiguities.length,
          issues: issues.length,
          level: result.ambiguities.length + issues.length === 0 ? "high" : "review",
        },
        error: null,
      })
      .eq("id", parseId);

    return "review";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("packet_parses")
      .update({ status: "failed", error: message })
      .eq("id", parseId);
    return "failed";
  }
}
