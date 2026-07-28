import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "../RosterTabs";
import { updateSizeFields } from "../actions";

// Size-field config (architecture-spec §3, open decision §14.4). Programs measure
// differently, so the keys in students.sizes jsonb are program-defined. Stored on
// programs.size_fields; director/admin only.
export default async function RosterSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!ROSTER_WRITE_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_WRITE_ROLES} />
    );
  }
  const { saved, error } = await searchParams;

  const keys = program.size_fields ?? [];

  return (
    <section className="stack">
      <RosterTabs slug={slug} active="settings" canWrite />
      <h1>Size fields</h1>
      <p className="muted">
        Programs measure differently, so you choose what gets measured. Whatever
        you list here becomes the size boxes on every student&apos;s page, and
        the size columns the spreadsheet import knows to look for.
      </p>
      <p className="muted">
        One per line. Most programs use <code>top</code>, <code>bottom</code>,{" "}
        <code>dress</code> and <code>shoe</code>.
      </p>

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "empty" && (
        <p className="alert-error">
          List at least one thing to measure — an empty list would leave every
          student with nowhere to record a size.
        </p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      <form action={updateSizeFields} className="stack">
        <input type="hidden" name="programId" value={program.id} />
        <input type="hidden" name="slug" value={slug} />
        <label>
          What you measure
          <textarea name="size_fields" rows={5} defaultValue={keys.join("\n")} />
        </label>
        <button type="submit">Save size fields</button>
      </form>
      <p className="page-foot">
        Removing a line takes that box off the student pages. Sizes already
        recorded under it stop being shown, so rename with care — a line you take
        out and put back under a different spelling starts empty.
      </p>
    </section>
  );
}
