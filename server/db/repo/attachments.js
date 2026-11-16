import { run, get, all } from "../index.js";

export function insertAttachment({
  jobId, kind, label = null, filePath = null, fileName = null,
  size = null, mtime = null, sha256 = null, mime = null,
  documentId = null, documentHash = null,
}) {
  const info = run(
    `INSERT INTO attachments (job_id, kind, label, file_path, file_name, size, mtime, sha256, mime, document_id, document_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, kind, label, filePath, fileName, size, mtime, sha256, mime, documentId, documentHash],
  );
  return getAttachment(info.lastInsertRowid);
}

export function getAttachment(id) {
  return get(`SELECT * FROM attachments WHERE id = ?`, [id]);
}

// Joined to documents so a doc-linked attachment can show "Résumé v2" and
// whether it has been edited since it was linked (content_hash mismatch is
// computed by the route, which already has the sha256 helper).
export function listAttachmentsByJob(jobId) {
  return all(
    `SELECT att.*, d.kind AS doc_kind, d.version AS doc_version, d.title AS doc_title, d.content_json AS doc_content_json
     FROM attachments att
     LEFT JOIN documents d ON d.id = att.document_id
     WHERE att.job_id = ?
     ORDER BY att.created_at DESC`,
    [jobId],
  );
}

export function deleteAttachment(id) {
  run(`DELETE FROM attachments WHERE id = ?`, [id]);
}

// Prevents attaching the exact same file to the same job twice from the
// folder picker or the path input.
export function findByPath(jobId, filePath) {
  return get(`SELECT * FROM attachments WHERE job_id = ? AND file_path = ?`, [jobId, filePath]);
}

export function findByDocument(jobId, documentId) {
  return get(`SELECT * FROM attachments WHERE job_id = ? AND document_id = ?`, [jobId, documentId]);
}
