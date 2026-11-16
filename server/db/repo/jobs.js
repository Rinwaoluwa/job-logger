import { randomUUID } from "node:crypto";
import { run, get, all } from "../index.js";
import { ensureApplication } from "./applications.js";

function serializeJobFields(job) {
  return {
    ...job,
    also_seen_on: JSON.stringify(job.also_seen_on ?? []),
    tags: JSON.stringify(job.tags ?? []),
    raw: job.raw != null ? JSON.stringify(job.raw) : null,
  };
}

function deserializeJobRow(row) {
  if (!row) return row;
  return {
    ...row,
    also_seen_on: safeParse(row.also_seen_on, []),
    tags: safeParse(row.tags, []),
    raw: row.raw ? safeParse(row.raw, null) : null,
    jd_analysis: row.jd_analysis ? safeParse(row.jd_analysis, null) : null,
    hidden: !!row.hidden,
    description_truncated: !!row.description_truncated,
  };
}

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function getJobByUrl(url) {
  return deserializeJobRow(get(`SELECT * FROM jobs WHERE url = ?`, [url]));
}

export function getJobBySourceId(source, sourceId) {
  if (!source || !sourceId) return null;
  return deserializeJobRow(get(`SELECT * FROM jobs WHERE source = ? AND source_id = ? LIMIT 1`, [source, String(sourceId)]));
}

/** The job that stands for this Jack & Jill posting, whichever source
 * stored it first: the JSON import (source_id), a routine-log line that
 * recorded the Jack & Jill page link (raw.routine.jackandjill_id, or the
 * id inside the URL for rows stored before that field existed), or a job
 * the import already enriched (raw.jackandjill.id). */
export function getJobByJackAndJillId(id) {
  if (!id) return null;
  const key = String(id);
  return deserializeJobRow(
    get(
      `SELECT * FROM jobs
       WHERE (source = 'jackandjill' AND source_id = ?)
          OR json_extract(raw, '$.jackandjill.id') = ?
          OR json_extract(raw, '$.routine.jackandjill_id') = ?
          OR url LIKE ?
       ORDER BY CASE WHEN source = 'jackandjill' THEN 0 ELSE 1 END, id LIMIT 1`,
      [key, key, key, `%jackandjill.ai/jobs/${key}/%`],
    ),
  );
}

/** A job that was merged (by company + title) with a listing at this URL
 * from another feed: the URL lives in also_seen_on, not in url. */
export function getJobBySeenUrl(url) {
  if (!url) return null;
  return deserializeJobRow(get(`SELECT * FROM jobs WHERE also_seen_on LIKE ? LIMIT 1`, [`%${JSON.stringify({ url }).slice(1, -1)}%`]));
}

/** Latest day heading (YYYY-MM-DD) the routine log reader has stored, so
 * the next read can ask the doc for that day onward only. */
export function latestRoutineLoggedOn() {
  const row = get(`SELECT MAX(json_extract(raw, '$.routine.logged_on')) AS day FROM jobs WHERE raw IS NOT NULL`);
  return row?.day || null;
}

export function getJobByDedupeKey(dedupeKey, withinDays = 45) {
  return deserializeJobRow(
    get(
      `SELECT * FROM jobs WHERE dedupe_key = ? AND (posted_at IS NULL OR posted_at >= datetime('now', ?)) ORDER BY id DESC LIMIT 1`,
      [dedupeKey, `-${withinDays} days`],
    ),
  );
}

export function findCandidatesByCompany(company) {
  return all(`SELECT * FROM jobs WHERE company = ? ORDER BY id DESC LIMIT 200`, [company]).map(deserializeJobRow);
}

export function getJob(id) {
  return deserializeJobRow(get(`SELECT * FROM jobs WHERE id = ?`, [id]));
}

export function insertJob(job) {
  const id = job.id || randomUUID();
  const s = serializeJobFields({ ...job, id });
  run(
    `INSERT INTO jobs (
      id, source, source_id, url, apply_url, title, company, location_raw, country, region, city,
      work_mode, remote_scope, salary_text, salary_min, salary_max, currency,
      description_text, description_html, description_truncated, posted_at, dedupe_key,
      also_seen_on, raw, tags
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      s.id, s.source, s.source_id ?? null, s.url, s.apply_url ?? null, s.title, s.company,
      s.location_raw ?? null, s.country ?? null, s.region ?? null, s.city ?? null,
      s.work_mode || "unknown", s.remote_scope ?? null,
      s.salary_text ?? null, s.salary_min ?? null, s.salary_max ?? null, s.currency ?? null,
      s.description_text || "", s.description_html ?? null, s.description_truncated ? 1 : 0,
      s.posted_at ?? null, s.dedupe_key, s.also_seen_on, s.raw, s.tags,
    ],
  );
  ensureApplication(id);
  return getJob(id);
}

export function updateJobMutableFields(id, fields) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "also_seen_on" || key === "tags") {
      sets.push(`${key} = ?`);
      params.push(JSON.stringify(value));
    } else if (key === "raw") {
      sets.push(`raw = ?`);
      params.push(value != null ? JSON.stringify(value) : null);
    } else {
      // node:sqlite binds only null, numbers, strings, bigints and
      // buffers: a boolean (description_truncated from an adapter) or an
      // undefined field would throw "cannot be bound to SQLite parameter".
      sets.push(`${key} = ?`);
      params.push(typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);
    }
  }
  sets.push(`updated_at = datetime('now')`);
  params.push(id);
  run(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, params);
  return getJob(id);
}

export function setJobJdAnalysis(id, jdAnalysis) {
  run(
    `UPDATE jobs SET jd_analysis = ?, jd_analysis_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(jdAnalysis), id],
  );
  return getJob(id);
}

