import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  listJobs, getJob, getJobByUrl, setJobHidden, deleteJob, insertJob, updateJobMutableFields,
} from "../db/repo/jobs.js";
import { toJob, dedupeKey, inferCountry } from "../sources/normalize.js";
import { fetchPage } from "../sources/extract.js";
import { getApplication, listEvents } from "../db/repo/applications.js";
import { latestFitForJob, allFitForJob } from "../db/repo/fitAnalyses.js";
import { listDocumentsByJob, latestDocument, sentResume } from "../db/repo/documents.js";
import { listAttachmentsByJob } from "../db/repo/attachments.js";
import { latestInterviewPrepForJob, listCurrentInterviewPreps, getInterviewPrep } from "../db/repo/interviewPreps.js";
import { listRoundsByJob, getRound } from "../db/repo/interviewRounds.js";
import { listMockTurnsByJob } from "../db/repo/mockTurns.js";
import { latestPeopleSearchForJob } from "../db/repo/peopleSearches.js";
import { listOutreachByJob } from "../db/repo/outreach.js";
import { getProfile } from "../profile/loader.js";
import { emailSignature } from "../profile/render.js";
import { buildStoryMap } from "../ai/storyMap.js";
import { listTasksByJob } from "../db/repo/tasks.js";
import { PRIORITY, isActive } from "../../shared/tasks.js";
import { startTask } from "../tasks/start.js";
import { cancelByJob } from "../tasks/worker.js";
export const router = Router();

router.get("/jobs", (req, res) => {
  const q = req.query.q || undefined;
  const asArray = (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
  const stage = asArray(req.query.stage);
  const verdict = asArray(req.query.verdict);
  const workMode = asArray(req.query.workMode);
  const country = asArray(req.query.country);
  const source = asArray(req.query.source);
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const minFit = req.query.minFit ? Number(req.query.minFit) : undefined;
  const sort = req.query.sort || "posted";
  const includeHidden = req.query.includeHidden === "true";

  const rows = listJobs({ q, stage, minFit, verdict, workMode, country, source, tag, sort, includeHidden });
  res.json(rows);
});

router.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const application = getApplication(job.id);
  const jdChanged = !!(application?.jd_snapshot && job.description_text !== application.jd_snapshot);
  const sent = sentResume(job.id);
  res.json({
    job,
    application,
    jdChanged,
    events: listEvents(job.id),
    fit: allFitForJob(job.id),
    documents: listDocumentsByJob(job.id),
    attachments: listAttachmentsByJob(job.id),
    interviewPrep: latestInterviewPrepForJob(job.id),
    // The newest prep per round plus the general one, the rounds
    // themselves and the mock answers so far: the Interview tab's state.
    interviewPreps: listCurrentInterviewPreps(job.id),
    rounds: listRoundsByJob(job.id),
    mockTurns: listMockTurnsByJob(job.id),
    // Which stories answer each posting item, straight from the newest
    // résumé's plan: the Interview tab shows it before any prep runs.
    storyMap: buildStoryMap(sent.document, job.jd_analysis, getProfile()),
    // The résumé the interviewer has read: marked as sent, else the newest.
    sentResume: sent.document ? { documentId: sent.document.id, version: sent.document.version, explicit: sent.explicit } : null,
    people: latestPeopleSearchForJob(job.id),
    outreach: listOutreachByJob(job.id),
    // Built here, not in the browser: getProfile() is mtime-cached, so an
    // edit to facts.md shows on the next drawer load.
    signature: emailSignature(getProfile()),
    tasks: listTasksByJob(job.id),
  });
});

// Ingestion runs as a background task: the page fetch plus one model
// call can take a minute, and the client watches the task rather than
// holding the request open.
const fromLinkSchema = z.object({ url: z.string().url() });
router.post("/jobs/from-link", (req, res) => {
  const parsed = fromLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const url = parsed.data.url.trim();
  res.json(startTask({ kind: "add_job_link", payload: { url }, dedupeKey: `add_job_link:${url}` }));
});

const manualJobSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  descriptionText: z.string().default(""),
  url: z.string().optional(),
  location: z.string().optional(),
});
router.post("/jobs/manual", (req, res) => {
  const parsed = manualJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { title, company, descriptionText, url, location } = parsed.data;
  const job = toJob({
    source: "manual",
    url: url || `manual:${randomUUID()}`,
    title,
    company,
    location_raw: location || null,
    description_text: descriptionText,
  });
  const saved = insertJob(job);
  res.json({ job: saved });
});

