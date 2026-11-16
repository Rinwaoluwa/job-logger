import { useState } from "react";
import { api } from "../../api/client.js";
import ErrorBox from "../ErrorBox.jsx";

const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"];

// The form's starting values. An apply link that only copies the posting
// link shows blank ("same as posting URL"), so changing the posting URL
// moves both and the server keeps them in step.
function initialValues(job) {
  return {
    title: job.title || "",
    company: job.company || "",
    url: job.url?.startsWith("manual:") ? "" : job.url || "",
    apply_url: job.apply_url && job.apply_url !== job.url ? job.apply_url : "",
    location_raw: job.location_raw || "",
    work_mode: job.work_mode || "unknown",
    salary_text: job.salary_text || "",
  };
}

export default function JobDetailsForm({ job, onSaved, onCancel }) {
  const [initial] = useState(() => initialValues(job));
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    // Only what changed goes up, so an untouched apply link can follow a
    // new posting URL.
    const details = {};
    for (const [key, value] of Object.entries(values)) {
      if (value.trim() !== initial[key]) details[key] = value.trim() || null;
    }
    if (Object.keys(details).length === 0) return onCancel();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patchJob(job.id, { details });
      onSaved(updated.job || updated);
    } catch (e2) {
      setError(e2.message);
      setSaving(false);
    }
  };

  return (
    <form className="card mb-3" onSubmit={submit}>
      <ErrorBox>{error}</ErrorBox>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Title</label>
          <input type="text" value={values.title} onChange={set("title")} required autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Company</label>
          <input type="text" value={values.company} onChange={set("company")} required />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Posting URL</label>
        <input type="url" value={values.url} onChange={set("url")} required={!!initial.url} placeholder="https://…" />
      </div>
      <div className="form-row">
        <label className="form-label">Apply URL</label>
        <input type="url" value={values.apply_url} onChange={set("apply_url")} placeholder="Same as posting URL" />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Location</label>
          <input type="text" value={values.location_raw} onChange={set("location_raw")} />
        </div>
        <div className="form-row">
          <label className="form-label">Work mode</label>
          <select value={values.work_mode} onChange={set("work_mode")}>
            {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Salary</label>
          <input type="text" value={values.salary_text} onChange={set("salary_text")} />
        </div>
      </div>
      <div className="small muted mt-1 mb-2">
        The old posting URL stays on the job as a place it was seen, so a later import of that link updates this job
        instead of adding a copy.
      </div>
      <div className="flex-row">
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
        <button type="button" className="btn-muted" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
