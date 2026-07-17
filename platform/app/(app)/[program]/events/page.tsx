import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";

// Placeholder — general events (rehearsals, fittings, banquets) land in T009+.
export default async function EventsPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program } = await getTenantContext(slug);
  requireFlag(program, "events");

  return (
    <section>
      <h1>Events</h1>
      <p className="muted">The events calendar arrives in a later task.</p>
    </section>
  );
}
