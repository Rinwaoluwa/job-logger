import { useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useJobTask } from "../../hooks/useTasks.jsx";
import ErrorBox from "../ErrorBox.jsx";

const SEVERITY_CLASS = { blocker: "fit-no", major: "fit-stretch", minor: "fit-none" };

export default function FitReport({ jobId, fit }) {
  const { start, cancel, retry } = useTasks();
  const task = useJobTask(jobId, "fit");
  const loading = isActive(task);
  const [error, setError] = useState(null);

  // The new score reaches this panel through the drawer, which reloads
  // its detail when the task finishes.
  const run = async () => {
    setError(null);
    try {
      await start(() => api.runFit(jobId));
    } catch (e) {
      setError(e.message);
    }
  };

  const label = loading ? (task.status === "queued" ? "Queued…" : "Scoring…") : null;
  const status = (
    <>
      <ErrorBox>{error}</ErrorBox>
      {task?.status === "failed" && (
        <ErrorBox>
          Fit analysis failed: {task.error}{" "}
          <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
        </ErrorBox>
      )}
      {loading && (
        <button type="button" className="btn-sm btn-muted ml-2" onClick={() => cancel(task.id)}>Cancel</button>
      )}
    </>
  );

  if (!fit) {
    return (
      <div>
        <p className="muted small">No fit analysis yet.</p>
        <button type="button" onClick={run} disabled={loading}>{label || "Run fit analysis"}</button>
        {status}
      </div>
    );
  }

  const r = fit.result_json;
  return (
    <div>
      <div className="spread mb-3">
        <div>
          <span className={`fit-badge fit-${r.verdict} text-lg`}>{r.score} · {r.verdict}</span>
          <span className="muted small ml-2">{r.apply_recommendation}</span>
        </div>
        <span>
          <button type="button" className="btn-sm btn-muted" onClick={run} disabled={loading}>
            {label || "Re-run"}
          </button>
          {loading && (
            <button type="button" className="btn-sm btn-muted ml-2" onClick={() => cancel(task.id)}>Cancel</button>
          )}
        </span>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {task?.status === "failed" && (
        <ErrorBox>
          Fit analysis failed: {task.error}{" "}
          <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
        </ErrorBox>
      )}
      <p className="small">{r.summary}</p>
      {r.reasons_for?.length > 0 && (
        <div className="mb-2">
          <div className="section-title">Reasons for</div>
          <ul className="small">{r.reasons_for.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {r.reasons_against?.length > 0 && (
        <div className="mb-2">
          <div className="section-title">Reasons against</div>
          <ul className="small">{r.reasons_against.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {r.must_have_gaps?.length > 0 && (
        <div className="mb-2">
          <div className="section-title">Must-have gaps</div>
          {r.must_have_gaps.map((g, i) => (
            <div key={i} className="small mb-1">
              <span className={`badge ${SEVERITY_CLASS[g.severity] || "fit-none"}`}>{g.severity}</span> {g.requirement} — {g.note}
            </div>
          ))}
        </div>
      )}
      {r.red_flags?.length > 0 && (
        <div className="mb-2">
          <div className="section-title">Red flags</div>
          <ul className="small">{r.red_flags.map((f, i) => <li key={i}>({f.kind}) {f.detail}</li>)}</ul>
        </div>
      )}
      {r.suggested_angle && <p className="small muted">Suggested angle: {r.suggested_angle}</p>}
    </div>
  );
}
