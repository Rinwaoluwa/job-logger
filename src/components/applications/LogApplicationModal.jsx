import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.js";
import { APPLIED_VIA, APPLIED_VIA_LABELS } from "../../lib/stages.js";
import { localToday, addDays } from "../../lib/format.js";
import ErrorBox from "../ErrorBox.jsx";
import Modal from "../ui/Modal.jsx";
import Field from "../ui/Field.jsx";

// The main data-entry moment for the whole feature: fired whenever a job
// is moved to the 'applied' stage (from the Jobs table, the Applications
// board, or the drawer). One submit = one POST /applications/:jobId/apply,
// which moves the stage, snapshots the JD, and links whichever files were
// picked here — see server/routes/applications.js.
export default function LogApplicationModal({ jobId, job, onClose, onLogged }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [appliedAt, setAppliedAt] = useState(localToday());
  const [appliedVia, setAppliedVia] = useState("company_site");
  const [referralName, setReferralName] = useState("");
  const [appliedUrl, setAppliedUrl] = useState(job?.apply_url || job?.applyUrl || job?.url || "");
  const [nextAction, setNextAction] = useState("Follow up");
  const [nextActionAt, setNextActionAt] = useState(localToday());
  const [notes, setNotes] = useState("");

  const [folderPath, setFolderPath] = useState(null);
  const [folderFiles, setFolderFiles] = useState([]); // [{name, checked, kind}]
  const [pathInput, setPathInput] = useState("");
  const [pathKind, setPathKind] = useState("resume");

  const [docs, setDocs] = useState([]);
  const [linkResumeId, setLinkResumeId] = useState(null);
  const [linkCoverId, setLinkCoverId] = useState(null);

  const companyLower = (job?.company || "").toLowerCase();

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.sourceFolder(), api.listDocuments(jobId), api.getSettings()])
      .then(([folder, docList, { settings }]) => {
        if (cancelled) return;
        setFolderPath(folder.path);
        const guessKind = (name) => (name.toLowerCase().includes("cover") ? "cover_letter" : "resume");
        setFolderFiles(
          folder.files.map((f) => ({
            name: f.name,
            checked: companyLower.length > 0 && f.name.toLowerCase().includes(companyLower),
            kind: guessKind(f.name),
          })),
        );
        setDocs(docList);
        const latestResume = docList.find((d) => d.kind === "resume");
        const latestCover = docList.find((d) => d.kind === "cover_letter");
        setLinkResumeId(latestResume ? latestResume.id : null);
        setLinkCoverId(latestCover ? latestCover.id : null);
        const followupDays = Number(settings["tracking.followup_days"] || 7);
        const defaultVia = settings["tracking.default_applied_via"] || "company_site";
        setAppliedVia(defaultVia);
        setNextActionAt(addDays(localToday(), followupDays));
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const toggleFolderFile = (name) => {
    setFolderFiles((prev) => prev.map((f) => (f.name === name ? { ...f, checked: !f.checked } : f)));
  };
  const setFolderFileKind = (name, kind) => {
    setFolderFiles((prev) => prev.map((f) => (f.name === name ? { ...f, kind } : f)));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const chosenFolderFiles = folderFiles.filter((f) => f.checked).map((f) => ({ name: f.name, kind: f.kind }));
      const paths = pathInput.trim() ? [{ path: pathInput.trim(), kind: pathKind }] : [];
      const documentIds = [];
      if (linkResumeId) documentIds.push({ documentId: linkResumeId, kind: "resume" });
      if (linkCoverId) documentIds.push({ documentId: linkCoverId, kind: "cover_letter" });

      const { application, attachments } = await api.logApplication(jobId, {
        appliedAt,
        appliedVia,
        appliedUrl: appliedUrl || undefined,
        referralName: appliedVia === "referral" ? referralName : undefined,
        nextAction: nextAction || undefined,
        nextActionAt: nextActionAt || undefined,
        notes: notes || undefined,
        folderFiles: chosenFolderFiles,
        paths,
        documentIds,
      });
      onLogged?.(application, attachments);
    } catch (e2) {
      setError(e2.message);
      setSubmitting(false);
    }
  };

  const latestResumeDoc = useMemo(() => docs.find((d) => d.kind === "resume"), [docs]);
  const latestCoverDoc = useMemo(() => docs.find((d) => d.kind === "cover_letter"), [docs]);

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onClose}
      title="Log application"
      description={`${job?.company} — ${job?.title}`}
      footer={(
        <>
          <button type="button" className="btn-muted" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={loading || submitting}>{submitting ? "Logging…" : "Log application"}</button>
        </>
      )}
    >
      <ErrorBox>{error}</ErrorBox>
      {loading ? <div className="muted small">Loading…</div> : (
        <>
          <div className="form-grid">
            <Field label="Date applied">
              <input type="date" value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} required autoFocus />
            </Field>
            <Field label="Applied via">
              <select value={appliedVia} onChange={(e) => setAppliedVia(e.target.value)}>
                {APPLIED_VIA.map((v) => <option key={v} value={v}>{APPLIED_VIA_LABELS[v]}</option>)}
              </select>
            </Field>
            {appliedVia === "referral" && (
              <Field label="Referral name">
                <input type="text" value={referralName} onChange={(e) => setReferralName(e.target.value)} />
              </Field>
            )}
            <Field label="Applied URL">
              <input type="text" value={appliedUrl} onChange={(e) => setAppliedUrl(e.target.value)} />
            </Field>
            <Field label="Next action">
              <input type="text" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
            </Field>
            <Field label="Next action date">
              <input type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
            </Field>
          </div>

          <div className="section">
            <div className="section-title">Attachments</div>
            {(latestResumeDoc || latestCoverDoc) && (
              <div className="stack-tight">
                {latestResumeDoc && (
                  <Field inline label={`Link generated résumé v${latestResumeDoc.version}`}>
                    <input type="checkbox" checked={!!linkResumeId} onChange={(e) => setLinkResumeId(e.target.checked ? latestResumeDoc.id : null)} />
                  </Field>
                )}
                {latestCoverDoc && (
                  <Field inline label={`Link cover letter v${latestCoverDoc.version}`}>
                    <input type="checkbox" checked={!!linkCoverId} onChange={(e) => setLinkCoverId(e.target.checked ? latestCoverDoc.id : null)} />
                  </Field>
                )}
              </div>
            )}
            <div className="small muted stack-tight">{folderPath}</div>
            {folderFiles.length === 0 ? (
              <div className="muted small">No files found in the source folder.</div>
            ) : (
              <div className="file-checklist">
                {folderFiles.map((f) => (
                  <div key={f.name} className="flex-row small file-check-row">
                    <input type="checkbox" className="input-auto" checked={f.checked} onChange={() => toggleFolderFile(f.name)} />
                    <span className="grow">{f.name}</span>
                    <select value={f.kind} onChange={(e) => setFolderFileKind(f.name, e.target.value)}>
                      <option value="resume">Résumé</option>
                      <option value="cover_letter">Cover letter</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
            <div className="flex-row mt-2">
              <input
                type="text"
                placeholder="Or paste a full file path…"
                className="grow"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
              />
              <select value={pathKind} onChange={(e) => setPathKind(e.target.value)}>
                <option value="resume">Résumé</option>
                <option value="cover_letter">Cover letter</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <Field label="Notes" className="mt-3">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}
