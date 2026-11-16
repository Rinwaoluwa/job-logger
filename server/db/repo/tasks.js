// Persistent background tasks. One row per long operation; the worker in
// server/tasks/worker.js claims queued rows and drives them, the routes
// create and cancel them, and the browser's activity panel lists them.
//
// Every write here is synchronous on the one DatabaseSync connection, and
// no function awaits between reading a row and writing it back, so the
// read-modify-write on stages_json cannot interleave with another task's.

import { randomUUID } from "node:crypto";
import { run, get, all } from "../index.js";
import { PRIORITY, ACTIVE_STATUSES } from "../../../shared/tasks.js";
import { notifyTaskQueued } from "../../tasks/kick.js";

const nowIso = () => new Date().toISOString();

const SELECT = `
  SELECT t.*, j.title AS job_title, j.company AS job_company, j.url AS job_url, j.source AS job_source
  FROM tasks t
  LEFT JOIN jobs j ON j.id = t.job_id`;

function parse(json, fallback) {
  if (json == null || json === "") return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    jobId: row.job_id,
    groupId: row.group_id,
    dedupeKey: row.dedupe_key,
    payload: parse(row.payload_json, {}),
    status: row.status,
    priority: row.priority,
    stages: parse(row.stages_json, []),
    result: parse(row.result_json, null),
    error: row.error,
    costUsd: row.cost_usd || 0,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    job: row.job_id && row.job_title != null
      ? { id: row.job_id, title: row.job_title, company: row.job_company, url: row.job_url, source: row.job_source }
      : null,
  };
}

export function getTask(id) {
  return toTask(get(`${SELECT} WHERE t.id = ?`, [id]));
}

export const defaultDedupeKey = (kind, jobId) => (jobId ? `${kind}:${jobId}` : kind);

/**
 * Creates a queued task, or returns the active one that already covers
 * the same work. `dedupeKey: null` disables the guard (answers are never
 * deduped — asking twice is legitimate).
 * @returns {{ task: object, existing: boolean }}
 */
