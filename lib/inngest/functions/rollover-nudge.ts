import * as Sentry from "@sentry/nextjs";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/tokens";
import { formatDateInTz, zonedDateKey } from "@/lib/datetime";

// Season rollover-nudge cron (§10 Inngest list, T037). A spring reminder: for
// each program whose ACTIVE season ends within ~90 days and that has NOT already
// created a newer season, nudge the director/admin to start rollover. Small and
// honest — it logs what it found and, when email is configured, sends a nudge;
// with no email key it degrades to a log line (the rollover wizard is always
// reachable in Settings, so nothing is blocked). Fires 9am on Apr 1 and May 1
// (US Central), the window show-choir programs plan next season.

const NUDGE_WINDOW_DAYS = 90;

interface ProgramRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

interface SeasonRow {
  id: string;
  starts_on: string | null;
  ends_on: string | null;
}

export const rolloverNudgeCron = inngest.createFunction(
  {
    id: "season-rollover-nudge",
    name: "Season rollover nudge",
    triggers: [{ cron: "TZ=America/Chicago 0 9 1 4,5 *" }],
  },
  async ({ step }) => {
    const result = await step.run("nudge", async () => {
      const supabase = createAdminClient();
      const now = new Date();
      const horizon = new Date(now.getTime() + NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const { data: progRows } = await supabase
        .from("programs")
        .select("id, name, slug, timezone");
      const programs = (progRows as ProgramRow[] | null) ?? [];

      let nudged = 0;
      let emailsSent = 0;

      for (const p of programs) {
        // `seasons.ends_on` is a plain calendar day, so the two keys it is
        // compared against are the program's own calendar days — not UTC's. This
        // cron fires at 9am Central, where a UTC key is still the same date, but
        // the window edge is a date comparison and every other date comparison
        // in the app is now the program's (spec 005 Wave 14).
        const todayKey = zonedDateKey(now, p.timezone);
        const horizonKey = zonedDateKey(horizon, p.timezone);

        // Active season for the program.
        const { data: activeRow } = await supabase
          .from("seasons")
          .select("id, starts_on, ends_on")
          .eq("program_id", p.id)
          .eq("is_active", true)
          .maybeSingle();
        const active = activeRow as SeasonRow | null;
        if (!active?.ends_on) continue;

        // Ending within the window (and not already past)?
        if (active.ends_on < todayKey || active.ends_on > horizonKey) continue;

        // A newer season already created (rollover started)? Then skip.
        const { count: newerCount } = await supabase
          .from("seasons")
          .select("id", { count: "exact", head: true })
          .eq("program_id", p.id)
          .neq("id", active.id)
          .gt("starts_on", active.starts_on ?? active.ends_on);
        if ((newerCount ?? 0) > 0) continue;

        nudged++;
        console.info(
          `[rollover-nudge] program=${p.slug} (${p.id}) active season ends ${active.ends_on} — no newer season yet`,
        );

        // Resolve director/admin emails; nudge when email is configured.
        const { data: members } = await supabase
          .from("program_members")
          .select("user_id")
          .eq("program_id", p.id)
          .in("role", ["director", "admin"])
          .eq("status", "active")
          .not("user_id", "is", null);
        const emails: string[] = [];
        for (const m of (members as { user_id: string }[] | null) ?? []) {
          try {
            const { data: u } = await supabase.auth.admin.getUserById(m.user_id);
            if (u.user?.email) emails.push(u.user.email);
          } catch {
            // ignore — the log line above already recorded the nudge.
          }
        }

        const rolloverUrl = `${appBaseUrl()}/${p.slug}/settings/rollover`;
        for (const to of Array.from(new Set(emails))) {
          const res = await sendEmail({
            to,
            subject: `Time to plan next season for ${p.name}`,
            html: `<p>Your current season wraps up soon (ends ${formatDateInTz(`${active.ends_on}T12:00:00Z`, p.timezone)}) and you haven't started next season yet.</p>
<p>When you're ready, the <a href="${rolloverUrl}">season rollover wizard</a> carries your ensembles forward, lets you pick returning students, and re-points costume sets — then you activate the new season.</p>
<p>No rush, and nothing changes until you do it.</p>`,
          });
          if (res.status === "sent") emailsSent++;
        }
      }

      return { nudged, emailsSent };
    });

    // Surface the run outcome (§10) — a silent no-op cron is invisible otherwise.
    Sentry.addBreadcrumb({
      category: "cron",
      level: "info",
      message: "rollover-nudge run",
      data: result,
    });
    return result;
  },
);
