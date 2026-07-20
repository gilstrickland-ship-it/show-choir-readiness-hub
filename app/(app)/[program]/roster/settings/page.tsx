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
        These keys become the size inputs on every student and the size columns
        the CSV import recognizes. One key per line (or comma-separated), e.g.{" "}
        <code>top</code>, <code>bottom</code>, <code>dress</code>, <code>shoe</code>.
      </p>

      {saved && <p className="alert-ok">Saved.</p>}
      {error === "empty" && (
        <p className="alert-error">Enter at least one size field.</p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      <form action={updateSizeFields} className="stack">
        <input type="hidden" name="programId" value={program.id} />
        <input type="hidden" name="slug" value={slug} />
        <label>
          Size fields
          <textarea name="size_fields" rows={5} defaultValue={keys.join("\n")} />
        </label>
        <button type="submit">Save size fields</button>
      </form>
    </section>
  );
}
