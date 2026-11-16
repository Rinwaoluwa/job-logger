import { run, get, all } from "../index.js";

export function insertFitAnalysis({ jobId, score, verdict, applyRecommendation, resultJson, profileHash, model, costUsd }) {
  const info = run(
    `INSERT INTO fit_analyses (job_id, score, verdict, apply_recommendation, result_json, profile_hash, model, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, score, verdict, applyRecommendation, JSON.stringify(resultJson), profileHash, model, costUsd],
  );
  return getFitAnalysis(info.lastInsertRowid);
}

function deserialize(row) {
  if (!row) return row;
  return { ...row, result_json: JSON.parse(row.result_json) };
}

export function getFitAnalysis(id) {
  return deserialize(get(`SELECT * FROM fit_analyses WHERE id = ?`, [id]));
}

export function latestFitForJob(jobId) {
  return deserialize(get(`SELECT * FROM fit_analyses WHERE job_id = ? ORDER BY id DESC LIMIT 1`, [jobId]));
}

export function allFitForJob(jobId) {
  return all(`SELECT * FROM fit_analyses WHERE job_id = ? ORDER BY id DESC`, [jobId]).map(deserialize);
}
