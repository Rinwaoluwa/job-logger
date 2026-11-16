import { useState } from "react";
import { api } from "../../../api/client.js";
import { STAGES, stageLabel, APPLIED_VIA, APPLIED_VIA_LABELS } from "../../../lib/stages.js";
import { dateOnly } from "../../../lib/format.js";
import Field from "./Field.jsx";

export default function StatusSection({ jobId, application, jdChanged, jdSnapshot, onUpdated, onRequestApplied }) {
  const [showSnapshot, setShowSnapshot] = useState(false);
  const archived = !!application?.archived_at;

  const changeStage = async (stage) => {
    if (stage === "applied" && !application?.applied_at) {
      onRequestApplied?.(jobId);
      return;
    }
    const { application: updated } = await api.patchApplication(jobId, { stage });
    onUpdated?.(updated);
  };

  const toggleArchived = async () => {
    const { application: updated } = await api.patchApplication(jobId, { archived: !archived });
    onUpdated?.(updated);
  };

  return (
    <div className="section">
      <div className="form-row">
        <label className="form-label">Stage</label>
        <select value={application?.stage || "new"} onChange={(e) => changeStage(e.target.value)}>
          {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
        </select>
        {application?.applied_at && <span className="muted small ml-2">Applied {dateOnly(application.applied_at)}</span>}
      </div>

      {application?.applied_at && (
        <div className="form-grid">
          <Field jobId={jobId} name="appliedAt" label="Date applied" type="date" value={application.applied_at} onSaved={onUpdated} />
          <Field
            jobId={jobId} name="appliedVia" label="Applied via" type="select" value={application.applied_via || ""}
            options={[{ value: "", label: "—" }, ...APPLIED_VIA.map((v) => ({ value: v, label: APPLIED_VIA_LABELS[v] }))]}
            onSaved={onUpdated}
          />
          {application.applied_via === "referral" && (
            <Field jobId={jobId} name="referralName" label="Referral name" value={application.referral_name || ""} onSaved={onUpdated} />
          )}
          <Field jobId={jobId} name="appliedUrl" label="Applied URL" value={application.applied_url || ""} onSaved={onUpdated} />
        </div>
      )}

      {jdChanged && (
        <div className="err-box warn-box">
          The job posting has changed since you applied.{" "}
          <button type="button" className="btn-sm btn-muted ml-2" onClick={() => setShowSnapshot((s) => !s)}>
            {showSnapshot ? "Hide" : "Show"} the version you applied to
          </button>
          {showSnapshot && (
            <div className="small jd-diff-text">
              {jdSnapshot}
            </div>
          )}
        </div>
      )}

      <div className="flex-row mt-3">
        <button type="button" className="btn-sm btn-muted" onClick={toggleArchived}>
          {archived ? "Unarchive" : "Archive"}
        </button>
        {archived && <span className="muted small">Archived {dateOnly(application.archived_at)}</span>}
      </div>
    </div>
  );
}