export function setJobHidden(id, hidden) {
  run(`UPDATE jobs SET hidden = ?, updated_at = datetime('now') WHERE id = ?`, [hidden ? 1 : 0, id]);
  return getJob(id);
}

/** True when a job with this URL, or this (source, source_id), was deleted
 * in the app. List-style sources check it so a deleted job stays gone. */
export function isTombstoned({ url, source, sourceId } = {}) {
  if (url && get(`SELECT 1 FROM job_tombstones WHERE url = ?`, [url])) return true;
  if (source && sourceId && get(`SELECT 1 FROM job_tombstones WHERE source = ? AND source_id = ?`, [source, String(sourceId)])) return true;
  return false;
}

/** Ids of this source's jobs posted before cutoffIso that the user has
 * not touched: still at stage "new", no documents or interview prep, no
 * task queued or running. posted_at is compared as text, so the caller
 * passes a full ISO string and only uses this for sources whose
 * posted_at is stored that way (the Jack & Jill importer's toIso). */
export function listStaleUntouchedJobs(source, cutoffIso) {
  return all(
    `SELECT j.id FROM jobs j
     LEFT JOIN applications a ON a.job_id = j.id
     WHERE j.source = ? AND j.posted_at IS NOT NULL AND j.posted_at < ?
       AND (a.stage IS NULL OR a.stage = 'new')
       AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.job_id = j.id)
       AND NOT EXISTS (SELECT 1 FROM interview_preps p WHERE p.job_id = j.id)
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = j.id AND t.status IN ('queued','running'))`,
    [source, cutoffIso],
  ).map((r) => r.id);
}

export function deleteJob(id) {
  const job = get(`SELECT url, source, source_id, title, company FROM jobs WHERE id = ?`, [id]);
  if (job) {
    run(
      `INSERT OR REPLACE INTO job_tombstones (url, source, source_id, title, company) VALUES (?,?,?,?,?)`,
      [job.url, job.source, job.source_id ?? null, job.title, job.company],
    );
  }
  run(`DELETE FROM jobs WHERE id = ?`, [id]);
}

export function listJobs({
  q, stage, minFit, verdict, workMode, country, source, tag, sort = "posted", includeHidden = false,
} = {}) {
  const where = [];
  const params = [];
  if (!includeHidden) where.push(`j.hidden = 0`);
  if (q) {
    where.push(`(j.title LIKE ? OR j.company LIKE ? OR j.location_raw LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (stage?.length) {
    where.push(`a.stage IN (${stage.map(() => "?").join(",")})`);
    params.push(...stage);
  }
  if (workMode?.length) {
    where.push(`j.work_mode IN (${workMode.map(() => "?").join(",")})`);
    params.push(...workMode);
  }
  if (country?.length) {
    where.push(`j.country IN (${country.map(() => "?").join(",")})`);
    params.push(...country);
  }
  if (source?.length) {
    where.push(`j.source IN (${source.map(() => "?").join(",")})`);
    params.push(...source);
  }
  if (tag) {
    // tags is a JSON array in text; a quoted match is exact enough.
    where.push(`j.tags LIKE ?`);
    params.push(`%${JSON.stringify(String(tag))}%`);
  }

  const orderBy = sort === "fit" ? `latest_fit.score DESC`
    : sort === "company" ? `j.company ASC`
    : sort === "ingested" ? `j.ingested_at DESC`
    : `j.posted_at DESC`;

  const rows = all(
    `
    SELECT j.*, a.stage AS app_stage, a.applied_at AS app_applied_at,
           latest_fit.score AS fit_score, latest_fit.verdict AS fit_verdict,
           latest_fit.apply_recommendation AS fit_recommendation, latest_fit.created_at AS fit_at,
           (SELECT t.status FROM tasks t
             WHERE t.job_id = j.id AND t.kind = 'fit' AND t.status IN ('queued','running')
             ORDER BY CASE t.status WHEN 'running' THEN 0 ELSE 1 END LIMIT 1) AS fit_task_status,
           (SELECT MAX(version) FROM documents d WHERE d.job_id = j.id AND d.kind = 'resume') AS resume_version,
           (SELECT MAX(version) FROM documents d WHERE d.job_id = j.id AND d.kind = 'cover_letter') AS cover_letter_version,
           (SELECT COUNT(*) FROM interview_preps ip WHERE ip.job_id = j.id) AS interview_prep_count
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    LEFT JOIN (
      SELECT fa.job_id, fa.score, fa.verdict, fa.apply_recommendation, fa.created_at
      FROM fit_analyses fa
      INNER JOIN (SELECT job_id, MAX(id) AS max_id FROM fit_analyses GROUP BY job_id) latest2
        ON latest2.job_id = fa.job_id AND latest2.max_id = fa.id
    ) latest_fit ON latest_fit.job_id = j.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderBy}
    `,
    params,
  );

  return rows
    .filter((r) => (minFit ? (r.fit_score ?? -1) >= minFit : true))
    .filter((r) => (verdict?.length ? verdict.includes(r.fit_verdict) : true))
    .map((r) => ({
      ...deserializeJobRow(r),
      stage: r.app_stage || "new",
      appliedAt: r.app_applied_at,
      fit: r.fit_score != null
        ? { score: r.fit_score, verdict: r.fit_verdict, recommendation: r.fit_recommendation, at: r.fit_at }
        : null,
      fitStatus: r.fit_task_status || (r.fit_score != null ? "done" : "none"),
      docs: {
        resume: r.resume_version || 0,
        coverLetter: r.cover_letter_version || 0,
        interviewPrep: r.interview_prep_count || 0,
      },
    }));
}
