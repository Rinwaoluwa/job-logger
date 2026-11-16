import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import ErrorBox from "../ErrorBox.jsx";
import ResumePreview from "../resume/ResumePreview.jsx";
import { dateOnly } from "../../lib/format.js";

// The résumé the interviewer has read. One version per job is marked as
// sent (set when an application is logged with a résumé attached, or by
// hand here or on the Documents tab); until then the newest stands in.
// The prep, the story map and the mock critiques all read this version.

export default function SentResumeCard({ jobId, sentResume, documents = [], onChanged }) {
  const resumes = documents.filter((d) => d.kind === "resume").sort((a, b) => b.version - a.version);
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !sentResume?.documentId) { setDoc(null); return undefined; }
    let live = true;
    api.getDocument(sentResume.documentId).then((d) => { if (live) setDoc(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, sentResume?.documentId]);

  const mark = async (documentId) => {
    setBusy(true);
    setError(null);
    try {
      await api.patchApplication(jobId, { sentResumeDocumentId: documentId });
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (resumes.length === 0) {
    return (
      <div className="card">
        <div className="section-title">Résumé the interviewer read</div>
        <div className="muted small">No résumé for this job yet. The prep works from the profile alone until one exists.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread gap-3 wrap items-center">
        <div className="flex-row items-center">
          <span className="section-title mb-0">Résumé the interviewer read</span>
          {sentResume && (
            sentResume.explicit
              ? <span className="chip-ok small">v{sentResume.version} · marked as sent</span>
              : <span className="chip-warn small">v{sentResume.version} · newest, not marked as sent</span>
          )}
        </div>
        <div className="flex-row items-center">
          <select value={sentResume?.documentId || ""} onChange={(e) => mark(Number(e.target.value))} disabled={busy} className="w-auto">
            {resumes.map((d) => <option key={d.id} value={d.id}>v{d.version} · {dateOnly(d.created_at)}{d.instruction ? " · revised" : ""}</option>)}
          </select>
          {sentResume && !sentResume.explicit && (
            <button type="button" className="btn-sm" disabled={busy} onClick={() => mark(sentResume.documentId)}>Mark v{sentResume.version} as sent</button>
          )}
          <button type="button" className="btn-sm btn-muted" onClick={() => setOpen(!open)}>{open ? "Hide résumé" : "Show résumé"}</button>
        </div>
      </div>
      <div className="muted small mt-1">
        The prep, the story map and the mock critiques are written against this version. Pick another if you sent a different one.
      </div>
      <ErrorBox>{error}</ErrorBox>
      {open && (
        <div className="sent-resume-preview mt-3">
          {doc ? <ResumePreview document={doc} decisions={doc.review_decisions || {}} /> : <div className="muted small">Loading…</div>}
        </div>
      )}
    </div>
  );
}
