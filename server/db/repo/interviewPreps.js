import { run, get, all } from "../index.js";

export function insertInterviewPrep({ jobId, roundId = null, resultJson, costUsd }) {
  const info = run(
    `INSERT INTO interview_preps (job_id, round_id, result_json, cost_usd) VALUES (?, ?, ?, ?)`,
    [jobId, roundId, JSON.stringify(resultJson), costUsd],
  );
  return getInterviewPrep(info.lastInsertRowid);
}

function deserialize(row) {
  if (!row) return row;
  return { ...row, result_json: JSON.parse(row.result_json) };
}

export function getInterviewPrep(id) {
  return deserialize(get(`SELECT * FROM interview_preps WHERE id = ?`, [id]));
}

/** Replaces the stored result (one question rewritten in place). The
 *  cost of the rewrite is logged in ai_calls; the row's cost_usd stays
 *  the cost of the original run. */
export function updateInterviewPrepResult(id, resultJson) {
  run(`UPDATE interview_preps SET result_json = ? WHERE id = ?`, [JSON.stringify(resultJson), id]);
  return getInterviewPrep(id);
}

export function latestInterviewPrepForJob(jobId) {
  return deserialize(get(`SELECT * FROM interview_preps WHERE job_id = ? ORDER BY id DESC LIMIT 1`, [jobId]));
}

/** The newest prep written for a round, or (roundId null) the newest
 *  prep written for the job as a whole, outside any round. */
export function latestInterviewPrepForRound(jobId, roundId) {
  return deserialize(roundId
    ? get(`SELECT * FROM interview_preps WHERE job_id = ? AND round_id = ? ORDER BY id DESC LIMIT 1`, [jobId, roundId])
    : get(`SELECT * FROM interview_preps WHERE job_id = ? AND round_id IS NULL ORDER BY id DESC LIMIT 1`, [jobId]));
}

/** The newest prep per round plus the newest general one: what the
 *  Interview tab needs to switch between rounds without a request each. */
export function listCurrentInterviewPreps(jobId) {
  return all(
    `SELECT p.* FROM interview_preps p
     WHERE p.job_id = ? AND p.id = (
       SELECT MAX(id) FROM interview_preps q WHERE q.job_id = p.job_id AND COALESCE(q.round_id, 0) = COALESCE(p.round_id, 0)
     )
     ORDER BY p.id DESC`,
    [jobId],
  ).map(deserialize);
}
