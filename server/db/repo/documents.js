import { createHash } from "node:crypto";
import { run, get, all } from "../index.js";

function nextVersion(jobId, kind) {
  const row = get(`SELECT MAX(version) AS v FROM documents WHERE job_id = ? AND kind = ?`, [jobId, kind]);
  return (row?.v || 0) + 1;
}

/**
 * A revision passes parentId (the version it was made from), instruction
 * (what the user asked for) and reviewDecisions (the decisions carried
 * over from that version); a fresh generation leaves all three out.
 */
export function saveDocument({
  jobId, kind, title, contentJson, contentText = null, question = null, costUsd = null, model = null,
  parentId = null, instruction = null, reviewDecisions = null,
}) {
  const version = nextVersion(jobId, kind);
  const info = run(
    `INSERT INTO documents (job_id, kind, version, title, content_json, content_text, question, cost_usd, model,
                            parent_id, instruction, review_decisions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      jobId, kind, version, title, JSON.stringify(contentJson), contentText, question, costUsd, model,
      parentId, instruction, JSON.stringify(reviewDecisions ?? {}),
    ],
  );
  return getDocument(info.lastInsertRowid);
}

function deserialize(row) {
  if (!row) return row;
  return {
    ...row,
    content_json: JSON.parse(row.content_json),
    review_decisions: JSON.parse(row.review_decisions || "{}"),
  };
}

export function getDocument(id) {
  return deserialize(get(`SELECT * FROM documents WHERE id = ?`, [id]));
}

/** The newest version of a kind for a job, or null. */
export function latestDocument(jobId, kind) {
  return deserialize(get(`SELECT * FROM documents WHERE job_id = ? AND kind = ? ORDER BY version DESC LIMIT 1`, [jobId, kind]));
}

/**
 * The résumé the interviewer has read: the version the application marks
 * as sent, else the newest one. `explicit` says which it was.
 * @returns {{ document: object|null, explicit: boolean }}
 */
export function sentResume(jobId) {
  const app = get(`SELECT sent_resume_document_id AS id FROM applications WHERE job_id = ?`, [jobId]);
  if (app?.id) {
    const doc = getDocument(app.id);
    if (doc && doc.job_id === jobId && doc.kind === "resume") return { document: doc, explicit: true };
  }
  return { document: latestDocument(jobId, "resume"), explicit: false };
}

/** The newest version's id and cost without its content — for list rows
 * that only need a download link. */
export function latestDocumentSummary(jobId, kind) {
  return get(`SELECT id, version, cost_usd, created_at FROM documents WHERE job_id = ? AND kind = ? ORDER BY version DESC LIMIT 1`, [jobId, kind]) || null;
}

export function listDocumentsByJob(jobId) {
  return all(`SELECT id, job_id, kind, version, title, question, cost_usd, model, created_at,
                     parent_id, instruction,
                     json_extract(content_json, '$.resume_version') AS resume_version,
                     (SELECT COUNT(*) FROM json_each(review_decisions)) AS reviewed_count
              FROM documents WHERE job_id = ? ORDER BY kind, version DESC`, [jobId]);
}

/**
 * The chain of instructions that led to a document, oldest first: the
 * document itself and each ancestor that was made from an instruction,
 * with the notes the model returned for that revision. Read with
 * json_extract so the ancestors' full content is never parsed.
 * @returns {Array<{id:number, version:number, instruction:string, notes:string[]}>}
 */
export function instructionThread(documentId, { limit = 12 } = {}) {
  const rows = all(
    `WITH RECURSIVE chain(id, parent_id, version, instruction, notes, questions, depth) AS (
       SELECT id, parent_id, version, instruction,
              json_extract(content_json, '$.revision_notes'), json_extract(content_json, '$.open_questions'), 0
       FROM documents WHERE id = ?
       UNION ALL
       SELECT d.id, d.parent_id, d.version, d.instruction,
              json_extract(d.content_json, '$.revision_notes'), json_extract(d.content_json, '$.open_questions'), c.depth + 1
       FROM documents d JOIN chain c ON d.id = c.parent_id
       WHERE c.depth < ?
     )
     SELECT id, version, instruction, notes, questions FROM chain
     WHERE instruction IS NOT NULL AND instruction <> ''
     ORDER BY depth DESC`,
    [documentId, limit],
  );
  const list = (json) => {
    try {
      const v = json ? JSON.parse(json) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  return rows.map((r) => ({ id: r.id, version: r.version, instruction: r.instruction, notes: list(r.notes), questions: list(r.questions) }));
}

export function updateReviewDecisions(id, reviewDecisions) {
  run(`UPDATE documents SET review_decisions = ? WHERE id = ?`, [JSON.stringify(reviewDecisions), id]);
  return getDocument(id);
}

export function updateContentJson(id, contentJson) {
  run(`UPDATE documents SET content_json = ? WHERE id = ?`, [JSON.stringify(contentJson), id]);
  return getDocument(id);
}

export function deleteDocument(id) {
  run(`DELETE FROM documents WHERE id = ?`, [id]);
}

// Hashes the raw stored content_json text (not the parsed/re-stringified
// object, to avoid any key-order drift) — used by attachments to record
// "this was the version sent" and later detect that it was edited since.
export function contentHash(id) {
  const row = get(`SELECT content_json FROM documents WHERE id = ?`, [id]);
  return row ? createHash("sha256").update(row.content_json).digest("hex") : null;
}
