import Link from "next/link";
import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../Restricted";
import { SubTabs } from "../SubTabs";
import { settingsTabs } from "@/lib/subnav";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_ROLES } from "@/lib/nav";
import {
  formatDateTimeInTz,
  formatTimeZoneLabel,
  TIMEZONES,
} from "@/lib/datetime";
import {
  supportAccessActive,
  SUPPORT_ACCESS_DAYS,
  recentSupportViews,
} from "@/lib/support";
import { activeShareLinks } from "@/lib/tokens";
import { emailHealth } from "@/lib/email";
import { formatDateOnly } from "@/lib/treasury";
import {
  updateProgram,
  grantSupportAccess,
  revokeSupportAccess,
  revokeShareLinkAction,
} from "./actions";

// Program settings (director/admin only). Timezone is IANA (Constitution VII) —
// every itinerary/event time is rendered in this zone, so it's a first-class
// field. The zone list is lib/datetime's — the same one /launch offers.

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const { saved, error } = await searchParams;

  const isDirector = role === "director";
  const supportOn = supportAccessActive(program.support_access_until);

  // Recent support views (T035) — the transparency panel. Scoped to this program
  // by the support_access_log_read RLS policy (director/admin/board).
  const supabase = await createClient();
  const supportViews = await recentSupportViews(supabase, program.id, 10);

  // Active broadcast share links (FR-002 / §8a). Resolve friendly labels:
  // itinerary → competition name, signup_page → season label.
  const shareLinks = await activeShareLinks(supabase, program.id);
  const linkLabels = new Map<string, string>();
  if (shareLinks.length > 0) {
    const compIds = shareLinks.filter((l) => l.resource === "itinerary").map((l) => l.resource_id);
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
        linkLabels.set(c.id, c.name);
    }
    if (seasonIds.length > 0) {
      const { data } = await supabase
        .from("seasons")
        .select("id, label")
        .eq("program_id", program.id)
        .in("id", seasonIds);
      for (const s of (data as { id: string; label: string }[] | null) ?? [])
        linkLabels.set(s.id, s.label);
    }
  }
  const RESOURCE_LABEL: Record<string, string> = {
    itinerary: "Itinerary",
    signup_page: "Volunteer signup",
    packet: "Parent packet",
    season_calendar: "Season calendar",
  };

  // Email health (F1) — presence booleans evaluated server-side (never env
  // values) + guardian inbox-health counts scoped to this program by RLS.
  const health = emailHealth();
  const countGuardians = async (status: string) =>
    (
      await supabase
        .from("guardians")
        .select("id", { count: "exact", head: true })
        .eq("program_id", program.id)
        .eq("email_status", status)
    ).count ?? 0;
  const [okCount, bouncedCount, unsubCount] = await Promise.all([
    countGuardians("ok"),
    countGuardians("bounced"),
    countGuardians("unsubscribed"),
  ]);
  const emailChecks: { ok: boolean; label: string; detail: string }[] = [
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

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "missing" && (
        <p className="alert-error">Name and timezone are required.</p>
      )}
      {error === "save" && (
        <p className="alert-error">Couldn&apos;t save. Try again.</p>
      )}
      {error === "support" && (
        <p className="alert-error">Couldn&apos;t update support access. Try again.</p>
      )}

      <form action={updateProgram} className="stack settings-form">
        <input type="hidden" name="programId" value={program.id} />
        <input type="hidden" name="slug" value={slug} />

        <label>
          Program name
          <input type="text" name="name" defaultValue={program.name} required />
        </label>

        <label>
          Time zone
          <select name="timezone" defaultValue={program.timezone} required>
            {(TIMEZONES.includes(program.timezone)
              ? TIMEZONES
              : [program.timezone, ...TIMEZONES]
            ).map((tz) => (
              <option key={tz} value={tz}>
                {formatTimeZoneLabel(tz)}
              </option>
            ))}
          </select>
        </label>

        <label>
          School name
          <input
            type="text"
            name="school_name"
            defaultValue={program.school_name ?? ""}
          />
        </label>

        <label>
          City
          <input type="text" name="city" defaultValue={program.city ?? ""} />
        </label>

        <label>
          State
          <input type="text" name="state" defaultValue={program.state ?? ""} />
        </label>

        <button type="submit">Save changes</button>
      </form>

      {/* Email health (F1) — deliverability at a glance. Presence booleans only,
          evaluated server-side; env values are never shown. */}
      <div className="panel stack">
        <h2>Email health</h2>
        <p className="muted">
          Whether {brand.name} can reliably reach families. These checks read
          your deployment&apos;s setup — no keys or secrets are ever shown here.
          A red dash means something the person who hosts your deployment needs
          to finish.
        </p>
        <ul className="stack" style={{ listStyle: "none", paddingLeft: 0 }}>
          {emailChecks.map((c) => (
            <li key={c.label}>
              <strong>
                <span aria-hidden="true">{c.ok ? "✓ " : "– "}</span>
                {c.label} — {c.ok ? "OK" : "needs attention"}
              </strong>
              <br />
              <span className="muted">{c.detail}</span>
            </li>
          ))}
          <li>
            <strong>Guardian inbox health</strong>
            <br />
            <span className="muted">
              {okCount} receiving email · {bouncedCount} bounced ·{" "}
              {unsubCount} unsubscribed.{" "}
              {bouncedCount + unsubCount > 0 ? (
                <Link href={`/${slug}/roster/email-issues`}>
                  Review addresses that need attention
                </Link>
              ) : (
                "Every address is good."
              )}
            </span>
          </li>
        </ul>
      </div>

      {/* Support access (§10) — director-only consent toggle. */}
      <div className="panel stack">
        <h2>{brand.name} support access</h2>
        <p className="muted">
          Grant {brand.name} support a read-only view of your program for{" "}
          {SUPPORT_ACCESS_DAYS} days to help troubleshoot. Support can never
          change your data, and a banner shows whenever they are viewing. Sharing
          your password is never necessary.
        </p>
        {supportOn ? (
          <>
            <p className="alert-ok">
              Support access is ON — expires{" "}
              {formatDateTimeInTz(program.support_access_until, program.timezone)}.
            </p>
            {isDirector ? (
              <form action={revokeSupportAccess}>
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className="secondary">
                  Revoke support access now
                </button>
              </form>
            ) : (
              <p className="muted">Only the director can change support access.</p>
            )}
          </>
        ) : isDirector ? (
          <form action={grantSupportAccess}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <button type="submit" className="secondary">
              Grant support access for {SUPPORT_ACCESS_DAYS} days
            </button>
          </form>
        ) : (
          <p className="muted">
            Support access is off. Only the director can grant it.
          </p>
        )}

        {/* Recent support views (T035) — the durable audit trail, for you. */}
        <h3>Recent support views</h3>
        {supportViews.length === 0 ? (
          <p className="muted">
            No support views recorded. This list fills in only when {brand.name}{" "}
            support opens your program under an active consent window.
          </p>
        ) : (
          <table className="members">
            <thead>
              <tr>
                <th>When</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {supportViews.map((v, i) => (
                <tr key={i}>
                  <td>{formatDateTimeInTz(v.at, program.timezone)}</td>
                  <td className="muted">{v.path ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Share links (FR-002 / §8a) — active broadcast links + revoke. */}
      <div className="panel stack">
        <h2>Share links</h2>
        <p className="muted">
          Read-only broadcast links you have handed out (an itinerary, a season&apos;s
          volunteer signup). For privacy the URL itself is shown only once when a
          link is created — mint or regenerate links from the itinerary and shifts
          pages. Revoke a link here to make its URL stop working immediately.
        </p>
        {shareLinks.length === 0 ? (
          <p className="muted">No active share links.</p>
        ) : (
          <table className="members">
            <thead>
              <tr>
                <th>Link</th>
                <th>Created</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shareLinks.map((l) => (
                <tr key={l.id}>
                  <td>
                    {RESOURCE_LABEL[l.resource] ?? l.resource}
                    {linkLabels.get(l.resource_id) ? (
                      <span className="muted"> · {linkLabels.get(l.resource_id)}</span>
                    ) : null}
                  </td>
                  <td className="muted">{formatDateOnly(l.created_at)}</td>
                  <td className="muted">{l.expires_at ? formatDateOnly(l.expires_at) : "Never"}</td>
                  <td>
                    <form action={revokeShareLinkAction}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="shareLinkId" value={l.id} />
                      <button type="submit" className="linklike danger">
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
