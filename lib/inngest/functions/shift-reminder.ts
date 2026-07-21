import * as Sentry from "@sentry/nextjs";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { flag, type FlaggableProgram } from "@/lib/flags";
import { formatDateTimeInTz } from "@/lib/datetime";
import { sendGuardianNotification, shiftAttachmentName } from "@/lib/comms-send";

// Day-before volunteer-shift reminders (§8, C1-3). A daily cron that, for every
// program with the `shifts` flag on, finds shifts starting in the next 24–48h and
// reminds each confirmed, guardian-linked signup exactly once. Idempotency: we
// STAMP reminded_at (guarded by `reminded_at IS NULL`) to claim the row BEFORE
// sending, so an Inngest retry re-filters already-stamped rows and never
// double-mails — the same "re-read state, guard, then act" idiom the digest send
// uses. Fires 9am US Central daily.
//
// SCOPE: only guardian-LINKED signups are reminded. Staff-entered signups store a
// bare name/email with no guardian_id, so they have no tokenized link to mint —
// and every guardian email must carry a per-recipient unsubscribe link + one-click
// header, which requires a guardian token. Emailing tokenless signups would break
// that invariant, so they're intentionally out of scope (documented decision).
//
// Inert without INNGEST infra (the cron simply never fires); email degrades via
// the shared no-key path (sends report 'skipped_no_key', nothing throws).

interface ProgramRow extends FlaggableProgram {
  id: string;
  timezone: string;
}

interface ShiftRow {
  id: string;
  title: string;
  starts_at: string | null;
  competition_id: string | null;
  trip_id: string | null;
  event_id: string | null;
}

export const shiftReminderCron = inngest.createFunction(
  {
    id: "shift-reminder-cron",
    name: "Day-before shift reminders",
    triggers: [{ cron: "TZ=America/Chicago 0 9 * * *" }],
  },
  async ({ step }) => {
    const result = await step.run("remind", async () => {
      const supabase = createAdminClient();

      const { data: progData } = await supabase
        .from("programs")
        .select("id, timezone, tier, feature_overrides");
      const programs = ((progData as ProgramRow[] | null) ?? []).filter((p) =>
        flag(p, "shifts"),
      );

      const now = Date.now();
      const fromIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      const toIso = new Date(now + 48 * 60 * 60 * 1000).toISOString();
      const stampIso = new Date(now).toISOString();

      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const p of programs) {
        // Shifts starting inside the 24–48h window (timeless shifts excluded —
        // a reminder needs a concrete start time).
        const { data: shiftData } = await supabase
          .from("shifts")
          .select("id, title, starts_at, competition_id, trip_id, event_id")
          .eq("program_id", p.id)
          .gte("starts_at", fromIso)
          .lte("starts_at", toIso);
        const shifts = (shiftData as ShiftRow[] | null) ?? [];

        for (const shift of shifts) {
          const { data: suData } = await supabase
            .from("shift_signups")
            .select("id, guardian_id")
            .eq("program_id", p.id)
            .eq("shift_id", shift.id)
            .eq("status", "confirmed")
            .not("guardian_id", "is", null)
            .is("reminded_at", null);
          const signups =
            (suData as { id: string; guardian_id: string }[] | null) ?? [];
          if (signups.length === 0) continue;

          // Resolve deliverable guardians in one query.
          const guardianIds = Array.from(new Set(signups.map((s) => s.guardian_id)));
          const { data: gData } = await supabase
            .from("guardians")
            .select("id, email, email_status")
            .eq("program_id", p.id)
            .in("id", guardianIds);
          const okGuardian = new Map<string, string>();
          for (const g of (gData as
            | { id: string; email: string | null; email_status: string }[]
            | null) ?? []) {
            if (g.email && g.email_status === "ok") okGuardian.set(g.id, g.email);
          }

          const attachedTo = await shiftAttachmentName(supabase, {
            programId: p.id,
            competitionId: shift.competition_id,
            tripId: shift.trip_id,
            eventId: shift.event_id,
          });
          const whenLabel = formatDateTimeInTz(shift.starts_at, p.timezone);

          for (const su of signups) {
            const email = okGuardian.get(su.guardian_id);
            // Claim the row first (idempotent): only the caller that flips
            // reminded_at from NULL proceeds to send.
            const { data: claimed } = await supabase
              .from("shift_signups")
              .update({ reminded_at: stampIso })
              .eq("id", su.id)
              .eq("program_id", p.id)
              .is("reminded_at", null)
              .select("id");
            if (((claimed as { id: string }[] | null) ?? []).length === 0) continue;

            // Guardian isn't deliverable → row stays claimed (don't re-check daily
            // for a bounced/unsubscribed address); nothing to send.
            if (!email) {
              skipped++;
              continue;
            }

            const forLine = attachedTo ? `\n\nThis is for ${attachedTo}.` : "";
            const bodyMd =
              `A reminder that you're signed up to volunteer for "${shift.title}".\n\n` +
              `When: ${whenLabel}${forLine}\n\n` +
              `Need to cancel? Use the volunteer signup link below.`;

            const res = await sendGuardianNotification(supabase, {
              programId: p.id,
              guardianId: su.guardian_id,
              email,
              subject: `Reminder: ${shift.title} — ${whenLabel}`,
              bodyMd,
            });
            if (res.status === "sent") sent++;
            else if (res.status === "skipped_no_key") skipped++;
            else failed++;
          }
        }
      }

      return { programs: programs.length, sent, skipped, failed };
    });

    // Surface the run outcome (§10) — a silent no-op cron is invisible otherwise.
    Sentry.addBreadcrumb({
      category: "cron",
      level: "info",
      message: "shift-reminder run",
      data: result,
    });
    return result;
  },
);
