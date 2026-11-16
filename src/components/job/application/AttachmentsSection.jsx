import { useEffect, useState } from "react";
import { api } from "../../../api/client.js";
import { fileSize } from "../../../lib/format.js";

const KIND_LABEL = { resume: "Résumé", cover_letter: "Cover letter", other: "Other" };
const STATUS_LABEL = { ok: "ok", changed: "changed", missing: "missing", "linked-doc": "generated doc" };
const STATUS_CLASS = { ok: "fit-good", changed: "fit-stretch", missing: "fit-no", "linked-doc": "fit-none" };

export default function AttachmentsSection({ jobId, documents = [], refreshKey, sentResumeDocumentId = null }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [folderPath, setFolderPath] = useState(null);
  const [folderFiles, setFolderFiles] = useState([]);
  const [pickedFile, setPickedFile] = useState("");
  const [pickedKind, setPickedKind] = useState("resume");
  const [pathInput, setPathInput] = useState("");
  const [pathKind, setPathKind] = useState("other");
  const [docToLink, setDocToLink] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => api.listAttachments(jobId).then(setAttachments).catch((e) => setError(e.message));

  useEffect(() => {
    setLoading(true);
    Promise.all([api.listAttachments(jobId), api.sourceFolder()])
      .then(([atts, folder]) => {
        setAttachments(atts);
        setFolderPath(folder.path);
        setFolderFiles(folder.files);
        if (folder.files[0]) setPickedFile(folder.files[0].name);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId, refreshKey]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const attachFromFolder = () => pickedFile && run(() => api.attachFromFolder(jobId, { name: pickedFile, kind: pickedKind }));
  const attachFromPath = () => pathInput.trim() && run(async () => { await api.attachFromPath(jobId, { path: pathInput.trim(), kind: pathKind }); setPathInput(""); });
  const linkDoc = () => docToLink && run(async () => { const doc = documents.find((d) => String(d.id) === docToLink); await api.linkDocument(jobId, { documentId: doc.id, kind: doc.kind === "cover_letter" ? "cover_letter" : "resume" }); setDocToLink(""); });
  const remove = (id) => run(() => api.deleteAttachment(id));
  const reveal = (id) => api.revealAttachment(id).catch((e) => setError(e.message));

  if (loading) return <div className="muted small">Loading…</div>;

  return (
    <div className="section">
      <div className="section-title">Attachments</div>
      {error && <div className="err-box">{error}</div>}
      {attachments.length === 0 ? (
        <div className="muted small mb-3">No files attached yet.</div>
      ) : (
        <div className="mb-3">
          {attachments.map((a) => (
            <div key={a.id} className="attachment-row">
              <span className="kind-badge badge fit-none">{KIND_LABEL[a.kind] || a.kind}</span>
              <span className="grow">
                {a.document_id ? (a.label || `${a.doc_kind === "cover_letter" ? "Cover letter" : "Résumé"} v${a.doc_version}`) : (a.label || a.file_name)}
                {a.document_id && a.document_id === sentResumeDocumentId && <span className="chip-ok sent-chip" title="The résumé version interview prep is written against">sent</span>}
                {a.document_id && a.documentEdited && <span className="small inferred-note ml-2">edited since sent</span>}
              </span>
              {a.size != null && <span className="muted small">{fileSize(a.size)}</span>}
              <span className={`badge file-status ${STATUS_CLASS[a.status] || "fit-none"}`}>{STATUS_LABEL[a.status] || a.status}</span>
              {a.file_path && (
                <>
                  <a href={`/api/attachments/${a.id}/file`} target="_blank" rel="noreferrer">Open</a>
                  <a href={`/api/attachments/${a.id}/file?download=1`}>Download</a>
                  <button type="button" className="btn-sm btn-muted" onClick={() => reveal(a.id)}>Reveal</button>
                </>
              )}
              <button type="button" className="btn-sm btn-danger" onClick={() => remove(a.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {(documents.some((d) => d.kind === "resume") || documents.some((d) => d.kind === "cover_letter")) && (
        <div className="flex-row mb-2">
          <select value={docToLink} onChange={(e) => setDocToLink(e.target.value)}>
            <option value="">Link a generated document…</option>
            {documents.filter((d) => d.kind === "resume" || d.kind === "cover_letter").map((d) => (
              <option key={d.id} value={d.id}>{d.kind === "cover_letter" ? "Cover letter" : "Résumé"} v{d.version}</option>
            ))}
          </select>
          <button type="button" className="btn-sm" disabled={!docToLink || busy} onClick={linkDoc}>Link</button>
        </div>
      )}

      {folderFiles.length > 0 && (
        <div className="flex-row mb-2">
          <select value={pickedFile} onChange={(e) => setPickedFile(e.target.value)} className="grow">
            {folderFiles.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
          <select value={pickedKind} onChange={(e) => setPickedKind(e.target.value)}>
            <option value="resume">Résumé</option>
            <option value="cover_letter">Cover letter</option>
            <option value="other">Other</option>
          </select>
          <button type="button" className="btn-sm" disabled={busy} onClick={attachFromFolder}>Attach</button>
        </div>
      )}
      {folderPath && <div className="muted small mb-2">Browsing {folderPath}</div>}

      <div className="flex-row">
        <input type="text" placeholder="Or paste a full file path…" className="grow" value={pathInput} onChange={(e) => setPathInput(e.target.value)} />
        <select value={pathKind} onChange={(e) => setPathKind(e.target.value)}>
          <option value="resume">Résumé</option>
          <option value="cover_letter">Cover letter</option>
          <option value="other">Other</option>
        </select>
        <button type="button" className="btn-sm btn-muted" disabled={busy} onClick={attachFromPath}>Attach</button>
      </div>
    </div>
  );
}
