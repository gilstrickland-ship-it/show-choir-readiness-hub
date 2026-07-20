import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_ROLES } from "@/lib/nav";
import { formatDateTimeInTz } from "@/lib/datetime";
import { requestExport } from "./actions";
import { SettingsTabs } from "../SettingsTabs";

// Settings → Export & Data (§13.2, §13.3, T029). director/admin. Two halves:
//   • Export everything — a real button producing one zip of CSVs + generated
//     PDFs (the anti-lock-in trust answer and the handoff-vault escape hatch).
//   • Deletion story — the documented 30-day soft-window policy plus a support
//     contact to request deletion. There is intentionally NO deletion_requested_at
//     column and no self-serve purge button: deletion is a human-reviewed support
//     action (a mistaken click must not start a countdown to erasing a booster
//     org's records), so this is a mailto to brand.supportEmail, brand-config aware.

interface ExportJobRow {
  id: string;
  status: string;
  storage_path: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Building…",
  done: "Ready",
  failed: "Failed",
};

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{ requested?: string; error?: string }>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) notFound();
  const sp = await searchParams;

  // Recent async export jobs (T036). export_jobs read is director/admin (RLS).
  const supabase = await createClient();
  const { data: jobRows } = await supabase
    .from("export_jobs")
    .select("id, status, storage_path, created_at, finished_at, error")
    .eq("program_id", program.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const jobs = (jobRows as ExportJobRow[] | null) ?? [];

  // Fresh signed download URLs for completed jobs (members can read the exports
  // bucket via RLS; a short-lived signed URL is enough for a click-through).
  const downloadUrls = new Map<string, string>();
  for (const j of jobs) {
    if (j.status === "done" && j.storage_path) {
      const { data: signed } = await supabase.storage
        .from("exports")
        .createSignedUrl(j.storage_path, 3600);
      if (signed?.signedUrl) downloadUrls.set(j.id, signed.signedUrl);
    }
  }

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
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">Settings</p>
          <h1 className="page-h1">Export &amp; data</h1>
        </div>
      </div>

      <SettingsTabs slug={slug} active="export" />

      {sp.requested && (
        <p className="alert-ok">
          Export requested — we&apos;re building your zip. It appears below when
          ready (and we&apos;ll email you a download link).
        </p>
      )}
      {sp.error === "export" && (
        <p className="alert-error">Couldn&apos;t start the export. Try again.</p>
      )}

      <div className="confirm-box stack" style={{ width: "100%" }}>
        <h2>Export everything</h2>
        <p className="muted">
          A single zip with your full program as spreadsheets (roster, guardians,
          ensemble members, attendance, costume inventory and assignments, ledger,
          budget, and results) plus every generated PDF — published parent packets,
          meal counts, bus manifests, room sheets, and board snapshots. Your data
          is yours; this proves it.
        </p>

        {/* Async job: builds server-side, emails a signed link, and lists below. */}
        <form action={requestExport}>
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <button type="submit">Email me the export</button>
        </form>
        <p className="muted">
          We build it in the background and email you a download link (also listed
          below). Best for large programs.
        </p>

        {/* Synchronous direct download — dev/fallback path. */}
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Or{" "}
          {/* Anchor download (not a client fetch) so the browser streams the zip. */}
          <a href={`/${slug}/settings/export/download`}>download it directly now</a> —
          large programs may take a few seconds to build.
        </p>
      </div>

      {jobs.length > 0 && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <h2>Recent exports</h2>
          <table className="members">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="muted">
                    {formatDateTimeInTz(j.created_at, program.timezone)}
                  </td>
                  <td>
                    <span className="badge">{JOB_STATUS_LABEL[j.status] ?? j.status}</span>
                    {j.status === "failed" && j.error && (
                      <span className="muted"> — {j.error}</span>
                    )}
                  </td>
                  <td>
                    {j.status === "done" && downloadUrls.get(j.id) ? (
                      <a href={downloadUrls.get(j.id)}>Download (.zip)</a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
