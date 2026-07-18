import Link from "next/link";
import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { SETTINGS_ROLES } from "@/lib/nav";

// Settings → Export & Data (§13.2, §13.3, T029). director/admin. Two halves:
//   • Export everything — a real button producing one zip of CSVs + generated
//     PDFs (the anti-lock-in trust answer and the handoff-vault escape hatch).
//   • Deletion story — the documented 30-day soft-window policy plus a support
//     contact to request deletion. There is intentionally NO deletion_requested_at
//     column and no self-serve purge button: deletion is a human-reviewed support
//     action (a mistaken click must not start a countdown to erasing a booster
//     org's records), so this is a mailto to brand.supportEmail, brand-config aware.

export default async function ExportPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) notFound();

  const deletionSubject = encodeURIComponent(
    `Deletion request — ${program.name} (${slug})`,
  );
  const deletionBody = encodeURIComponent(
    `We request deletion of our ${brand.name} program "${program.name}" (slug: ${slug}).\n\n` +
      `We understand deletion is a 30-day soft window: our data is disabled immediately ` +
      `and permanently purged (including stored files and access links) after 30 days, and ` +
      `can be restored within that window. Please confirm.`,
  );

  return (
    <section className="stack">
      <div className="settings-tabs">
        <Link href={`/${slug}/settings`}>Program</Link>
        <Link href={`/${slug}/settings/members`}>Members</Link>
        <Link href={`/${slug}/settings/rollover`}>Rollover &amp; Archive</Link>
        <strong>Export &amp; Data</strong>
      </div>
      <h1>Export &amp; data</h1>

      <div className="confirm-box stack" style={{ width: "100%" }}>
        <h2>Export everything</h2>
        <p className="muted">
          Download a single zip with your full program as spreadsheets (roster,
          guardians, ensemble members, attendance, costume inventory and
          assignments, ledger, budget, and results) plus every generated PDF —
          published parent packets, bus manifests, room sheets, and board
          snapshots. Your data is yours; this button proves it.
        </p>
        {/* Anchor download (not a client fetch) so the browser streams the zip. */}
        <a href={`/${slug}/settings/export/download`}>
          <button type="button">Download export (.zip)</button>
        </a>
        <p className="muted">
          Large programs may take a few seconds to build. (Upgrade path: an async
          job that emails a link — see the route comment.)
        </p>
      </div>

      <div className="confirm-box stack" style={{ width: "100%" }}>
        <h2>Delete this program</h2>
        <p className="muted">
          Program deletion uses a <strong>30-day soft window</strong>: access is
          disabled immediately, and after 30 days everything is permanently
          purged — database rows, stored files (receipts, packets), and all
          tokenized parent links. Within the 30 days it can be fully restored.
          Because this erases a booster organization&apos;s records, {brand.name}{" "}
          processes deletion as a reviewed support request rather than a one-click
          button.
        </p>
        <p>
          <a
            href={`mailto:${brand.supportEmail}?subject=${deletionSubject}&body=${deletionBody}`}
          >
            <button type="button" className="danger">
              Request deletion
            </button>
          </a>
        </p>
        <p className="muted">
          This emails {brand.supportEmail}. Export your data first if you want a
          copy.
        </p>
      </div>
    </section>
  );
}
