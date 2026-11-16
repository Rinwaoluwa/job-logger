// One row per answer given in a mock interview: the question as asked,
// what the user said (typed or transcribed), and the critique once the
// task that writes it has run. session_id groups one sitting.

import { run, get, all } from "../index.js";

function deserialize(row) {
  if (!row) return row;
  let critique = null;
  try { critique = row.critique_json ? JSON.parse(row.critique_json) : null; } catch { critique = null; }
  return { ...row, critique };
}

export function getMockTurn(id) {
  return deserialize(get(`SELECT * FROM mock_turns WHERE id = ?`, [id]));
}

export function listMockTurnsByJob(jobId, limit = 100) {
  return all(`SELECT * FROM mock_turns WHERE job_id = ? ORDER BY id DESC LIMIT ?`, [jobId, limit]).map(deserialize);
}

export function insertMockTurn({ jobId, interviewPrepId = null, sessionId, parentTurnId = null, questionIndex = null, question, kind = null, answer, via, seconds = null }) {
  const info = run(
    `INSERT INTO mock_turns (job_id, interview_prep_id, session_id, parent_turn_id, question_index, question, kind, answer, via, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, interviewPrepId, sessionId, parentTurnId, questionIndex, question, kind, answer, via, seconds],
  );
  return getMockTurn(info.lastInsertRowid);
}

export function setMockTurnCritique(id, critique, costUsd) {
  run(`UPDATE mock_turns SET critique_json = ?, cost_usd = ? WHERE id = ?`, [JSON.stringify(critique), costUsd ?? null, id]);
  return getMockTurn(id);
}

export function deleteMockTurn(id) {
  run(`DELETE FROM mock_turns WHERE id = ?`, [id]);
}
