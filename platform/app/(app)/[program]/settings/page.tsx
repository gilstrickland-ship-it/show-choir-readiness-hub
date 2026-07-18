import Link from "next/link";
import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { SETTINGS_ROLES } from "@/lib/nav";
import { formatDateTimeInTz } from "@/lib/datetime";
import { supportAccessActive, SUPPORT_ACCESS_DAYS } from "@/lib/support";
import {
  updateProgram,
  grantSupportAccess,
  revokeSupportAccess,
} from "./actions";

// Program settings (director/admin only). Timezone is IANA (Constitution VII) —
// every itinerary/event time is rendered in this zone, so it's a first-class
// field. Curated common-zone list covers the show-choir corridor; extend as
// programs onboard outside it.
const TIMEZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) notFound();
  const { saved, error } = await searchParams;

  const isDirector = role === "director";
  const supportOn = supportAccessActive(program.support_access_until);

  return (
    <section className="stack">
      <div className="settings-tabs">
        <strong>Program</strong>
        <Link href={`/${slug}/settings/members`}>Members</Link>
        <Link href={`/${slug}/settings/rollover`}>Rollover &amp; Archive</Link>
        <Link href={`/${slug}/settings/export`}>Export &amp; Data</Link>
      </div>
      <h1>Program settings</h1>

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

      <form action={updateProgram} className="stack">
        <input type="hidden" name="programId" value={program.id} />
        <input type="hidden" name="slug" value={slug} />

        <label>
          Program name
          <input type="text" name="name" defaultValue={program.name} required />
        </label>

        <label>
          Timezone (IANA)
          <select name="timezone" defaultValue={program.timezone} required>
            {(TIMEZONES.includes(program.timezone)
              ? TIMEZONES
              : [program.timezone, ...TIMEZONES]
            ).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
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

      {/* Support access (§10) — director-only consent toggle. */}
      <div className="confirm-box stack" style={{ width: "100%" }}>
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
      </div>
    </section>
  );
}
