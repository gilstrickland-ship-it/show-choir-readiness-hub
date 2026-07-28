import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { SubTabs } from "../../SubTabs";
import { rosterTabs } from "@/lib/subnav";
import { ImportClient } from "./ImportClient";

// Combined roster CSV import (T008). One spreadsheet → students + guardians.
// director/admin only. The parse/preview/commit interactivity lives in the
// client component; everything security-relevant (role check, parsing, insert)
// runs in server actions.
//
// The first-use intro strip is gone (spec 005 Wave 9 / T146): it said "bring the
// spreadsheet you already have", "Charms and CutTime exports work as-is" and
// "any health or medical column is refused" — the same three facts the three
// paragraphs below state permanently, to everyone, without a Got-it button.
export default async function RosterImportPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!ROSTER_WRITE_ROLES.includes(role)) {
    return (
      <Restricted
        slug={slug}
        surface="People"
        role={role}
        allowed={ROSTER_WRITE_ROLES}
      />
    );
  }

  return (
    <section className="stack">
      <SubTabs strip={rosterTabs(slug, "import", true)} />
      <h1>Import roster</h1>
      <p className="muted">
        Upload the spreadsheet you already have — one row per student, with size
        columns and one or more guardians (repeated columns like{" "}
        <code>Guardian 2 Email</code>, or repeated rows for the same student
        both work). You&apos;ll see a preview before anything is saved.
      </p>
      <p className="muted">
        Health and medical columns are detected by their header and skipped
        entirely — this product does not store that information.
      </p>
      <p className="muted">
        Exports from Charms or CutTime work as-is — no cleanup needed.
      </p>

      <ImportClient programId={program.id} />
    </section>
  );
}
