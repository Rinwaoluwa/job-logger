import { run, get, all } from "../index.js";

// One source for the CHECK constraints in 007_outreach and the route's enums.
export const OUTREACH_CHANNELS = ["email", "linkedin"];
export const OUTREACH_STATUSES = ["sent", "replied", "no_response"];

export function insertOutreach({
  jobId, peopleSearchId = null, personKey, personName, channel,
  toAddress = null, subject = null, body = null,
}) {
  const info = run(
    `INSERT INTO outreach (job_id, people_search_id, person_key, person_name, channel, to_address, subject, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, peopleSearchId, personKey, personName, channel, toAddress, subject, body],
  );
  return getOutreach(info.lastInsertRowid);
}

export function getOutreach(id) {
  return get(`SELECT * FROM outreach WHERE id = ?`, [id]);
}

export function listOutreachByJob(jobId) {
  return all(`SELECT * FROM outreach WHERE job_id = ? ORDER BY id DESC`, [jobId]);
}

export function updateOutreachStatus(id, status) {
  run(`UPDATE outreach SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, id]);
  return getOutreach(id);
}

export function deleteOutreach(id) {
  run(`DELETE FROM outreach WHERE id = ?`, [id]);
}
