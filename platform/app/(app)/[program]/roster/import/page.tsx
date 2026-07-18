import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "../RosterTabs";
import { ImportClient } from "./ImportClient";

// Combined roster CSV import (T008). One spreadsheet → students + guardians.
// director/admin only. The parse/preview/commit interactivity lives in the
// client component; everything security-relevant (role check, parsing, insert)
// runs in server actions.
export default async function RosterImportPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!ROSTER_WRITE_ROLES.includes(role)) notFound();

  return (
    <section className="stack">
      <RosterTabs slug={slug} active="import" canWrite />
      <h1>Import roster</h1>
      <p className="muted">
        Upload the spreadsheet you already have — one row per student, with size
        columns and one or more guardians (repeated columns like{" "}
        <code>Guardian 2 Email</code>, or repeated rows for the same student both
        work). You&apos;ll see a preview before anything is saved.
      </p>
      <p className="muted">
        Health and medical columns are detected by their header and skipped
        entirely — this product does not store that information.
      </p>

      <ImportClient programId={program.id} />
    </section>
  );
}
