import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { SubTabs } from "../SubTabs";
import { settingsTabs } from "@/lib/subnav";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_ROLES } from "@/lib/nav";
import { readFlash, oneParam } from "@/lib/flash";
import { supportAccessActive, recentSupportViews } from "@/lib/support";
import { activeShareLinks, type ActiveShareLink } from "@/lib/tokens";
import { emailHealth } from "@/lib/email";
import { commitmentThresholds } from "@/lib/treasury";
import { ProgramSection } from "./ProgramSection";
import { SpendingRulesSection } from "./SpendingRulesSection";
import { ShareLinksSection } from "./ShareLinksSection";
import { EmailHealthSection, type EmailCheck } from "./EmailHealthSection";
import { SupportAccessSection } from "./SupportAccessSection";
import {
  SETTINGS_ANCHOR,
  SETTINGS_FLASH_MAPS,
  type SettingsSection,
} from "./shared";

// Settings § Program (director/admin). Four unrelated admin concerns used to be
// stacked here under one <h1> with no heading between them: the program's own
// details as an always-open form, then email deliverability, then the support
// consent toggle, then the share-link listing — in that order because that is the
// order they were built in.
//
// Spec 005 Wave 13 / T164 gives them a CONSTANT order and a title each —
// Program · Share links · Email health · Support access — with a live summary
// beside every heading, so the four questions this page answers ("who are we",
// "what have we handed out", "can we reach families", "is anyone from support
// looking") are all answerable without opening or scrolling anything. Mutations
// sit behind labeled disclosures inside their own section, and a message about a
// write lands in the section that produced it (lib/flash), not in a pile at the
// top that the reader then has to map back to a control.
//
// This file loads; the four siblings draw (RQ-6b).

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?error=a&error=b), so this
  // is typed as what it really is and every read goes through lib/flash.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, flags } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const sp = await searchParams;
  const flash = readFlash<SettingsSection>(sp, SETTINGS_FLASH_MAPS);

  // Revoking a share link is the app's only irreversible act, so it asks first
  // (T143e) — the same two-step every other destructive control uses. The first
  // press is a LINK to `?confirm=revoke_<linkId>`; the box that address opens is
  // the only place a form that posts the revoke exists. An id that names no live
  // link simply matches no row, so a hand-typed address opens nothing.
  const confirmParam = oneParam(sp, "confirm");
  const confirmRevokeId = confirmParam?.startsWith("revoke_")
    ? confirmParam.slice("revoke_".length)
    : null;
  // Asking, and cancelling, both land back on the section that owns the row.
  const revokeHref = (linkId: string | null): string =>
    `/${slug}/settings${
      linkId ? `?confirm=revoke_${encodeURIComponent(linkId)}` : ""
    }#${SETTINGS_ANCHOR.share}`;

  const isDirector = role === "director";
  const tz = program.timezone;
  const supportOn = supportAccessActive(program.support_access_until);

  const supabase = await createClient();

  // Recent support views (T035) — the transparency panel. Scoped to this program
  // by the support_access_log_read RLS policy (director/admin/board).
  const supportViews = await recentSupportViews(supabase, program.id, 10);

  // Active broadcast share links (FR-002 / §8a). Resolve friendly subjects:
  // an itinerary link names its competition, a signup or calendar link its season.
  const { links: shareLinks, unavailable: shareLinksUnavailable } =
    await activeShareLinks(supabase, program.id);
  const linkSubjects = new Map<string, string>();
  if (shareLinks.length > 0) {
    const compIds = shareLinks
      .filter((l) => l.resource === "itinerary" || l.resource === "packet")
      .map((l) => l.resource_id);
    // Both signup_page and season_calendar links are scoped to a season id.
    const seasonIds = shareLinks
      .filter((l) => l.resource === "signup_page" || l.resource === "season_calendar")
      .map((l) => l.resource_id);
    if (compIds.length > 0) {
      const { data } = await supabase
        .from("competitions")
        .select("id, name")
        .eq("program_id", program.id)
        .in("id", compIds);
      for (const c of (data as { id: string; name: string }[] | null) ?? [])
        linkSubjects.set(c.id, c.name);
    }
    if (seasonIds.length > 0) {
      const { data } = await supabase
        .from("seasons")
        .select("id, label")
        .eq("program_id", program.id)
        .in("id", seasonIds);
      for (const s of (data as { id: string; label: string }[] | null) ?? [])
        linkSubjects.set(s.id, s.label);
    }
  }
  const subjectFor = (l: ActiveShareLink): string | null =>
    linkSubjects.get(l.resource_id) ?? null;

  // Email health (F1) — presence booleans evaluated server-side (never env
  // values) + guardian inbox-health counts scoped to this program by RLS.
  const health = emailHealth();
  // `count ?? 0` used to swallow a failed count, and the section then printed
  // "Every address is good." — a claim about whether this program can reach its
  // families, made out of a read that did not happen. A count we do not have is
  // null, and the section says so instead.
  const countGuardians = async (status: string): Promise<number | null> => {
    const { count, error } = await supabase
      .from("guardians")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("email_status", status);
    return error ? null : (count ?? 0);
  };
  const [okCount, bouncedCount, unsubCount] = await Promise.all([
    countGuardians("ok"),
    countGuardians("bounced"),
    countGuardians("unsubscribed"),
  ]);
  const emailChecks: EmailCheck[] = [
    {
      ok: health.sendingConfigured,
      label: "Sending configured",
      detail: health.sendingConfigured
        ? "A mail provider key is set, so the app can send email."
        : "No mail provider key is set — email can't go out yet. Ask whoever hosts your deployment to add the Resend API key.",
    },
    {
      ok: health.webhookSigning,
      label: "Webhook signing",
      detail: health.webhookSigning
        ? "Bounces and unsubscribes arrive verified-signed."
        : "Bounce and unsubscribe notices aren't verified yet. Ask whoever hosts your deployment to set the Resend webhook signing secret.",
    },
    {
      ok: health.fromDomainOk,
      label: "From-address domain",
      detail: health.fromDomainOk
        ? "Email is sent from your program's own verified domain."
        : "The address email is sent from doesn't match a verified program domain — messages may be filtered as spam. Ask whoever hosts your deployment to set a verified sending domain.",
    },
  ];

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Program · Members · Seasons · Export &amp; data</p>
          <h1 className="page-h1">Settings</h1>
        </div>
      </div>

      <SubTabs strip={settingsTabs(slug, "program")} />
      <p className="muted">
        Who this program is,{" "}
        {flags.treasury ? "what your spending answers to, " : ""}what you have
        shared outside it, whether {brand.name} can reach your families, and who
        from support can look.
      </p>

      <ProgramSection slug={slug} flash={flash} program={program} />

      {/* The spending rules only exist where there is money to govern — same
          lean-by-construction gate every other flagged surface uses. */}
      {flags.treasury && (
        <SpendingRulesSection
          slug={slug}
          programId={program.id}
          flash={flash}
          thresholds={commitmentThresholds(program)}
        />
      )}

      <ShareLinksSection
        programId={program.id}
        slug={slug}
        tz={tz}
        flash={flash}
        links={shareLinks}
        unavailable={shareLinksUnavailable}
        labelFor={subjectFor}
        confirmRevokeId={confirmRevokeId}
        revokeHref={revokeHref}
      />

      <EmailHealthSection
        slug={slug}
        checks={emailChecks}
        guardians={{
          ok: okCount,
          bounced: bouncedCount,
          unsubscribed: unsubCount,
        }}
      />

      <SupportAccessSection
        programId={program.id}
        slug={slug}
        tz={tz}
        flash={flash}
        isDirector={isDirector}
        activeUntil={supportOn ? program.support_access_until : null}
        views={supportViews.views}
        viewsUnavailable={supportViews.unavailable}
      />
    </section>
  );
}
