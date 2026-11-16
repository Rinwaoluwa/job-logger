import { isActive } from "../../../shared/tasks.js";
import { dateOnly } from "../../lib/format.js";
import { useTasks, useJobTask } from "../../hooks/useTasks.jsx";
import RunProgress from "../RunProgress.jsx";
import DocumentsPanel from "../job/DocumentsPanel.jsx";

function BriefRow({ brief, open, onToggle, onDelete, refreshKey }) {
  const { cancel, retry } = useTasks();
  const task = useJobTask(brief.id, "prepare_application");
  const active = isActive(task);
  const resume = brief.resume;
  const skills = brief.brief?.skills || [];

  const remove = async () => {
    if (!window.confirm(`Delete “${brief.title}” and its generated documents?`)) return;
    await onDelete(brief.id);
  };

  return (
    <div className="card brief-row">
      <div className="spread gap-3 items-start">
        <div className="min-w-0">
          <div className="strong text-lg">
            {brief.title}
            {brief.company && <span className="muted normal"> · {brief.company}</span>}
          </div>
          <div className="muted small mt-1">
            {dateOnly(brief.createdAt)}
            {resume && ` · résumé v${resume.version}`}
            {brief.coverLetter && ` · cover letter v${brief.coverLetter.version}`}
            {brief.brief?.notes && ` · ${brief.brief.notes}`}
          </div>
          {skills.length > 0 && (
            <div className="flex-row mt-2">
              {skills.map((s) => <span key={s} className="chip-neutral">{s}</span>)}
            </div>
          )}
        </div>
        <div className="flex-row shrink-0">
          {resume && !active && (
            <>
              <a className="btn-link" href={`/api/documents/${resume.id}/pdf`}>Download PDF</a>
              <a className="btn-link" href={`/api/documents/${resume.id}/docx`}>.docx</a>
            </>
          )}
          {resume && (
            <button type="button" className="btn-sm btn-muted" onClick={onToggle}>{open ? "Close" : "Open"}</button>
          )}
          {active && <button type="button" className="btn-sm btn-muted" onClick={() => cancel(task.id)}>Cancel</button>}
          {task && (task.status === "failed" || task.status === "cancelled") && (
            <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
          )}
          <button type="button" className="btn-sm btn-muted" onClick={remove} disabled={active}>Delete</button>
        </div>
      </div>
      {task && (active || task.status !== "done" || !resume) && (
        <div className="mt-3">
          <RunProgress run={task} />
        </div>
      )}
      {open && resume && (
        <div className="brief-docs">
          <DocumentsPanel jobId={brief.id} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}

export default function BriefList({ briefs, openId, onToggle, onDelete, refreshKey }) {
  if (briefs.length === 0) {
    return (
      <div className="card muted small">
        Nothing generated yet. Type a job title above (and the skills you want featured) to get a résumé built from your profile.
      </div>
    );
  }
  return (
    <div>
      {briefs.map((b) => (
        <BriefRow
          key={b.id}
          brief={b}
          open={openId === b.id}
          onToggle={() => onToggle(b.id)}
          onDelete={onDelete}
          refreshKey={refreshKey}
        />
      ))}
    </div>
  );
}
