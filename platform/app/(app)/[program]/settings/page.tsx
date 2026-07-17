import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { SETTINGS_ROLES } from "@/lib/nav";
import { updateProgram } from "./actions";

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

  return (
    <section className="stack">
      <div className="settings-tabs">
        <strong>Program</strong>
        <Link href={`/${slug}/settings/members`}>Members</Link>
      </div>
      <h1>Program settings</h1>

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "missing" && (
        <p className="alert-error">Name and timezone are required.</p>
      )}
      {error === "save" && (
        <p className="alert-error">Couldn&apos;t save. Try again.</p>
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
    </section>
  );
}
