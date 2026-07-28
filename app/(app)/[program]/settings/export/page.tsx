import { brand } from "@/lib/brand";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_ROLES } from "@/lib/nav";
import { readFlash, oneParam } from "@/lib/flash";
import { requestExport } from "./actions";
import { SubTabs } from "../../SubTabs";
import { settingsTabs } from "@/lib/subnav";
import { Flash } from "../../Flash";
import { ExportJobRow, type ExportJob } from "./ExportJobRow";
import {
  EXPORT_FLASH_MAPS,
  exportJobAnchor,
  type ExportSection,
} from "../shared";

// Settings → Export & Data (§13.2, §13.3, T029). director/admin. Three titled
// sections in one constant order, the same shape as Settings § Program:
//   • Export everything — a real button producing one zip of CSVs + generated
//     PDFs (the anti-lock-in trust answer and the handoff-vault escape hatch).
//   • Recent exports — what you have asked for, each row's detail behind the
//     app's row-edit panel (spec 005 Wave 13 / T164).
//   • Deletion story — the documented 30-day soft-window policy plus a support
//     contact to request deletion. There is intentionally NO deletion_requested_at
//     column and no self-serve purge button: deletion is a human-reviewed support
//     action (a mistaken click must not start a countdown to erasing a booster
//     org's records), so this is a mailto to brand.supportEmail, brand-config aware.

const JOB_COLUMNS = 4;

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // A duplicated param (?job=a&job=b) arrives as an ARRAY, so every read goes
  // through lib/flash's `oneParam` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role } = await getTenantContext(slug);
  if (!SETTINGS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Settings" role={role} allowed={SETTINGS_ROLES} />
    );
  }
  const sp = await searchParams;
  const flash = readFlash<ExportSection>(sp, EXPORT_FLASH_MAPS);
  const openJobId = oneParam(sp, "job");

  const base = `/${slug}/settings/export`;
  const rowHref = (jobId: string, mode: "open" | "close"): string => {
    const anchor = `#${exportJobAnchor(jobId)}`;
    return mode === "close"
      ? `${base}${anchor}`
      : `${base}?job=${encodeURIComponent(jobId)}${anchor}`;
  };

  // Recent async export jobs (T036). export_jobs read is director/admin (RLS).
  const supabase = await createClient();
  const { data: jobRows } = await supabase
    .from("export_jobs")
    .select("id, status, storage_path, created_at, finished_at, error")
    .eq("program_id", program.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const jobs = (jobRows as ExportJob[] | null) ?? [];

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

  const ready = jobs.filter((j) => j.status === "done").length;
  const working = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  const jobSummary =
    jobs.length === 0
      ? "None yet"
      : working > 0
        ? `${working} building · ${ready} ready`
        : `${ready} ready`;

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

      <SubTabs strip={settingsTabs(slug, "export")} />

      <section id="export-everything" className="panel stack">
        <div className="travel-section-head">
          <h2>Export everything</h2>
          <span className="travel-section-summary">
            Spreadsheets and PDFs, in one zip
          </span>
        </div>
        <Flash flash={flash} section="page" />
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
          We build it in the background and email you a download link (it is also
          listed below). Best for large programs.
        </p>

        {/* Synchronous direct download — dev/fallback path. */}
        <p className="muted">
          Or{" "}
          {/* Anchor download (not a client fetch) so the browser streams the zip. */}
          <a href={`${base}/download`}>download it directly now</a> — large
          programs may take a few seconds to build.
        </p>
      </section>

      {jobs.length > 0 && (
        <section id="recent-exports" className="panel stack">
          <div className="travel-section-head">
            <h2>Recent exports</h2>
            <span className="travel-section-summary">{jobSummary}</span>
          </div>
          <table className="members">
            <thead>
              <tr>
                <th>Asked for</th>
                <th>Status</th>
                <th>File</th>
                <th className="table-action">
                  <span className="muted">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <ExportJobRow
                  key={j.id}
                  job={j}
                  tz={program.timezone}
                  downloadUrl={downloadUrls.get(j.id) ?? null}
                  open={openJobId === j.id}
                  columns={JOB_COLUMNS}
                  rowHref={rowHref}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section id="delete-program" className="panel stack">
        <div className="travel-section-head">
          <h2>Delete this program</h2>
          <span className="travel-section-summary">
            Reviewed by a person, not a button
          </span>
        </div>
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
      </section>
    </section>
  );
}
