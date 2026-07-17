import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";

// Placeholder — competitions, attendance, itineraries, and results land in T009+.
// All roles may at least read competitions (§2), so the gate here is the flag.
export default async function CompetitionsPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program } = await getTenantContext(slug);
  requireFlag(program, "competitions");

  return (
    <section>
      <h1>Competitions</h1>
      <p className="muted">Competitions and attendance arrive in a later task.</p>
    </section>
  );
}
