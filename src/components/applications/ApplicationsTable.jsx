import { memo } from "react";
import { dateOnly, daysSince, localToday } from "../../lib/format.js";
import { APPLIED_VIA_LABELS } from "../../lib/stages.js";
import StageSelect from "../jobs/StageSelect.jsx";
import EmptyState from "../ui/EmptyState.jsx";

// Whether this application has generated documents yet — the thing you
// actually want to see when scanning the list, because an application
// without a tailored résumé is one you cannot send.
function DocsCell({ row }) {
  const hasResume = row.resumeDocs > 0;
  const hasCover = row.coverLetterDocs > 0;
  if (!hasResume && !hasCover) return <span className="docs-missing">none yet</span>;
  return (
    <span className="flex-row gap-1">
      <span className={hasResume ? "docs-have" : "docs-missing"}>résumé</span>
      <span className={hasCover ? "docs-have" : "docs-missing"}>letter</span>
    </span>
  );
}

function ApplicationsTable({ rows, onOpen, onStageChanged, onRequestApplied, onRequestDelete }) {
  if (rows.length === 0) {
    return <EmptyState title="No applications yet" body={<>Move a job to "Applied" from the Jobs tab to log one.</>} />;
  }
  const today = localToday();

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Title</th>
            <th>Applied</th>
            <th>Days</th>
            <th>Stage</th>
            <th>Via</th>
            <th>Docs</th>
            <th>Attachments</th>
            <th>Next action</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const overdue = r.nextActionAt && r.nextActionAt < today;
            const days = r.appliedAt ? daysSince(r.appliedAt) : null;
            return (
              <tr key={r.jobId} onClick={() => onOpen(r.jobId)}>
                <td>{r.company}</td>
                <td>{r.title}</td>
                <td className="small muted">{r.appliedAt ? dateOnly(r.appliedAt) : "—"}</td>
                <td className="small muted">{days != null ? days : "—"}</td>
                <td><StageSelect jobId={r.jobId} stage={r.stage} onChanged={() => onStageChanged?.()} onRequestApplied={onRequestApplied} /></td>
                <td className="small muted">{r.appliedVia ? APPLIED_VIA_LABELS[r.appliedVia] : "—"}</td>
                <td className="small"><DocsCell row={r} /></td>
                <td className="small muted">
                  {r.resumeAttachments ? "R" : ""}{r.coverLetterAttachments ? " CL" : ""}
                  {!r.resumeAttachments && !r.coverLetterAttachments && r.attachmentCount ? `+${r.attachmentCount}` : ""}
                  {!r.attachmentCount ? "—" : ""}
                </td>
                <td className={`small ${overdue ? "overdue" : "muted"}`}>
                  {r.nextAction ? `${r.nextAction}${r.nextActionAt ? ` (${dateOnly(r.nextActionAt)})` : ""}` : "—"}
                </td>
                <td>
                  <span className="flex-row gap-2 flex-nowrap">
                    <a href={r.applyUrl || r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open ↗</a>
                    <button
                      type="button"
                      className="row-action"
                      title="Delete this application"
                      onClick={(e) => { e.stopPropagation(); onRequestDelete?.(r.jobId); }}
                    >
                      ✕
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default memo(ApplicationsTable);
