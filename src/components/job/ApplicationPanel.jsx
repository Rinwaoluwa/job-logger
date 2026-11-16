import { useState } from "react";
import { api } from "../../api/client.js";
import { dateOnly } from "../../lib/format.js";
import StatusSection from "./application/StatusSection.jsx";
import DetailsSection from "./application/DetailsSection.jsx";
import AttachmentsSection from "./application/AttachmentsSection.jsx";

// Composition of the drawer's "Application" tab, split into focused
// sections (previously one file with a bare stage select + one notes box).
// jdChanged/jdSnapshot and documents/attachmentsRefreshKey come from
// JobDrawer's detail fetch; onRequestApplied opens the shared
// LogApplicationModal owned by JobDrawer.
export default function ApplicationPanel({
  jobId, application, events, onUpdated, jdChanged, documents, attachmentsRefreshKey, onRequestApplied,
  onRequestDelete,
}) {
  const [notes, setNotes] = useState(application?.notes || "");
  const [saving, setSaving] = useState(false);

  const saveNotes = async () => {
    setSaving(true);
    try {
      const { application: updated } = await api.patchApplication(jobId, { notes });
      onUpdated?.(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StatusSection
        jobId={jobId}
        application={application}
        jdChanged={jdChanged}
        jdSnapshot={application?.jd_snapshot}
        onUpdated={onUpdated}
        onRequestApplied={onRequestApplied}
      />

      {application?.applied_at && (
        <DetailsSection jobId={jobId} application={application} onUpdated={onUpdated} />
      )}

      <AttachmentsSection jobId={jobId} documents={documents} refreshKey={attachmentsRefreshKey} sentResumeDocumentId={application?.sent_resume_document_id ?? null} />

      <div className="section">
        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
          {saving && <span className="muted small">Saving…</span>}
        </div>
      </div>

      {onRequestDelete && (
        <div className="section">
          <div className="spread gap-3 wrap">
            <div className="muted small" style={{ maxWidth: 420 }}>
              Remove this application from the pipeline, or delete the job outright — the next screen
              spells out what each one takes with it.
            </div>
            <button type="button" className="btn-danger" onClick={onRequestDelete}>Delete…</button>
          </div>
        </div>
      )}

      {events?.length > 0 && (
        <div className="section">
          <div className="section-title">History</div>
          <ul className="small">
            {events.map((ev) => (
              <li key={ev.id}>{dateOnly(ev.at)}: {ev.from_stage || "—"} → {ev.to_stage}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
