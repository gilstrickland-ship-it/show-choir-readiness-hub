import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "../../Restricted";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { RosterTabs } from "../RosterTabs";
import { ImportClient } from "./ImportClient";
import { IntroStrip, HelpDot } from "../../IntroStrip";
import { loadGuideState } from "@/lib/guide";

// Combined roster CSV import (T008). One spreadsheet → students + guardians.
// director/admin only. The parse/preview/commit interactivity lives in the
// client component; everything security-relevant (role check, parsing, insert)
// runs in server actions.
export default async function RosterImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ help?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role, flags, membership, isSupport } =
    await getTenantContext(slug);
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
  const sp = await searchParams;

  // First-use intro strip (spec 003 §3) — bring your existing spreadsheet.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(
          await createClient(),
          program.id,
          membership.user_id,
        )
      : {};

  return (
    <section className="stack">
      <RosterTabs slug={slug} active="import" canWrite />
      <div className="page-title-row">
        <h1>Import roster</h1>
        {showGuide && <HelpDot href={`/${slug}/roster/import?help=1`} />}
      </div>
      {showGuide && (
        <IntroStrip
          surfaceKey="import"
          programId={program.id}
          selfPath={`/${slug}/roster/import`}
          guideState={guideState}
          help={sp.help === "1"}
        />
      )}
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
