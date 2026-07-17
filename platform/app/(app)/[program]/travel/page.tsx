import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";

// Placeholder — trips, rooms, buses, and chaperones land in T013+. All roles may
// at least read travel (§2), so the gate here is the flag.
export default async function TravelPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program } = await getTenantContext(slug);
  requireFlag(program, "travel");

  return (
    <section>
      <h1>Travel</h1>
      <p className="muted">Trip rosters arrive in a later task.</p>
    </section>
  );
}