export function createTask({
  kind,
  jobId = null,
  payload = {},
  priority = PRIORITY.user,
  groupId = null,
  stages = [],
  dedupeKey = defaultDedupeKey(kind, jobId),
}) {
  if (dedupeKey) {
    const active = get(`SELECT id, priority FROM tasks WHERE dedupe_key = ? AND status IN ('queued','running')`, [dedupeKey]);
    if (active) {
      // A user click on work that is already queued in the background
      // should at least move it to the front.
      if (active.priority < priority) run(`UPDATE tasks SET priority = ? WHERE id = ? AND status = 'queued'`, [priority, active.id]);
      return { task: getTask(active.id), existing: true };
    }
  }
  const id = randomUUID();
  run(
    `INSERT INTO tasks (id, kind, job_id, group_id, dedupe_key, payload_json, status, priority, stages_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    [
      id, kind, jobId, groupId, dedupeKey || null,
      JSON.stringify(payload ?? {}), priority,
      JSON.stringify(stages.map((name) => ({ name, status: "pending" }))),
      nowIso(),
    ],
  );
  notifyTaskQueued();
  return { task: getTask(id), existing: false };
}

/** Thin wrapper kept for the source adapters and link ingestion, which
 * only ever queue fit scoring. */
export function enqueueFit(jobId, { priority = PRIORITY.background, groupId = null } = {}) {
  return createTask({ kind: "fit", jobId, priority, groupId, stages: ["fit"] });
}

/**
 * Atomically flips the highest-priority queued task to running and
 * returns it, or null when nothing is waiting. `minPriority` lets the
 * worker keep its last slot for user-initiated work.
 */
export function claimNext({ minPriority = null } = {}) {
  const candidate = get(
    `SELECT id, stages_json FROM tasks
     WHERE status = 'queued' ${minPriority != null ? "AND priority >= ?" : ""}
     ORDER BY priority DESC, created_at ASC LIMIT 1`,
    minPriority != null ? [minPriority] : [],
  );
  if (!candidate) return null;
  const stages = parse(candidate.stages_json, []).map((s) => ({ name: s.name, status: "pending" }));
  const row = get(
    `UPDATE tasks
     SET status = 'running', started_at = ?, finished_at = NULL, attempts = attempts + 1,
         stages_json = ?, cost_usd = 0, error = NULL, result_json = NULL
     WHERE id = ? AND status = 'queued'
     RETURNING id`,
    [nowIso(), JSON.stringify(stages), candidate.id],
  );
  return row ? getTask(row.id) : null;
}

function updateStages(taskId, mutate) {
  const row = get(`SELECT stages_json FROM tasks WHERE id = ?`, [taskId]);
  if (!row) return null;
  const stages = parse(row.stages_json, []);
  const extra = mutate(stages) || {};
  return { stages, ...extra };
}

/** The newest entry for a stage name: a stage that runs more than once
 * (the reviewer and the rewrite loop) has one entry per pass. */
function lastStage(stages, name) {
  for (let i = stages.length - 1; i >= 0; i--) if (stages[i].name === name) return stages[i];
  return null;
}

/** A stage the route did not declare up front is appended rather than
 * dropped, so progress reporting never silently loses a step. A stage
 * that already finished and begins again gets a new entry with its pass
 * number, so the first pass's timing is kept rather than overwritten. */
export function beginStage(taskId, name) {
  const out = updateStages(taskId, (stages) => {
    let s = lastStage(stages, name);
    if (!s) {
      s = { name };
      stages.push(s);
    } else if (s.status === "done" || s.status === "failed") {
      s = { name, pass: (s.pass || 1) + 1 };
      stages.push(s);
    }
    s.status = "running";
    s.startedAt = nowIso();
    s.finishedAt = null;
    s.error = null;
  });
  if (out) run(`UPDATE tasks SET stages_json = ? WHERE id = ?`, [JSON.stringify(out.stages), taskId]);
}

export function finishStage(taskId, name, { costUsd = 0 } = {}) {
  const cost = Number.isFinite(costUsd) ? costUsd : 0;
  const out = updateStages(taskId, (stages) => {
    let s = lastStage(stages, name);
    if (!s) {
      s = { name, startedAt: nowIso() };
      stages.push(s);
    }
    s.status = "done";
    s.finishedAt = nowIso();
    s.costUsd = cost;
  });
  if (out) run(`UPDATE tasks SET stages_json = ?, cost_usd = cost_usd + ? WHERE id = ?`, [JSON.stringify(out.stages), cost, taskId]);
}

/** Marks the stage failed. The task's own status is the worker's call
 * (a cancellation must win over a failure raised while unwinding). */
export function failStage(taskId, name, err) {
  const out = updateStages(taskId, (stages) => {
    let s = lastStage(stages, name);
    if (!s) {
      s = { name, startedAt: nowIso() };
      stages.push(s);
    }
    s.status = "failed";
    s.finishedAt = nowIso();
    s.error = err?.message || String(err);
  });
  if (out) run(`UPDATE tasks SET stages_json = ? WHERE id = ?`, [JSON.stringify(out.stages), taskId]);
}

export function finishTask(taskId, result) {
  run(
    `UPDATE tasks SET status = 'done', result_json = ?, finished_at = ?, dedupe_key = NULL
     WHERE id = ? AND status = 'running'`,
    [result == null ? null : JSON.stringify(result), nowIso(), taskId],
  );
  return getTask(taskId);
}

export function failTask(taskId, error) {
  run(
    `UPDATE tasks SET status = 'failed', error = ?, finished_at = ?, dedupe_key = NULL
     WHERE id = ? AND status = 'running'`,
    [error?.message || String(error), nowIso(), taskId],
  );
  return getTask(taskId);
}

export function cancelTask(taskId) {
  const out = updateStages(taskId, (stages) => {
    for (const s of stages) {
      if (s.status === "running") {
        s.status = "failed";
        s.finishedAt = nowIso();
        s.error = "cancelled";
      }
    }
  });
  if (!out) return null;
  run(
    `UPDATE tasks SET status = 'cancelled', stages_json = ?, error = 'cancelled', finished_at = ?, dedupe_key = NULL
     WHERE id = ? AND status IN ('queued','running')`,
    [JSON.stringify(out.stages), nowIso(), taskId],
  );
  return getTask(taskId);
}

/** add_job_link only knows its job once the posting has been ingested. */
export function setTaskJob(taskId, jobId) {
  run(`UPDATE tasks SET job_id = ? WHERE id = ?`, [jobId, taskId]);
}

/** Everything active, running first, then the recently finished. */
export function listTasks({ recentLimit = 50, sinceHours = 24 } = {}) {
  const active = all(
    `${SELECT} WHERE t.status IN ('queued','running')
     ORDER BY CASE t.status WHEN 'running' THEN 0 ELSE 1 END, t.priority DESC, t.created_at ASC`,
  );
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const recent = all(
    `${SELECT} WHERE t.status IN ('done','failed','cancelled') AND t.finished_at >= ?
     ORDER BY t.finished_at DESC LIMIT ?`,
    [since, recentLimit],
  );
  return [...active, ...recent].map(toTask);
}

export function listTasksByJob(jobId, limit = 10) {
  return all(`${SELECT} WHERE t.job_id = ? ORDER BY t.created_at DESC LIMIT ?`, [jobId, limit]).map(toTask);
}

export function activeTaskIds({ jobId = null, groupId = null } = {}) {
  const where = [`status IN ('queued','running')`];
  const params = [];
  if (jobId) {
    where.push(`job_id = ?`);
    params.push(jobId);
  }
  if (groupId) {
    where.push(`group_id = ?`);
    params.push(groupId);
  }
  return all(`SELECT id FROM tasks WHERE ${where.join(" AND ")}`, params).map((r) => r.id);
}

export function counts() {
  const rows = all(`SELECT status, kind, COUNT(*) AS n FROM tasks WHERE status IN ('queued','running') GROUP BY status, kind`);
  const out = { queued: 0, running: 0, byKind: {} };
  for (const r of rows) {
    out[r.status] += r.n;
    out.byKind[r.kind] = out.byKind[r.kind] || { queued: 0, running: 0 };
    out.byKind[r.kind][r.status] += r.n;
  }
  return out;
}

/** On boot, any row left running belongs to a process that died (crash,
 * kill, `node --watch` reload). Nothing is working on it, so put it back
 * in the queue — or, once it has been claimed `maxAttempts` times, stop
 * spending on it and mark it failed. */
export function requeueStuckRunning({ maxAttempts = 2 } = {}) {
  const message = "The server restarted during this run more than once; giving up. Retry to run it again.";
  run(
    `UPDATE tasks SET
       status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
       error = CASE WHEN attempts >= ? THEN ? ELSE NULL END,
       finished_at = CASE WHEN attempts >= ? THEN ? ELSE NULL END,
       dedupe_key = CASE WHEN attempts >= ? THEN NULL ELSE dedupe_key END,
       started_at = NULL
     WHERE status = 'running'`,
    [maxAttempts, maxAttempts, message, maxAttempts, nowIso(), maxAttempts],
  );
}

/** Drops one finished row from the activity list. An active row is left
 * alone — it has to be cancelled first. */
export function deleteTask(taskId) {
  return run(`DELETE FROM tasks WHERE id = ? AND status IN ('done','failed','cancelled')`, [taskId]).changes > 0;
}

/** Drops every failed row, including ones older than the panel shows. */
export function deleteFailedTasks() {
  return Number(run(`DELETE FROM tasks WHERE status = 'failed'`).changes);
}

export function pruneOld({ days = 14 } = {}) {
  const before = new Date(Date.now() - days * 86_400_000).toISOString();
  run(`DELETE FROM tasks WHERE status IN ('done','failed','cancelled') AND finished_at < ?`, [before]);
}

export const isActiveStatus = (status) => ACTIVE_STATUSES.includes(status);
