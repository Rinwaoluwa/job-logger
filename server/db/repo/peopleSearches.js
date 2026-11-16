import { run, get } from "../index.js";

export function insertPeopleSearch({ jobId, companyDomain, resultJson, costUsd, hints = null }) {
  const info = run(
    `INSERT INTO people_searches (job_id, company_domain, result_json, cost_usd, hints) VALUES (?, ?, ?, ?, ?)`,
    [jobId, companyDomain ?? null, JSON.stringify(resultJson), costUsd, hints || null],
  );
  return getPeopleSearch(info.lastInsertRowid);
}

/** Rewrites a search row in place: the pipeline saves after every round so
 * a later timeout keeps what earlier rounds found. */
export function updatePeopleSearch(id, { companyDomain, resultJson, costUsd }) {
  run(`UPDATE people_searches SET company_domain = ?, result_json = ?, cost_usd = ? WHERE id = ?`, [
    companyDomain ?? null,
    JSON.stringify(resultJson),
    costUsd,
    id,
  ]);
  return getPeopleSearch(id);
}

function deserialize(row) {
  if (!row) return row;
  return { ...row, result_json: JSON.parse(row.result_json) };
}

export function getPeopleSearch(id) {
  return deserialize(get(`SELECT * FROM people_searches WHERE id = ?`, [id]));
}

export function latestPeopleSearchForJob(jobId) {
  return deserialize(get(`SELECT * FROM people_searches WHERE job_id = ? ORDER BY id DESC LIMIT 1`, [jobId]));
}
