import { useState } from "react";
import { api } from "../api/client.js";
import { isActive } from "../../shared/tasks.js";
import { useTasks, useTasksSelector, selectAnswerTasks, shallowEqualArray } from "../hooks/useTasks.jsx";
import { useQuery } from "../hooks/useQuery.js";
import { useIsActiveView } from "../hooks/useIsActiveView.jsx";
import CopyButton from "../components/ui/CopyButton.jsx";
import ErrorBox from "../components/ErrorBox.jsx";
import RunProgress from "../components/RunProgress.jsx";

// One card per answer task. The result lives on the task, so a card
// survives a tab switch, a page reload, and the server restarting.
function AnswerCard({ task }) {
  const { cancel, retry } = useTasks();
  const result = task.result;
  return (
    <div className="card mt-4">
      <div className="spread gap-3 items-start">
        <div className="small min-w-0">
          <b>{task.payload?.question}</b>
          <div className="muted">
            {task.job ? `${task.job.company} — ${task.job.title}` : task.payload?.jdText ? "pasted job description" : "no job description"}
            {task.payload?.length ? ` · ${task.payload.length}` : ""}
          </div>
        </div>
        <span className={`badge task-status task-status-${task.status}`}>{task.status}</span>
      </div>
      {isActive(task) && (
        <div>
          <RunProgress run={task} />
          <button type="button" className="btn-sm btn-muted" onClick={() => cancel(task.id)}>Cancel</button>
        </div>
      )}
      {task.status === "failed" && (
        <ErrorBox>
          {task.error}{" "}
          <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
        </ErrorBox>
      )}
      {task.status === "cancelled" && (
        <div className="muted small mt-2">
          Cancelled. <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Run again</button>
        </div>
      )}
      {task.status === "done" && result && (
        <>
          <div className="pre-wrap text-md lh mt-3">{result.answer}</div>
          {result.story_ids_used?.length > 0 && (
            <div className="small muted mt-3">
              Stories used: {result.story_ids_used.map((s) => <span key={s} className="badge fit-good mr-1">{s}</span>)}
            </div>
          )}
          {result.inferred_claims?.length > 0 && (
            <div className="small mt-2 inferred-note">
              <b>Not from your profile:</b>
              <ul>{result.inferred_claims.map((c, i) => <li key={i}>{c.text} — {c.reason}</li>)}</ul>
            </div>
          )}
          <div className="flex-row mt-3">
            <CopyButton text={result.answer} size="md" />
            {task.costUsd > 0 && <span className="muted small">${task.costUsd.toFixed(3)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// The job picker puts the jobs you have actually applied to first: that is
// what an application question is almost always about, and a job logged by
// hand has no posting date, which would otherwise bury it at the bottom.
function groupJobs(jobs) {
  const applied = jobs.filter((j) => j.appliedAt);
  const rest = jobs.filter((j) => !j.appliedAt);
  return { applied, rest };
}

export default function AnswerView() {
  const { start } = useTasks();
  const active = useIsActiveView();
  const [question, setQuestion] = useState("");
  const [length, setLength] = useState("medium");
  const [jobId, setJobId] = useState("");
  const [jdText, setJdText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Panes stay mounted across tab switches, so the list is refetched each
  // time this tab is shown: a job logged on the Applications tab a moment
  // ago must be pickable here without a page reload.
  const { data: jobs } = useQuery(
    (signal) => api.listJobs({ sort: "posted" }, { signal }),
    [active],
    { enabled: active, initialData: [] },
  );

  const { applied, rest } = groupJobs(jobs || []);
  const option = (j) => <option key={j.id} value={j.id}>{j.company} — {j.title}</option>;

  // Only the answer tasks, compared element by element: another job's
  // fit score finishing does not re-render the cards.
  const answers = useTasksSelector(selectAnswerTasks, shallowEqualArray);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = { question, length };
      if (jobId) payload.jobId = jobId;
      else payload.jdText = jdText;
      await start(() => api.answer(payload));
      setQuestion("");
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <form onSubmit={submit}>
          <div className="form-row">
            <label className="form-label">Application question</label>
            <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} required />
          </div>
          <div className="form-row">
            <label className="form-label">Which job is this for?</label>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">— paste a job description instead —</option>
              {applied.length > 0 && <optgroup label="Applied">{applied.map(option)}</optgroup>}
              {rest.length > 0 && <optgroup label={applied.length ? "Not applied yet" : "Jobs"}>{rest.map(option)}</optgroup>}
            </select>
          </div>
          {!jobId && (
            <div className="form-row">
              <label className="form-label">Job description (optional)</label>
              <textarea rows={6} value={jdText} onChange={(e) => setJdText(e.target.value)} />
            </div>
          )}
          <div className="form-row">
            <label className="form-label">Length</label>
            <select value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="short">Short (60-100 words)</option>
              <option value="medium">Medium (120-180 words)</option>
              <option value="long">Long (220-300 words)</option>
            </select>
          </div>
          <div className="flex-row">
            <button type="submit" disabled={submitting}>{submitting ? "Queuing…" : "Generate answer"}</button>
            <span className="muted small">Runs in the background — you can keep working and come back.</span>
          </div>
        </form>
        <ErrorBox>{error}</ErrorBox>
      </div>

      {answers.map((t) => <AnswerCard key={t.id} task={t} />)}
    </div>
  );
}
