// One row per interview round the user is going into (or went into) for
// a job: who is in the room, what the recruiter said, which skills to
// focus the prep on. A debrief closes it and feeds the question bank.

import { run, get, all } from "../index.js";

export const ROUND_KINDS = ["recruiter_screen", "hiring_manager", "technical", "panel", "coding", "other"];
export const ROUND_STATUSES = ["upcoming", "done", "cancelled"];

function deserialize(row) {
  if (!row) return row;
  const parse = (s, fallback) => {
    try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
  };
  return {
    ...row,
    interviewers: parse(row.interviewers_json, []),
    focus_skills: parse(row.focus_skills_json, []),
    debrief: parse(row.debrief_json, null),
  };
}

export function getRound(id) {
  return deserialize(get(`SELECT * FROM interview_rounds WHERE id = ?`, [id]));
}

export function listRoundsByJob(jobId) {
  return all(`SELECT * FROM interview_rounds WHERE job_id = ? ORDER BY COALESCE(scheduled_at, created_at) ASC, id ASC`, [jobId]).map(deserialize);
}

/** Every round across jobs, with the job's title, company and stage. */
export function listAllRounds() {
  return all(
    `SELECT r.*, j.title AS job_title, j.company AS job_company, a.stage AS job_stage
     FROM interview_rounds r JOIN jobs j ON j.id = r.job_id LEFT JOIN applications a ON a.job_id = r.job_id
     ORDER BY r.id ASC`,
  ).map(deserialize);
}

export function insertRound({ jobId, kind, scheduledAt = null, interviewers = [], notes = "", focusSkills = [], focusText = "" }) {
  const info = run(
    `INSERT INTO interview_rounds (job_id, kind, scheduled_at, interviewers_json, notes, focus_skills_json, focus_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [jobId, kind, scheduledAt, JSON.stringify(interviewers), notes, JSON.stringify(focusSkills), focusText],
  );
  return getRound(info.lastInsertRowid);
}

const COLUMNS = {
  kind: "kind",
  scheduledAt: "scheduled_at",
  interviewers: "interviewers_json",
  notes: "notes",
  focusSkills: "focus_skills_json",
  focusText: "focus_text",
  status: "status",
};
const JSON_COLUMNS = new Set(["interviewers_json", "focus_skills_json"]);

export function updateRound(id, fields) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    const col = COLUMNS[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(JSON_COLUMNS.has(col) ? JSON.stringify(value ?? []) : value);
  }
  if (sets.length) {
    params.push(id);
    run(`UPDATE interview_rounds SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, params);
  }
  return getRound(id);
}

export function setRoundDebrief(id, debrief) {
  run(
    `UPDATE interview_rounds SET debrief_json = ?, status = 'done', updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(debrief), id],
  );
  return getRound(id);
}

export function deleteRound(id) {
  run(`DELETE FROM interview_rounds WHERE id = ?`, [id]);
}
