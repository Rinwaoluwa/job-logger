import { memo, useState } from "react";
import { dateOnly, daysSince, localToday } from "../../lib/format.js";

function BoardCard({ row, onOpen, onDragStart, onRequestDelete }) {
  const [dragging, setDragging] = useState(false);
  const overdue = row.nextActionAt && row.nextActionAt < localToday();
  const days = row.appliedAt ? daysSince(row.appliedAt) : null;

  return (
    <div
      className={`board-card ${dragging ? "dragging" : ""}`}
      draggable
      onDragStart={(e) => { setDragging(true); onDragStart(e, row.jobId); }}
      onDragEnd={() => setDragging(false)}
      onClick={() => onOpen(row.jobId)}
    >
      <div className="spread items-start gap-2">
        <div className="bold text-md">{row.company}</div>
        <button
          type="button"
          className="row-action card-action"
          title="Delete this application"
          onClick={(e) => { e.stopPropagation(); onRequestDelete?.(row.jobId); }}
        >
          ✕
        </button>
      </div>
      <div className="small muted">{row.title}</div>
      <div className="small muted mt-1">
        {row.appliedAt ? `Applied ${dateOnly(row.appliedAt)} · ${days}d` : "—"}
      </div>
      <div className="flex-row gap-1 mt-2">
        <span className={row.resumeDocs > 0 ? "docs-have" : "docs-missing"}>résumé</span>
        <span className={row.coverLetterDocs > 0 ? "docs-have" : "docs-missing"}>letter</span>
        {(row.resumeAttachments > 0 || row.coverLetterAttachments > 0) && (
          <span className="small muted" title="Files attached to this application">
            📎{row.attachmentCount}
          </span>
        )}
      </div>
      {row.nextAction && (
        <div className={`small ${overdue ? "overdue" : "muted"} mt-1`}>
          {row.nextAction}{row.nextActionAt ? ` · ${dateOnly(row.nextActionAt)}` : ""}
        </div>
      )}
    </div>
  );
}

export default memo(BoardCard);
