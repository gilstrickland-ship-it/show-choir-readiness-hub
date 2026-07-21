import type { Role } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardianLinks } from "@/lib/tokens";
import { zonedDateKey } from "@/lib/datetime";

// Shared constants + helpers for the comms surface (§8). Announcements are the
// "right now" channel: compose → immediate send. No AI, no approval queue — the
// human writing it IS the approval. Approve/send is director/admin (§2 matrix).

export const ANNOUNCEMENT_WRITE_ROLES: readonly Role[] = ["director", "admin"];

// Weekly digest draft/approve/send — director/admin only (§2 matrix; matches the
// digests_write RLS policy).
export const DIGEST_WRITE_ROLES: readonly Role[] = ["director", "admin"];

// The "week_of" key for a digest: the program-local calendar day the 7-day
// window starts on ("YYYY-MM-DD"). Both the cron and "Draft now" use this so a
// re-draft targets the same digests row.
export function currentWeekOf(timezone: string, now: Date = new Date()): string {
  return zonedDateKey(now, timezone);
}

export interface Recipient {
  guardianId: string;
  name: string;
  email: string;
}

// Compute the deduped recipient list for an announcement. Guardians with
// email_status='ok', deduped by (lowercased) email — a parent with two kids has
// two guardian rows sharing one email and gets ONE message. When `ensembleId` is
// set, restrict to guardians of students who are ensemble_members of that
// ensemble in the active season.
export async function computeRecipients(
  supabase: SupabaseClient,
  args: { programId: string; seasonId: string | null; ensembleId: string | null },
): Promise<Recipient[]> {
  const { programId, seasonId, ensembleId } = args;

  let studentFilter: string[] | null = null;
  if (ensembleId) {
    if (!seasonId) return [];
    const { data: mems } = await supabase
      .from("ensemble_members")
      .select("student_id")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .eq("ensemble_id", ensembleId);
    studentFilter = Array.from(
      new Set(((mems as { student_id: string }[] | null) ?? []).map((m) => m.student_id)),
    );
    if (studentFilter.length === 0) return [];
  }

  let query = supabase
    .from("guardians")
    .select("id, name, email, student_id, email_status")
    .eq("program_id", programId)
    .eq("email_status", "ok")
    .not("email", "is", null);
  if (studentFilter) query = query.in("student_id", studentFilter);

  const { data } = await query;
  const rows =
    (data as { id: string; name: string; email: string | null }[] | null) ?? [];

  const byEmail = new Map<string, Recipient>();
  for (const g of rows) {
    if (!g.email) continue;
    const key = g.email.trim().toLowerCase();
    if (!key || byEmail.has(key)) continue;
    byEmail.set(key, { guardianId: g.id, name: g.name, email: g.email.trim() });
  }
  return Array.from(byEmail.values());
}

// Minimal, safe markdown-ish → HTML for announcement bodies. Escapes all HTML,
// then turns blank-line-separated blocks into paragraphs and single newlines
// into <br>. Deliberately tiny — no raw HTML from a textarea ever reaches an
// inbox.
export function bodyToHtml(bodyMd: string): string {
  const escaped = escapeHtml(bodyMd);
  const blocks = escaped.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((b) => `<p>${b.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Assemble the full HTML email: body + the three canonical footer links (§8a)
// plus a per-recipient Unsubscribe link (CAN-SPAM). Every guardian-facing email
// footers through here, so the unsubscribe affordance is universal and visible.
export function announcementHtml(args: {
  bodyMd: string;
  links: GuardianLinks;
}): string {
  const body = bodyToHtml(args.bodyMd);
  const { itinerary, signup, absence, unsubscribe } = args.links;
  return `${body}
<hr>
<p style="font-size:0.85rem;color:#666">
  <a href="${itinerary}">Itinerary</a> &nbsp;·&nbsp;
  <a href="${signup}">Volunteer signup</a> &nbsp;·&nbsp;
  <a href="${absence}">Report an absence</a>
</p>
<p style="font-size:0.8rem;color:#999">
  <a href="${unsubscribe}">Unsubscribe</a> from announcements and weekly digests.
</p>`;
}
