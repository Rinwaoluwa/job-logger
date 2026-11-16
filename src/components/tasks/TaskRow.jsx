import { memo } from "react";
import { KIND_LABELS, isActive } from "../../../shared/tasks.js";
import { useTasks, taskSubject } from "../../hooks/useTasks.jsx";
import RunProgress from "../RunProgress.jsx";

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function TaskRow({ task }) {
  const { cancel, retry, remove, openJob } = useTasks();
  const subject = taskSubject(task);
  return (
    <div className={`task-row status-${task.status}`}>
      <div className="spread gap-2 items-start">
        <div className="min-w-0">
          <b className="small">{KIND_LABELS[task.kind] || task.kind}</b>
          {subject && <div className="small muted break-word">{subject}</div>}
        </div>
        <span className={`badge task-status task-status-${task.status}`}>{task.status}</span>
      </div>
      {isActive(task) && <RunProgress run={task} compact />}
      {task.status === "failed" && task.error && (
        <div className="small text-danger mt-2 break-word">{task.error}</div>
      )}
      <div className="flex-row small mt-2">
        {task.status === "done" && task.costUsd > 0 && <span className="muted">${task.costUsd.toFixed(3)}</span>}
        {task.finishedAt && <span className="muted">{ago(task.finishedAt)}</span>}
        {task.status === "queued" && <span className="muted">queued {ago(task.createdAt)}</span>}
        <span className="docws-spacer" />
        {isActive(task) && (
          <button type="button" className="btn-sm btn-muted" onClick={() => cancel(task.id)}>Cancel</button>
        )}
        {(task.status === "failed" || task.status === "cancelled") && (
          <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
        )}
        {task.status === "failed" && (
          <button type="button" className="btn-sm btn-muted" onClick={() => remove(task.id)}>Remove</button>
        )}
        {task.job && (
          <button type="button" className="btn-sm btn-muted" onClick={() => openJob?.(task.jobId)}>Open job</button>
        )}
      </div>
    </div>
  );
}

/** Bulk fit scoring queued by one source refresh, as a single row. */
export function TaskGroupRow({ groupId, tasks }) {
  const { cancelGroup } = useTasks();
  const n = (status) => tasks.filter((t) => t.status === status).length;
  const active = tasks.some(isActive);
  const parts = [
    n("done") ? `${n("done")} done` : null,
    n("running") ? `${n("running")} running` : null,
    n("queued") ? `${n("queued")} queued` : null,
    n("failed") ? `${n("failed")} failed` : null,
    n("cancelled") ? `${n("cancelled")} cancelled` : null,
  ].filter(Boolean);
  return (
    <details className={`task-row task-group ${active ? "status-running" : ""}`}>
      <summary>
        <div className="spread gap-2">
          <div>
            <b className="small">Scoring fit for {tasks.length} job{tasks.length === 1 ? "" : "s"}</b>
            <div className="small muted">{parts.join(" · ")}</div>
          </div>
          {active && (
            <button
              type="button"
              className="btn-sm btn-muted"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelGroup(groupId); }}
            >
              Cancel all
            </button>
          )}
        </div>
      </summary>
      <div className="task-list">
        {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
      </div>
    </details>
  );
}

export default memo(TaskRow);
