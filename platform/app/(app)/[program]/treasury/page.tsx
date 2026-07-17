import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { TREASURY_ROLES } from "@/lib/nav";

// Placeholder — budget builder, ledger, and budget-vs-actual land in T015+.
// Treasury read is director/admin/treasurer/board_member; costume_manager has no
// money access (§2). Flagged-off or role-forbidden → 404.
export default async function TreasuryPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "treasury");
  if (!TREASURY_ROLES.includes(role)) notFound();

  return (
    <section>
      <h1>Treasury</h1>
      <p className="muted">Budget and ledger arrive in a later task.</p>
    </section>
  );
}
