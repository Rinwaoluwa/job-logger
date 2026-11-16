import { run, get, all, transaction } from "../index.js";

export const STAGES = ["new", "saved", "applied", "interviewing", "offer", "rejected", "not_interested"];
export const APPLIED_VIA = ["company_site", "linkedin", "indeed", "referral", "email", "recruiter", "other"];

export function ensureApplication(jobId, initialStage = "new") {
  const existing = get(`SELECT * FROM applications WHERE job_id = ?`, [jobId]);
  if (existing) return existing;
  run(`INSERT INTO applications (job_id, stage) VALUES (?, ?)`, [jobId, initialStage]);
  return get(`SELECT * FROM applications WHERE job_id = ?`, [jobId]);
}

export function getApplication(jobId) {
  return get(`SELECT * FROM applications WHERE job_id = ?`, [jobId]);
}

// Freezes the job's current description onto the application the first
// time it happens (never overwrites it on a later re-apply/reopen), so
// "what I actually applied to" survives the JD being edited or hydrated
// afterward. Called from updateStage on the transition into 'applied'.
export function snapshotJd(jobId) {
  run(
    `UPDATE applications
     SET jd_snapshot = (SELECT description_text FROM jobs WHERE id = ?),
         jd_snapshot_at = datetime('now')
     WHERE job_id = ? AND jd_snapshot IS NULL`,
    [jobId, jobId],
  );
}

// appliedAt, when given, is an explicit local 'YYYY-MM-DD' date (the "Log
// application" modal always sends one). Without it, the first transition
// into 'applied' auto-stamps today's local date — using date('now','localtime')
// rather than an ISO UTC timestamp so it matches dateOnly()'s YYYY-MM-DD
// convention and doesn't drift a day depending on time of day/timezone.
export function updateStage(jobId, stage, { appliedAt } = {}) {
  if (!STAGES.includes(stage)) {
    throw new Error(`invalid stage: ${stage}`);
  }
  const current = ensureApplication(jobId);
  let nextAppliedAt = current.applied_at;
  if (stage === "applied" && !current.applied_at) {
    nextAppliedAt = appliedAt || get(`SELECT date('now','localtime') AS d`).d;
  } else if (appliedAt) {
    nextAppliedAt = appliedAt;
  }
  run(
    `UPDATE applications SET stage = ?, applied_at = ?, stage_changed_at = datetime('now'), updated_at = datetime('now') WHERE job_id = ?`,
    [stage, nextAppliedAt, jobId],
  );
  run(`INSERT INTO application_events (job_id, from_stage, to_stage) VALUES (?, ?, ?)`, [jobId, current.stage, stage]);
  if (stage === "applied") snapshotJd(jobId);
  return getApplication(jobId);
}

export function updateNotes(jobId, notes) {
  ensureApplication(jobId);
  run(`UPDATE applications SET notes = ?, updated_at = datetime('now') WHERE job_id = ?`, [notes, jobId]);
  return getApplication(jobId);
}

export function setAppliedAt(jobId, appliedAt) {
  ensureApplication(jobId);
  run(`UPDATE applications SET applied_at = ?, updated_at = datetime('now') WHERE job_id = ?`, [appliedAt, jobId]);
  return getApplication(jobId);
}

const MUTABLE_FIELDS = [
  "notes", "applied_at", "applied_via", "applied_url", "referral_name",
  "salary_expectation", "next_action", "next_action_at",
  "contact_name", "contact_email", "contact_linkedin", "archived_at", "sent_resume_document_id",
];

/** Marks the résumé version that was sent (null clears it). The document
 *  must be one of this job's résumés. */
export function setSentResume(jobId, documentId) {
  ensureApplication(jobId);
  if (documentId != null) {
    const doc = get(`SELECT id FROM documents WHERE id = ? AND job_id = ? AND kind = 'resume'`, [documentId, jobId]);
    if (!doc) throw new Error("that document is not a résumé of this job");
  }
  run(`UPDATE applications SET sent_resume_document_id = ?, updated_at = datetime('now') WHERE job_id = ?`, [documentId ?? null, jobId]);
  return getApplication(jobId);
}

// Whitelist-driven dynamic UPDATE for the "details" fields — mirrors
// updateJobMutableFields in server/db/repo/jobs.js. `fields` uses camelCase
// keys (applied_via etc. mapped from appliedVia by the route); unknown keys
// are ignored rather than throwing, so callers can pass a partial patch
// straight from a zod-validated body.
export function updateFields(jobId, fields) {
  ensureApplication(jobId);
  const sets = [];
  const params = [];
  for (const key of MUTABLE_FIELDS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    params.push(fields[key]);
  }
  if (sets.length === 0) return getApplication(jobId);
  sets.push(`updated_at = datetime('now')`);
  params.push(jobId);
  run(`UPDATE applications SET ${sets.join(", ")} WHERE job_id = ?`, params);
  return getApplication(jobId);
}

// The single call behind the "Log application" modal: moves the job to
// 'applied' (snapshotting the JD) and, in the same transaction, applies
// the rest of the details fields the modal collected. Attachments are
// inserted by the route after this returns (file fingerprinting happens
// outside the transaction so a slow/failing stat never holds a DB lock).
export function logApplication(jobId, { appliedAt, ...details } = {}) {
  return transaction(() => {
    updateStage(jobId, "applied", { appliedAt });
    return updateFields(jobId, details);
  });
}

