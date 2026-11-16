import { useState } from "react";
import { api } from "../../api/client.js";
import ErrorBox from "../ErrorBox.jsx";
import Modal from "../ui/Modal.jsx";

// "Delete this application" means two different things depending on where
// the job came from, so the dialog asks rather than guessing. A job you
// typed in by hand exists only because of the application, so removing
// just the application would strand it on the Jobs tab; a scraped job is
// a real posting you may still want to look at.
const MANUAL_SOURCES = new Set(["manual", "link", "brief"]);

export default function DeleteApplicationModal({ row, onClose, onDeleted }) {
  const manual = MANUAL_SOURCES.has(row.source);
  const [mode, setMode] = useState(manual ? "job" : "application");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const hasDocs = row.resumeDocs > 0 || row.coverLetterDocs > 0;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteApplication(row.jobId, { withJob: mode === "job" });
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Delete this application?"
      description={`${row.company} — ${row.title}`}
      closeButton={false}
      footer={(
        <>
          <button type="button" className="btn-muted" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-danger-solid" onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : mode === "job" ? "Delete job" : "Remove application"}
          </button>
        </>
      )}
    >
      <label className="choice">
        <input
          type="radio"
          name="delete-mode"
          checked={mode === "application"}
          onChange={() => setMode("application")}
        />
        <span>
          <b>Remove from the pipeline</b>
          <div className="muted small">
            Deletes the application, its stage history and its attachment list. The job stays on the Jobs
            tab{hasDocs ? ", and the résumé and cover letter already generated for it are kept" : ""}.
            {manual && (
              <>
                {" "}
                <span className="inferred-note">
                  You added this job by hand, so it would be left on the Jobs tab with nothing pointing at it.
                </span>
              </>
            )}
          </div>
        </span>
      </label>

      <label className="choice">
        <input type="radio" name="delete-mode" checked={mode === "job"} onChange={() => setMode("job")} />
        <span>
          <b>Delete the job and everything with it</b>
          <div className="muted small">
            Removes the job from both tabs along with the application, stage history,
            {hasDocs ? " the generated résumé and cover letter," : " any generated documents,"} fit reports and
            interview prep. Files on your disk are never touched — attachments only ever linked to them.
          </div>
        </span>
      </label>

      <ErrorBox>{error}</ErrorBox>
    </Modal>
  );
}
