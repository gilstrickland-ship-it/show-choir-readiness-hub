import { z } from "zod";

// Digest-draft prompt family, v1 (Constitution IV — one of exactly two prompt
// families, versioned in-repo with its zod schema beside it). `prompt_version` is
// recorded on every digests row so a draft is traceable to the exact instructions
// that produced it. The model DRAFTS; a director reviews, edits, and approves
// before anything reaches a parent (never auto-send).

export const PROMPT_VERSION = "digest-draft/v1";

// The model returns exactly a subject line and a markdown body. Nothing else —
// the mailer appends the footer links, so the body must NOT include a sign-off or
// links.
export const digestDraftSchema = z.object({
  subject: z.string(),
  body_md: z.string(),
});

export type DigestDraftResult = z.infer<typeof digestDraftSchema>;

export const SYSTEM_PROMPT = `You write a warm, concise WEEKLY EMAIL DIGEST for the parents/guardians of a school show-choir program. You are a DRAFT PRODUCER: a human director reviews and edits everything you write before it is ever sent.

Absolute rules:
- NEVER invent facts. Use ONLY the data provided in the user message. If a section has no data, omit that section entirely — do not fill it with filler or guesses.
- Do not include any student names, health, or medical information. Alteration/fitting counts are given as aggregates — keep them aggregate ("3 costumes still need alterations"), never per-student.
- Keep it short and scannable: a friendly one- or two-sentence intro, then short markdown sections (use "## " headings and "- " bullets) for what's provided: this week's competitions and call times, rehearsals/events, volunteer shifts that still need people, costume/alteration reminders, and the director's note if present.
- When volunteer shifts need people, encourage parents to use the signup link in the footer of this email (do not write out a URL — the footer already has it).
- End WITHOUT a sign-off, closing, or signature line, and WITHOUT any links — the email footer (added automatically) carries the sign-off and the three parent links. Your body is just the content above the footer.

Return ONLY a single JSON object, no prose, no markdown fences, matching exactly:
{
  "subject": string,     // a short, specific subject line, e.g. "This week: Regionals Saturday + 2 shifts open"
  "body_md": string      // the markdown body, no footer, no sign-off, no links
}`;

// Structured week data → the user text block. Kept in the prompt module so the
// exact serialization is versioned with the schema.
export interface DigestWeekData {
  programName: string;
  weekLabel: string; // human range, e.g. "Mar 14–Mar 21"
  timezone: string;
  weeklyNote: string | null;
  competitions: Array<{
    name: string;
    date: string | null; // human date
    highlights: string[]; // "Depart 6:30 AM", "Perform 2:15 PM", "Awards 7:00 PM"
  }>;
  events: Array<{ title: string; when: string | null; kind: string }>;
  openShifts: Array<{ title: string; when: string | null; open: number }>;
  alterations: { needed: number; inProgress: number };
}

export function buildUserText(data: DigestWeekData): string {
  const lines: string[] = [];
  lines.push(`Program: ${data.programName}`);
  lines.push(`Week: ${data.weekLabel} (times in ${data.timezone})`);
  lines.push("");

  if (data.competitions.length > 0) {
    lines.push("COMPETITIONS THIS WEEK:");
    for (const c of data.competitions) {
      lines.push(`- ${c.name}${c.date ? ` (${c.date})` : ""}`);
      for (const h of c.highlights) lines.push(`    • ${h}`);
    }
    lines.push("");
  } else {
    lines.push("COMPETITIONS THIS WEEK: none");
    lines.push("");
  }

  if (data.events.length > 0) {
    lines.push("REHEARSALS / EVENTS:");
    for (const e of data.events) {
      lines.push(`- ${e.title}${e.when ? ` — ${e.when}` : ""} (${e.kind})`);
    }
    lines.push("");
  }

  if (data.openShifts.length > 0) {
    lines.push("VOLUNTEER SHIFTS STILL NEEDING PEOPLE:");
    for (const s of data.openShifts) {
      lines.push(
        `- ${s.title}${s.when ? ` — ${s.when}` : ""} — ${s.open} spot(s) open`,
      );
    }
    lines.push("");
  }

  const alt = data.alterations;
  if (alt.needed > 0 || alt.inProgress > 0) {
    lines.push(
      `COSTUME ALTERATIONS: ${alt.needed} needed, ${alt.inProgress} in progress (aggregate counts — no names).`,
    );
    lines.push("");
  }

  if (data.weeklyNote && data.weeklyNote.trim()) {
    lines.push("DIRECTOR'S NOTE (include this, lightly edited for tone):");
    lines.push(data.weeklyNote.trim());
    lines.push("");
  }

  lines.push(
    "Draft the weekly digest JSON from ONLY the data above. Omit any section with no data.",
  );

  return lines.join("\n");
}
