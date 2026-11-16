import { STAGE_LABELS } from "../../shared/tasks.js";

const stageMs = (s) => (s.startedAt && s.finishedAt ? Date.parse(s.finishedAt) - Date.parse(s.startedAt) : null);
// A stage that ran more than once (reviewer, rewrite) has an entry per pass.
const label = (s) => `${STAGE_LABELS[s.name] || s.name}${s.pass > 1 ? ` (pass ${s.pass})` : ""}`;
const key = (s) => `${s.name}-${s.pass || 1}`;

/** Stage-by-stage progress of a background task. `compact` is the one-line
 * form for the activity panel: a dot per stage and the current stage name. */
export default function RunProgress({ run, compact = false }) {
  if (!run) return null;
  const stages = run.stages || [];
  const current = stages.find((s) => s.status === "running");

  if (compact) {
    return (
      <div className="run-progress-compact">
        {stages.map((s) => <span key={key(s)} className={`dot ${s.status}`} title={label(s)} />)}
        <span className="muted small label">
          {run.status === "queued" ? "Waiting for a free slot" : current ? label(current) : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="run-progress">
      {run.status === "queued" && <div className="muted small">Queued — waiting for a free slot.</div>}
      {stages.map((s) => {
        const ms = stageMs(s);
        return (
          <div key={key(s)} className={`run-stage ${s.status}`}>
            <span className="dot" />
            <span>{label(s)}</span>
            {s.status === "done" && ms != null && <span className="muted small">({(ms / 1000).toFixed(1)}s)</span>}
            {s.status === "failed" && s.error && s.error !== "cancelled" && <span className="small text-danger">— {s.error}</span>}
          </div>
        );
      })}
      {run.status === "failed" && <div className="err-box">{run.error || "Run failed."}</div>}
      {run.status === "cancelled" && <div className="muted small">Cancelled.</div>}
      {run.status === "done" && run.costUsd > 0 && (
        <div className="muted small">Cost: ${run.costUsd.toFixed(3)}</div>
      )}
    </div>
  );
}