// Replacing the description also drops the cached JD analysis: the tailor
// and interview-prep pipelines reuse jd_analysis whenever it is present,
// so leaving it would run the next generation against the old text.
function replaceDescription(jobId, text) {
  return updateJobMutableFields(jobId, {
    description_text: text,
    description_truncated: 0,
    jd_analysis: null,
    jd_analysis_at: null,
  });
}

router.patch("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (typeof req.body.hidden === "boolean") {
    return res.json(setJobHidden(req.params.id, req.body.hidden));
  }
  // Pasted job description, for postings the fetcher cannot read.
  if (typeof req.body.descriptionText === "string") {
    const text = req.body.descriptionText.trim();
    if (!text) return res.status(400).json({ error: "description text is empty" });
    return res.json({ job: replaceDescription(job.id, text) });
  }
  if (req.body.details && typeof req.body.details === "object") {
    const parsed = detailsSchema.safeParse(req.body.details);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const result = editDetails(job, parsed.data);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ job: result.job });
  }
  res.json(job);
});

// The fields the drawer's "Edit details" form can change. Re-imports
// never overwrite these (mergeMutableFields only fills blanks), so an
// edit sticks without a lock.
const optionalText = z.string().trim().nullable().optional();
const detailsSchema = z.object({
  url: z.string().trim().min(1).optional(),
  apply_url: optionalText,
  title: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  location_raw: optionalText,
  work_mode: z.enum(["remote", "hybrid", "onsite", "unknown"]).optional(),
  salary_text: optionalText,
}).strict();

const WEB_URL = /^https?:\/\/\S+$/i;

function editDetails(job, d) {
  const fields = {};
  if (d.title !== undefined) fields.title = d.title;
  if (d.company !== undefined) fields.company = d.company;
  if (fields.title !== undefined || fields.company !== undefined) {
    fields.dedupe_key = dedupeKey(fields.company ?? job.company, fields.title ?? job.title);
  }
  if (d.location_raw !== undefined) {
    fields.location_raw = d.location_raw || null;
    fields.country = inferCountry(fields.location_raw) ?? job.country;
  }
  if (d.work_mode !== undefined) fields.work_mode = d.work_mode;
  if (d.salary_text !== undefined && (d.salary_text || null) !== job.salary_text) {
    // The parsed range came from the old text; a re-import can fill it again.
    fields.salary_text = d.salary_text || null;
    fields.salary_min = null;
    fields.salary_max = null;
    fields.currency = null;
  }
  if (d.apply_url !== undefined) {
    if (d.apply_url && !WEB_URL.test(d.apply_url)) return { status: 400, error: "Apply URL must start with http:// or https://" };
    fields.apply_url = d.apply_url || null;
  }
  if (d.url !== undefined && d.url !== job.url) {
    if (!WEB_URL.test(d.url)) return { status: 400, error: "Posting URL must start with http:// or https://" };
    const other = getJobByUrl(d.url);
    if (other && other.id !== job.id) {
      return { status: 409, error: `Another job already uses that URL: ${other.title} at ${other.company}` };
    }
    fields.url = d.url;
    // An apply link that was only a copy of the posting link follows it.
    if (d.apply_url === undefined && (!job.apply_url || job.apply_url === job.url)) fields.apply_url = d.url;
    // The old link stays on the job as a place it was seen, so a source
    // that lists it again merges into this row instead of adding a twin.
    // A manual job's placeholder (manual:<uuid>) is not a real link.
    const seen = (job.also_seen_on || []).filter((s) => s.url !== d.url);
    if (!job.url.startsWith("manual:") && !seen.some((s) => s.url === job.url)) {
      seen.push({ source: job.source, url: job.url });
    }
    fields.also_seen_on = seen;
  }
  if (Object.keys(fields).length === 0) return { job };
  return { job: updateJobMutableFields(job.id, fields) };
}

router.delete("/jobs/:id", (req, res) => {
  // Stop any generation still running for it, or a `claude` process
  // would keep going and try to write documents for a row that is gone.
  cancelByJob(req.params.id);
  deleteJob(req.params.id);
  res.json({ ok: true });
});