export function listEvents(jobId) {
  return all(`SELECT * FROM application_events WHERE job_id = ? ORDER BY at DESC`, [jobId]);
}

// Applications-view listing: deliberately its own query rather than widening
// listJobs() in server/db/repo/jobs.js, since the Jobs table's needs (fit,
// doc versions, fit-queue status) and the Applications view's needs
// (attachment counts, applied-via, next action) diverge. jd_snapshot is
// intentionally excluded from the column list — it can run tens of KB and
// nothing in a list view needs it (GET /jobs/:id returns it separately).
export function listApplications({
  stage, q, includeArchived = false, includeNew = false, sort = "applied",
} = {}) {
  const where = [];
  const params = [];
  if (!includeArchived) where.push(`a.archived_at IS NULL`);
  if (!includeNew) where.push(`a.stage != 'new'`);
  // Briefs (Résumés tab) are hidden jobs that exist only to hold a
  // generated résumé; they are never applications.
  where.push(`j.source != 'brief'`);
  if (stage?.length) {
    where.push(`a.stage IN (${stage.map(() => "?").join(",")})`);
    params.push(...stage);
  }
  if (q) {
    where.push(`(j.title LIKE ? OR j.company LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }

  const orderBy = sort === "company"
    ? `j.company ASC`
    : sort === "next_action"
      ? `(a.next_action_at IS NULL) ASC, a.next_action_at ASC`
      : `(a.applied_at IS NULL) ASC, a.applied_at DESC`;

  const rows = all(
    `
    SELECT
      j.id AS job_id, j.title, j.company, j.url, j.apply_url, j.source, j.posted_at,
      j.location_raw, j.work_mode,
      a.stage, a.notes, a.applied_at, a.applied_via, a.applied_url, a.referral_name,
      a.jd_snapshot_at, a.salary_expectation, a.next_action, a.next_action_at,
      a.contact_name, a.contact_email, a.contact_linkedin, a.archived_at,
      a.stage_changed_at, a.updated_at,
      (SELECT COUNT(*) FROM attachments att WHERE att.job_id = j.id) AS attachment_count,
      (SELECT COUNT(*) FROM attachments att WHERE att.job_id = j.id AND att.kind = 'resume') AS resume_attachments,
      (SELECT COUNT(*) FROM attachments att WHERE att.job_id = j.id AND att.kind = 'cover_letter') AS cover_letter_attachments,
      -- Generated documents, as distinct from attached files: this is what
      -- answers "has this application got a tailored résumé yet?", which is
      -- the question the pipeline board is actually for.
      (SELECT COUNT(*) FROM documents d WHERE d.job_id = j.id AND d.kind = 'resume') AS resume_docs,
      (SELECT COUNT(*) FROM documents d WHERE d.job_id = j.id AND d.kind = 'cover_letter') AS cover_letter_docs,
      latest_fit.score AS fit_score, latest_fit.verdict AS fit_verdict
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    LEFT JOIN (
      SELECT fa.job_id, fa.score, fa.verdict
      FROM fit_analyses fa
      INNER JOIN (SELECT job_id, MAX(id) AS max_id FROM fit_analyses GROUP BY job_id) latest2
        ON latest2.job_id = fa.job_id AND latest2.max_id = fa.id
    ) latest_fit ON latest_fit.job_id = j.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderBy}
    `,
    params,
  );

  return rows.map((r) => ({
    jobId: r.job_id,
    title: r.title,
    company: r.company,
    url: r.url,
    applyUrl: r.apply_url,
    source: r.source,
    postedAt: r.posted_at,
    locationRaw: r.location_raw,
    workMode: r.work_mode,
    stage: r.stage,
    notes: r.notes,
    appliedAt: r.applied_at,
    appliedVia: r.applied_via,
    appliedUrl: r.applied_url,
    referralName: r.referral_name,
    jdSnapshotAt: r.jd_snapshot_at,
    salaryExpectation: r.salary_expectation,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactLinkedin: r.contact_linkedin,
    archivedAt: r.archived_at,
    stageChangedAt: r.stage_changed_at,
    updatedAt: r.updated_at,
    attachmentCount: r.attachment_count,
    resumeDocs: r.resume_docs,
    coverLetterDocs: r.cover_letter_docs,
    resumeAttachments: r.resume_attachments,
    coverLetterAttachments: r.cover_letter_attachments,
    fit: r.fit_score != null ? { score: r.fit_score, verdict: r.fit_verdict } : null,
  }));
}

// Removes the application record but keeps the job. The job drops off the
// Applications tab (it is only listed there once a stage exists) and goes
// back to being an ordinary listing on the Jobs tab. Generated documents,
// fit reports and interview prep are keyed to the job, not the
// application, so they survive — deleting those is what deleteJob is for.
export function deleteApplication(jobId) {
  return transaction(() => {
    run(`DELETE FROM application_events WHERE job_id = ?`, [jobId]);
    // Attachment rows only point at files that were linked in place, so
    // dropping them never touches anything on disk.
    run(`DELETE FROM attachments WHERE job_id = ?`, [jobId]);
    run(`DELETE FROM applications WHERE job_id = ?`, [jobId]);
  });
}

export function stageCounts({ includeArchived = false } = {}) {
  const where = includeArchived ? "" : "WHERE archived_at IS NULL";
  return all(`SELECT stage, COUNT(*) AS n FROM applications ${where} GROUP BY stage`);
}
