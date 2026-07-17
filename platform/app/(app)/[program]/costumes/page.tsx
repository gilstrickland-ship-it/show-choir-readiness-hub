import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { COSTUMES_ROLES } from "@/lib/nav";

// Placeholder — real costume system lands in T007+. Gating is real from day one:
// flagged-off → 404, role-forbidden (treasurer has no costume access) → 404.
export default async function CostumesPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "costumes");
  if (!COSTUMES_ROLES.includes(role)) notFound();

  return (
    <section>
      <h1>Costumes</h1>
      <p className="muted">Costume inventory and assignments arrive in a later task.</p>
    </section>
  );
}