// Re-fetches the posting and replaces the (possibly truncated) description
// with a fresh Readability extraction. No AI call — this was previously
// called by the client (JobOverview's "Fetch full description" button) but
// had no matching route, so it always 404'd.
router.post("/jobs/:id/hydrate", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  try {
    const { text } = await fetchPage(job.url);
    if (!text) return res.status(502).json({ error: "could not extract a description from this URL" });
    res.json({ job: replaceDescription(job.id, text) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Every generation below queues a background task and answers at once
// with { taskId, jobId, task, existing }. The worker in server/tasks runs
// it; the client follows progress through GET /api/tasks.

// `queue: true` is what bulk callers pass: it drops the scoring to
// background priority so it never delays work the user is waiting on.
router.post("/jobs/:id/fit", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const priority = req.body?.queue ? PRIORITY.background : PRIORITY.user;
  res.json(startTask({ kind: "fit", jobId: job.id, priority }));
});

// The prep for one round (body.roundId) or the job's general prep.
router.post("/jobs/:id/interview-prep", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const roundId = req.body?.roundId ? Number(req.body.roundId) : null;
  if (roundId) {
    const round = getRound(roundId);
    if (!round || round.job_id !== job.id) return res.status(400).json({ error: "that interview round does not belong to this job" });
  }
  // A full run replaces the row a question rewrite is about to patch.
  if (listTasksByJob(job.id, 20).some((t) => t.kind === "interview_prep_question" && isActive(t))) {
    return res.status(409).json({ error: "A question is still being rewritten; wait for it to finish first." });
  }
  res.json(startTask({
    kind: "interview_prep",
    jobId: job.id,
    payload: { roundId },
    dedupeKey: `interview_prep:${job.id}:${roundId || "general"}`,
  }));
});

// One question card of a prep (body.interviewPrepId, else the job's
// latest), rewritten in place.
router.post("/jobs/:id/interview-prep/questions/:index/regenerate", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const prep = req.body?.interviewPrepId ? getInterviewPrep(Number(req.body.interviewPrepId)) : latestInterviewPrepForJob(job.id);
  if (!prep || prep.job_id !== job.id) return res.status(404).json({ error: "This job has no interview prep yet." });
  const index = Number(req.params.index);
  const count = prep.result_json?.questions?.length || 0;
  if (!Number.isInteger(index) || index < 0 || index >= count) return res.status(400).json({ error: `question index must be 0-${count - 1}` });
  if (listTasksByJob(job.id, 20).some((t) => t.kind === "interview_prep" && isActive(t))) {
    return res.status(409).json({ error: "Interview prep is being regenerated; wait for it to finish first." });
  }
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : "";
  res.json(startTask({
    kind: "interview_prep_question",
    jobId: job.id,
    payload: { interviewPrepId: prep.id, index, note },
    dedupeKey: `interview_prep_question:${prep.id}:${index}`,
  }));
});

const peopleBodySchema = z.object({
  hints: z.string().max(2000).optional(),
  // Default: build on the job's latest search. false starts over.
  buildOn: z.boolean().optional(),
});

router.post("/jobs/:id/people", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = peopleBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { hints = "", buildOn = true } = parsed.data;
  res.json(startTask({ kind: "people", jobId: job.id, payload: { hints, buildOn } }));
});

// A new cover letter version written from the job's newest résumé. Not
// while that résumé is being replaced or revised: both of those write a
// letter of their own when they finish.
router.post("/jobs/:id/cover-letter", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (!latestDocument(job.id, "resume")) return res.status(400).json({ error: "This job has no résumé yet; run Prepare application first." });
  const busy = listTasksByJob(job.id, 20).find((t) => ["prepare_application", "revise_resume"].includes(t.kind) && isActive(t));
  if (busy) return res.status(409).json({ error: `${busy.kind === "revise_resume" ? "A résumé revision" : "Prepare application"} is still running for this job; it writes a new cover letter when it finishes.` });
  res.json(startTask({ kind: "cover_letter", jobId: job.id }));
});

router.post("/jobs/:id/prepare", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  // Mirror of the guard on /documents/:id/revise: two new résumé versions
  // must not land interleaved.
  if (listTasksByJob(job.id, 20).some((t) => t.kind === "revise_resume" && isActive(t))) {
    return res.status(409).json({ error: "A résumé revision is still running for this job; wait for it to finish first." });
  }
  const payload = {
    coverLetter: req.body?.coverLetter !== false,
    fit: req.body?.fit !== false,
  };
  res.json(startTask({ kind: "prepare_application", jobId: job.id, payload }));
});
