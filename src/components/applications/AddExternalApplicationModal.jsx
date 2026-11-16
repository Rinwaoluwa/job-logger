import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useTask } from "../../hooks/useTasks.jsx";
import ErrorBox from "../ErrorBox.jsx";
import Modal from "../ui/Modal.jsx";
import Tabs from "../ui/Tabs.jsx";
import Field from "../ui/Field.jsx";
import LogApplicationModal from "./LogApplicationModal.jsx";

const MODES = [{ key: "link", label: "Paste a link" }, { key: "manual", label: "Enter manually" }];

// Entry point for a job that isn't in the list yet — a link someone sent
// you, a posting on a board this app doesn't scrape, or something you only
// heard about verbally. Step 1 creates the job (by link, reusing the same
// extraction as "Add job by link" on the Jobs tab, or by typing it in);
// the moment a job exists, step 2 swaps in the same LogApplicationModal
// used everywhere else in the app, so date/applied-via/attachments all
// work identically from here on.
export default function AddExternalApplicationModal({ onClose, onLogged }) {
  const [job, setJob] = useState(null);
  const [alreadyExisted, setAlreadyExisted] = useState(false);

  const [mode, setMode] = useState("link"); // "link" | "manual"
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [location, setLocation] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Link ingestion is a background task; watch the one this modal started
  // and step into the log-application form once it lands.
  const { start } = useTasks();
  const [taskId, setTaskId] = useState(null);
  const task = useTask(taskId);
  useEffect(() => {
    if (!task) return;
    if (task.status === "done") {
      setTaskId(null);
      setAlreadyExisted(!task.result?.created);
      api.getJob(task.result.jobId).then((d) => setJob(d.job)).catch((e) => setError(e.message));
    } else if (task.status === "failed" || task.status === "cancelled") {
      setError(task.error || "Cancelled.");
      setTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);
  const fetching = isActive(task);

  if (job) {
    return <LogApplicationModal jobId={job.id} job={job} onClose={onClose} onLogged={onLogged} />;
  }

  const switchToManual = () => {
    setManualUrl(url);
    setMode("manual");
    setError(null);
  };

  const fetchByLink = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    try {
      const res = await start(() => api.addJobFromLink(url.trim()));
      setTaskId(res.taskId);
    } catch (e2) {
      setError(e2.message);
    }
  };

  const addManually = async (e) => {
    e.preventDefault();
    if (!title.trim() || !company.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { job: newJob } = await api.addJobManual({
        title: title.trim(),
        company: company.trim(),
        descriptionText: descriptionText.trim(),
        url: manualUrl.trim() || undefined,
        location: location.trim() || undefined,
      });
      setJob(newJob);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Log application for a job not on your list">
      <Tabs items={MODES} value={mode} onChange={setMode} variant="segmented" ariaLabel="How to add the job" className="mb-3" />

      <ErrorBox>{error}</ErrorBox>
      {alreadyExisted && <div className="small muted mb-2">Already in your list — continuing.</div>}

      {mode === "link" ? (
        <form onSubmit={fetchByLink}>
          <Field label="Job posting URL">
            <input
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              autoFocus
            />
          </Field>
          {error && (
            <button type="button" className="btn-sm btn-muted" onClick={switchToManual}>
              Switch to manual entry
            </button>
          )}
          <div className="form-actions">
            <button type="button" className="btn-muted" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={fetching}>{fetching ? "Fetching…" : "Fetch"}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={addManually}>
          <div className="form-grid">
            <Field label="Title">
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
            </Field>
            <Field label="Company">
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} required />
            </Field>
            <Field label="Location">
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="URL (optional)">
              <input type="text" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
            </Field>
          </div>
          <Field label="Description" hint="Recommended — it becomes the JD snapshot once you apply.">
            <textarea rows={6} value={descriptionText} onChange={(e) => setDescriptionText(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn-muted" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={loading}>{loading ? "Adding…" : "Add job"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
