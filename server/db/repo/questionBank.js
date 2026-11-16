// Questions the user has actually been asked (a round's debrief) or
// practised and kept (a mock answer saved), with the answer in their own
// words. Cross-job: a later prep reads it so the same behavioural answer
// is not reinvented per posting.

import { run, get, all } from "../index.js";

export const BANK_SOURCES = ["debrief", "mock", "manual"];

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ");

function deserialize(row) {
  if (!row) return row;
  let storyIds = [];
  try { storyIds = JSON.parse(row.story_ids_json || "[]"); } catch { storyIds = []; }
  return { ...row, story_ids: Array.isArray(storyIds) ? storyIds : [] };
}

export function getBankEntry(id) {
  return deserialize(get(`SELECT * FROM question_bank WHERE id = ?`, [id]));
}

export function listBank({ kind, company, source, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (kind) { where.push("kind = ?"); params.push(kind); }
  if (company) { where.push("company = ?"); params.push(company); }
  if (source) { where.push("source = ?"); params.push(source); }
  params.push(limit);
  return all(
    `SELECT * FROM question_bank ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    params,
  ).map(deserialize);
}

/** The same question asked again (debrief) bumps the count on the row it
 *  matches rather than adding a twin. Matching is on the normalised text. */
export function findBankByQuestion(question) {
  const key = norm(question);
  if (!key) return null;
  const rows = all(`SELECT * FROM question_bank`);
  return deserialize(rows.find((r) => norm(r.question) === key) || null);
}

export function upsertBankEntry({ question, kind = null, source, jobId = null, company = null, roundKind = null, storyIds = [], myAnswer = "", notes = "" }) {
  const existing = findBankByQuestion(question);
  if (existing) {
    run(
      `UPDATE question_bank SET times_asked = times_asked + 1,
         kind = COALESCE(kind, ?), company = COALESCE(company, ?), round_kind = COALESCE(round_kind, ?),
         my_answer = CASE WHEN my_answer = '' THEN ? ELSE my_answer END,
         notes = CASE WHEN notes = '' THEN ? ELSE notes END,
         story_ids_json = CASE WHEN story_ids_json = '[]' THEN ? ELSE story_ids_json END,
         updated_at = datetime('now')
       WHERE id = ?`,
      [kind, company, roundKind, myAnswer, notes, JSON.stringify(storyIds), existing.id],
    );
    return { entry: getBankEntry(existing.id), created: false };
  }
  const info = run(
    `INSERT INTO question_bank (question, kind, source, job_id, company, round_kind, story_ids_json, my_answer, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [question, kind, source, jobId, company, roundKind, JSON.stringify(storyIds), myAnswer, notes],
  );
  return { entry: getBankEntry(info.lastInsertRowid), created: true };
}

const COLUMNS = { question: "question", kind: "kind", myAnswer: "my_answer", notes: "notes", storyIds: "story_ids_json", roundKind: "round_kind", company: "company" };

export function updateBankEntry(id, fields) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    const col = COLUMNS[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(col === "story_ids_json" ? JSON.stringify(value ?? []) : value);
  }
  if (sets.length) {
    params.push(id);
    run(`UPDATE question_bank SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, params);
  }
  return getBankEntry(id);
}

export function deleteBankEntry(id) {
  run(`DELETE FROM question_bank WHERE id = ?`, [id]);
}
