import { Fragment } from "react";
import Link from "next/link";
import { formatDateTimeInTz } from "@/lib/datetime";
import { exportJobAnchor } from "../shared";

// One export you asked for, and everything there is to know about it (spec 005
// Wave 13 / T164).
//
// The row states the two facts you scan for — when you asked, and whether it is
// ready — and the rest opens in a row of its OWN beneath, spanning every column
// and stuck to the left edge of the scroll port (T143b). That is where the
// failure reason belongs: it is a sentence from the job runner, and a sentence
// jammed into a status cell is what made this table 700px wide on a phone.
//
// The panel is also the only place that says what nothing on this page said
// before: a download link is signed and short-lived, so a stale tab's link stops
// working and re-opening the panel is how you get a fresh one.

export interface ExportJob {
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

export function ExportJobRow({
  job,
  tz,
  downloadUrl,
  open,
  columns,
  rowHref,
}: {
  job: ExportJob;
  tz: string;
  // A freshly signed URL, or null when the job has nothing to download yet.
  downloadUrl: string | null;
  // The panel opens on `?job=<id>`.
  open: boolean;
  columns: number;
  rowHref: (jobId: string, mode: "open" | "close") => string;
}) {
  const anchor = exportJobAnchor(job.id);
  const panelId = `${anchor}-panel`;
  const statusLabel = JOB_STATUS_LABEL[job.status] ?? job.status;
  const requested = formatDateTimeInTz(job.created_at, tz);

  return (
    <Fragment>
      <tr id={anchor}>
        <td className="muted">{requested}</td>
        <td>
          <span className="badge">{statusLabel}</span>
        </td>
        <td>
          {downloadUrl ? (
            <a href={downloadUrl}>Download (.zip)</a>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="table-action">
          <Link
            href={rowHref(job.id, open ? "close" : "open")}
            className="people-disclosure"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={`Details of the export requested ${requested}`}
          >
            {open ? "Close" : "Details"}
          </Link>
        </td>
      </tr>

      {open && (
        <tr className="table-panel-row" id={panelId}>
          <td colSpan={columns}>
            <div className="table-panel">
              <div className="stack people-row-panel">
                <h3 className="drawer-title">This export</h3>
                <p className="muted">Asked for {requested}.</p>
                {job.finished_at ? (
                  <p className="muted">
                    Finished {formatDateTimeInTz(job.finished_at, tz)}.
                  </p>
                ) : (
                  <p className="muted">
                    Still working. Reload this page in a minute — we email you a
                    link the moment it&apos;s done.
                  </p>
                )}
                {job.status === "failed" && (
                  <p className="alert-error">
                    {job.error ?? "The build stopped and didn't say why."}
                  </p>
                )}
                {job.status === "failed" && (
                  <p className="muted">
                    Nothing was changed and nothing was lost — ask for the export
                    again, and if it fails twice, send us this page.
                  </p>
                )}
                {downloadUrl && (
                  <p className="muted">
                    <a href={downloadUrl}>Download (.zip)</a> — this link is signed
                    for you and stops working about an hour after the page loads.
                    Reload the page for a fresh one.
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
