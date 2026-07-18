import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { COMMS_ROLES } from "@/lib/nav";
import { CommsTabs } from "../CommsTabs";

// Comms — Digest tab placeholder. The weekly AI digest draft/review/approve/send
// pipeline lands in T025 (Inngest cron → Claude draft → director approval →
// Resend with per-family links). This tab exists now so the comms sub-nav is
// complete; it is deliberately inert until T025.
export default async function DigestPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "comms");
  if (!COMMS_ROLES.includes(role)) notFound();

  return (
    <section className="stack">
      <CommsTabs slug={slug} active="digest" />
      <h1>Weekly digest</h1>
      <p className="muted">
        The weekly digest — an AI-drafted summary a director reviews and approves
        before it sends — arrives in a later task (T025). It will never auto-send:
        no approval by the deadline means a reminder, not a send.
      </p>
    </section>
  );
}
