import { brand } from "@/lib/brand";
import { formatDateTimeInTz } from "@/lib/datetime";
import type { PageFlash } from "@/lib/flash";
import { SUPPORT_ACCESS_DAYS, type SupportView } from "@/lib/support";
import { Flash } from "../Flash";
import { grantSupportAccess, revokeSupportAccess } from "./actions";
import { SETTINGS_ANCHOR, type SettingsSection } from "./shared";

// Settings § Support access (§10, T030/T035) — the director's consent toggle,
// and the audit trail that makes it checkable.
//
// This section's WORDS are part of the product's promise, so Wave 13 moved it
// and left the sentences alone. What the grant actually is, said plainly and
// completely: a time-boxed, read-only window of exactly SUPPORT_ACCESS_DAYS
// days; support can never write; a banner shows on every page while they are
// looking; the window ends by itself; the director can end it sooner with one
// click. The RLS policies in 0004 are the real boundary — this only sets and
// clears programs.support_access_until — and granting it is director-only, so
// even an admin who can rename the program cannot open the door.
//
// "Recent support views" is the other half and is never hidden behind anything:
// consent you cannot audit is not consent. The rows come from support_access_log
// (T035), which is written by the service role only — not even a support user
// inside an open window can forge or erase an entry.

export function SupportAccessSection({
  programId,
  slug,
  tz,
  flash,
  isDirector,
  activeUntil,
  views,
  viewsUnavailable,
}: {
  programId: string;
  slug: string;
  tz: string;
  flash: PageFlash<SettingsSection>;
  isDirector: boolean;
  // The consent window's end, or null when it is closed.
  activeUntil: string | null;
  views: SupportView[];
  // The audit read having failed. "No support views recorded" is an assurance
  // about who has looked at this program's data, so it is never printed out of
  // a read that did not happen (lib/support recentSupportViews).
  viewsUnavailable: boolean;
}) {
  const summary = activeUntil
    ? `On until ${formatDateTimeInTz(activeUntil, tz)}`
    : "Off";

  return (
    <section id={SETTINGS_ANCHOR.support} className="panel stack">
      <div className="travel-section-head">
        <h2>{brand.name} support access</h2>
        <span className="travel-section-summary">{summary}</span>
      </div>
      <Flash flash={flash} section="support" />
      <p className="muted">
        Grant {brand.name} support a read-only view of your program for{" "}
        {SUPPORT_ACCESS_DAYS} days to help troubleshoot. Support can never change
        your data, and a banner shows whenever they are viewing. The window ends
        by itself after {SUPPORT_ACCESS_DAYS} days — you don&apos;t have to
        remember to close it — and you can end it sooner at any time. Sharing
        your password is never necessary.
      </p>

      {activeUntil ? (
        <>
          <p className="alert-ok">
            Support access is ON — it ends {formatDateTimeInTz(activeUntil, tz)}.
          </p>
          {isDirector ? (
            <form action={revokeSupportAccess}>
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="secondary">
                End support access now
              </button>
            </form>
          ) : (
            <p className="muted">Only the director can change support access.</p>
          )}
        </>
      ) : isDirector ? (
        <form action={grantSupportAccess}>
          <input type="hidden" name="programId" value={programId} />
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

      {/* The durable audit trail (T035), for you — never behind a disclosure. */}
      <h3>Recent support views</h3>
      {viewsUnavailable ? (
        <p className="alert-error">
          This trail couldn&apos;t be read just now, so it is blank rather than
          empty — it is not saying nobody looked. Reload to try again.
        </p>
      ) : views.length === 0 ? (
        <p className="muted">
          No support views recorded. This list fills in only when {brand.name}{" "}
          support opens your program while consent is on.
        </p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>When</th>
              <th>What they opened</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v, i) => (
              <tr key={i}>
                <td>{formatDateTimeInTz(v.at, tz)}</td>
                <td className="muted">{v.path ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
