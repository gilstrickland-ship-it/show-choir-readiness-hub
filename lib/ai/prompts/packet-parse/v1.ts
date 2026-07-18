import { z } from "zod";
import { ITINERARY_ITEM_KINDS } from "@/lib/competitions";

// Packet-parse prompt family, v1 (Constitution IV — one of exactly two prompt
// families, versioned in-repo with its zod schema beside it). `prompt_version`
// is recorded on every packet_parses row so a re-parse is traceable to the exact
// instructions that produced it.

export const PROMPT_VERSION = "packet-parse/v1";

// The schema the model must return. Times are LOCAL wall clock in the
// competition's program timezone, "YYYY-MM-DDTHH:MM" (24h), using the
// competition date supplied in the prompt. The server converts them to UTC on
// accept. Everything is optional/liberal — a draft the director reviews, never
// published output (Constitution IV).
export const packetParseSchema = z.object({
  competition: z.object({
    perform_time: z.string().nullish(),
    homeroom: z.string().nullish(),
    awards_time: z.string().nullish(),
  }),
  items: z.array(
    z.object({
      starts_at: z.string().nullish(),
      ends_at: z.string().nullish(),
      kind: z.enum(ITINERARY_ITEM_KINDS),
      title: z.string(),
      location: z.string().nullish(),
      details: z.string().nullish(),
    }),
  ),
  ambiguities: z.array(z.string()),
});

export type PacketParseResult = z.infer<typeof packetParseSchema>;

export const SYSTEM_PROMPT = `You extract a show-choir competition day schedule from a host packet (a PDF or image the tournament sent the director). You are a DRAFT PRODUCER: a human director reviews everything you output before any of it reaches a parent. Never invent times or events that are not in the document — when something is unclear, omit the time and add a note to "ambiguities" instead of guessing.

Return ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape:
{
  "competition": {
    "perform_time": string | null,   // the ensemble's performance/call time, "YYYY-MM-DDTHH:MM"
    "homeroom": string | null,       // assigned homeroom / warm-up room label or time
    "awards_time": string | null     // awards ceremony time, "YYYY-MM-DDTHH:MM"
  },
  "items": [
    {
      "starts_at": string | null,    // local wall clock "YYYY-MM-DDTHH:MM"
      "ends_at": string | null,      // optional
      "kind": one of ["depart","arrive","homeroom","warmup","perform","meal","awards","load","other"],
      "title": string,               // short label, e.g. "Warm-up (Choir Room B)"
      "location": string | null,
      "details": string | null
    }
  ],
  "ambiguities": [ string ]          // plain-language notes about anything unclear or missing
}

Rules:
- All times are LOCAL wall-clock time at the venue, formatted "YYYY-MM-DDTHH:MM" in 24-hour time, using the competition date given by the user. Do not include a timezone offset.
- Order items by time when times are known.
- Map schedule rows to the closest "kind". Registration/check-in → "arrive". Performance → "perform". Warm-up/vocal/choreo room → "warmup". Homeroom assignment → "homeroom". Awards/finals → "awards". Load-in/load-out → "load". Anything else → "other".
- If a time is a range, put the start in starts_at and the end in ends_at.
- Prefer omitting (null) over guessing. Put every uncertainty in "ambiguities".`;

// The user text block that accompanies the document/image content block.
export function buildUserText(ctx: {
  competitionName: string;
  hostSchool: string | null;
  date: string | null; // YYYY-MM-DD
  timezone: string;
}): string {
  return [
    `Competition: ${ctx.competitionName}`,
    ctx.hostSchool ? `Host school: ${ctx.hostSchool}` : null,
    ctx.date ? `Competition date: ${ctx.date}` : `Competition date: unknown`,
    `Venue timezone: ${ctx.timezone}`,
    "",
    "Extract the schedule from the attached host packet as the JSON object described in the system prompt. Use the competition date above for every time.",
  ]
    .filter(Boolean)
    .join("\n");
}
