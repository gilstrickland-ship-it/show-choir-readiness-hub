import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { COMMS_ROLES } from "@/lib/nav";

// Placeholder — announcements, shifts, and the digest pipeline land in T017+.
// Comms is hidden from board_member (read-only seat, no shift/announcement
// management) per the task. Flagged-off or role-forbidden → 404.
export default async function CommsPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "comms");
  if (!COMMS_ROLES.includes(role)) notFound();

  return (
    <section>
      <h1>Comms</h1>
      <p className="muted">Announcements and the weekly digest arrive in a later task.</p>
    </section>
  );
}
