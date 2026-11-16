// Interview rounds, their debriefs, mock-interview turns and the
// question bank. The prep generation itself stays on /jobs/:id/interview-prep.

import { Router } from "express";
import { z } from "zod";
import { getJob } from "../db/repo/jobs.js";
import { getApplication, updateStage } from "../db/repo/applications.js";
import {
  ROUND_KINDS, ROUND_STATUSES, getRound, listRoundsByJob, listAllRounds, insertRound, updateRound, setRoundDebrief, deleteRound,
} from "../db/repo/interviewRounds.js";
import { getInterviewPrep, listCurrentInterviewPreps } from "../db/repo/interviewPreps.js";
import { all } from "../db/index.js";
import { getMockTurn, listMockTurnsByJob, insertMockTurn, deleteMockTurn } from "../db/repo/mockTurns.js";
import { listBank, getBankEntry, upsertBankEntry, updateBankEntry, deleteBankEntry } from "../db/repo/questionBank.js";
import { getProfile } from "../profile/loader.js";
import { startTask } from "../tasks/start.js";

export const router = Router();

const QUESTION_KINDS = ["behavioral", "technical", "system_design", "role_specific", "culture"];

const interviewerSchema = z.object({ name: z.string().trim().min(1).max(120), title: z.string().trim().max(160).default("") });
const roundSchema = z.object({
  kind: z.enum(ROUND_KINDS),
  scheduledAt: z.string().trim().max(40).nullable().optional(),
  interviewers: z.array(interviewerSchema).max(12).default([]),
  notes: z.string().max(4000).default(""),
  focusSkills: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  focusText: z.string().max(1000).default(""),
});
// A patch carries only what changed: no defaults, or an edit to the notes
// would wipe the interviewers (zod applies a field's default even under
// .partial()).
const roundPatchSchema = z.object({
  kind: z.enum(ROUND_KINDS).optional(),
  scheduledAt: z.string().trim().max(40).nullable().optional(),
  interviewers: z.array(interviewerSchema).max(12).optional(),
  notes: z.string().max(4000).optional(),
  focusSkills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  focusText: z.string().max(1000).optional(),
  status: z.enum(ROUND_STATUSES).optional(),
});

/** Focus skills keep the inventory's spelling when they match it, and
 *  the user's when they do not (the prompt marks those as unlisted). */
function canonicalSkills(names) {
  const byName = new Map(getProfile().skills.map((s) => [s.skill.toLowerCase(), s.skill]));
  return [...new Set(names.map((n) => byName.get(n.toLowerCase()) || n))];
}

// --- The Interviews page's list -------------------------------------

// Every job with interview activity (a round, a prep or a mock answer),
// grouped, upcoming rounds first.
router.get("/interviews", (_req, res) => {
  const byJob = new Map();
  const ensure = (jobId, job) => {
    if (!byJob.has(jobId)) byJob.set(jobId, { job, rounds: [], preps: [], mockCount: 0, nextRoundAt: null, lastActivityAt: null });
    return byJob.get(jobId);
  };
  const touch = (entry, at) => { if (at && (!entry.lastActivityAt || at > entry.lastActivityAt)) entry.lastActivityAt = at; };

  for (const r of listAllRounds()) {
    const entry = ensure(r.job_id, { id: r.job_id, title: r.job_title, company: r.job_company, stage: r.job_stage || "new" });
    const { job_title, job_company, job_stage, ...round } = r;
    entry.rounds.push(round);
    touch(entry, r.updated_at);
    if (r.status === "upcoming" && r.scheduled_at && (!entry.nextRoundAt || r.scheduled_at < entry.nextRoundAt)) entry.nextRoundAt = r.scheduled_at;
  }
  const activeJobs = all(
    `SELECT j.id, j.title, j.company, a.stage, x.n AS mock_count, x.last_at FROM jobs j
     LEFT JOIN applications a ON a.job_id = j.id
     JOIN (
       SELECT job_id, 0 AS n, MAX(created_at) AS last_at FROM interview_preps GROUP BY job_id
       UNION ALL
       SELECT job_id, COUNT(*) AS n, MAX(created_at) AS last_at FROM mock_turns GROUP BY job_id
     ) x ON x.job_id = j.id`,
  );
  for (const row of activeJobs) {
    const entry = ensure(row.id, { id: row.id, title: row.title, company: row.company, stage: row.stage || "new" });
    entry.mockCount += row.mock_count || 0;
    touch(entry, row.last_at);
  }
  for (const entry of byJob.values()) {
    entry.preps = listCurrentInterviewPreps(entry.job.id).map((p) => ({ id: p.id, round_id: p.round_id, created_at: p.created_at, format: p.result_json?.format ?? null }));
  }
  const jobs = [...byJob.values()].sort((a, b) => {
    if (a.nextRoundAt && b.nextRoundAt) return a.nextRoundAt < b.nextRoundAt ? -1 : 1;
    if (a.nextRoundAt) return -1;
    if (b.nextRoundAt) return 1;
    return (b.lastActivityAt || "") < (a.lastActivityAt || "") ? -1 : 1;
  });
  res.json({ jobs });
});

// --- Rounds ---------------------------------------------------------

router.get("/jobs/:id/rounds", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json({ rounds: listRoundsByJob(job.id) });
});

router.post("/jobs/:id/rounds", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { kind, scheduledAt, interviewers, notes, focusSkills, focusText } = parsed.data;
  const round = insertRound({
    jobId: job.id, kind, scheduledAt: scheduledAt || null, interviewers, notes, focusSkills: canonicalSkills(focusSkills), focusText,
  });
  // An interview booked means the application is interviewing; a stage
  // past that (offer, rejected) is left alone.
  const app = getApplication(job.id);
  const stage = app?.stage || "new";
  if (["new", "saved", "applied"].includes(stage)) updateStage(job.id, "interviewing");
  res.json({ round, application: getApplication(job.id) });
});

router.patch("/rounds/:id", (req, res) => {
  const round = getRound(Number(req.params.id));
  if (!round) return res.status(404).json({ error: "round not found" });
  const parsed = roundPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const fields = { ...parsed.data };
  if (fields.focusSkills) fields.focusSkills = canonicalSkills(fields.focusSkills);
  if ("scheduledAt" in fields) fields.scheduledAt = fields.scheduledAt || null;
  res.json({ round: updateRound(round.id, fields) });
});

router.delete("/rounds/:id", (req, res) => {
  const round = getRound(Number(req.params.id));
  if (!round) return res.status(404).json({ error: "round not found" });
  deleteRound(round.id);
  res.json({ ok: true });
});

// The debrief closes the round and writes what was asked into the bank.
const debriefSchema = z.object({
  questions: z.array(z.object({
    question: z.string().trim().min(1).max(600),
    kind: z.enum(QUESTION_KINDS).nullable().default(null),
    went: z.enum(["good", "ok", "poor"]).nullable().default(null),
    note: z.string().max(1000).default(""),
  })).max(40).default([]),
  went: z.enum(["good", "ok", "poor"]).nullable().default(null),
  notes: z.string().max(4000).default(""),
  nextSteps: z.string().max(1000).default(""),
});

router.post("/rounds/:id/debrief", (req, res) => {
  const round = getRound(Number(req.params.id));
  if (!round) return res.status(404).json({ error: "round not found" });
  const job = getJob(round.job_id);
  const parsed = debriefSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { questions, went, notes, nextSteps } = parsed.data;
  const bank = [];
  for (const q of questions) {
    const { entry, created } = upsertBankEntry({
      question: q.question, kind: q.kind, source: "debrief", jobId: round.job_id, company: job?.company || null, roundKind: round.kind,
      notes: q.note ? `${q.went ? `Went ${q.went}. ` : ""}${q.note}` : (q.went ? `Went ${q.went}.` : ""),
    });
    bank.push({ id: entry.id, created });
  }
  const updated = setRoundDebrief(round.id, { questions, went, notes, next_steps: nextSteps, debriefed_at: new Date().toISOString() });
  res.json({ round: updated, bank });
});

// --- Mock interview turns -------------------------------------------

const turnSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  interviewPrepId: z.number().int().nullable().optional(),
  parentTurnId: z.number().int().nullable().optional(),
  questionIndex: z.number().int().nullable().optional(),
  question: z.string().trim().min(1).max(1000),
  kind: z.enum(QUESTION_KINDS).nullable().optional(),
  answer: z.string().trim().min(1).max(8000),
  via: z.enum(["voice", "typed"]),
  seconds: z.number().int().min(0).max(3600).nullable().optional(),
});

router.get("/jobs/:id/mock/turns", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json({ turns: listMockTurnsByJob(job.id) });
});

router.post("/jobs/:id/mock/turns", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  if (d.interviewPrepId) {
    const prep = getInterviewPrep(d.interviewPrepId);
    if (!prep || prep.job_id !== job.id) return res.status(400).json({ error: "that interview prep does not belong to this job" });
  }
  if (d.parentTurnId) {
    const parent = getMockTurn(d.parentTurnId);
    if (!parent || parent.job_id !== job.id) return res.status(400).json({ error: "parent turn not found" });
  }
  const turn = insertMockTurn({
    jobId: job.id, interviewPrepId: d.interviewPrepId ?? null, sessionId: d.sessionId, parentTurnId: d.parentTurnId ?? null,
    questionIndex: d.questionIndex ?? null, question: d.question, kind: d.kind ?? null, answer: d.answer, via: d.via, seconds: d.seconds ?? null,
  });
  const started = startTask({ kind: "mock_critique", jobId: job.id, payload: { turnId: turn.id }, dedupeKey: `mock_critique:${turn.id}` });
  res.json({ turn, ...started });
});

// A turn whose critique failed: queue the critique again.
router.post("/mock/turns/:id/critique", (req, res) => {
  const turn = getMockTurn(Number(req.params.id));
  if (!turn) return res.status(404).json({ error: "turn not found" });
  res.json(startTask({ kind: "mock_critique", jobId: turn.job_id, payload: { turnId: turn.id }, dedupeKey: `mock_critique:${turn.id}` }));
});

router.delete("/mock/turns/:id", (req, res) => {
  const turn = getMockTurn(Number(req.params.id));
  if (!turn) return res.status(404).json({ error: "turn not found" });
  deleteMockTurn(turn.id);
  res.json({ ok: true });
});

// Keep a practised answer: the user's own words or the critique's
// tightened version, their choice.
router.post("/mock/turns/:id/bank", (req, res) => {
  const turn = getMockTurn(Number(req.params.id));
  if (!turn) return res.status(404).json({ error: "turn not found" });
  const which = req.body?.answer === "tightened" ? "tightened" : "mine";
  const text = which === "tightened" ? turn.critique?.tightened : turn.answer;
  if (!text) return res.status(400).json({ error: "no tightened answer on this turn yet" });
  const job = getJob(turn.job_id);
  const prep = turn.interview_prep_id ? getInterviewPrep(turn.interview_prep_id) : null;
  const card = (prep?.result_json?.questions || []).find((q) => q.question === turn.question) || null;
  const { entry, created } = upsertBankEntry({
    question: turn.question, kind: turn.kind || card?.kind || null, source: "mock", jobId: turn.job_id, company: job?.company || null,
    roundKind: prep?.result_json?.round_kind || null, storyIds: card?.story_ids || [], myAnswer: text,
  });
  // A second save on the same question replaces the answer: the newer
  // practice is the better one by the user's choice.
  const final = created ? entry : updateBankEntry(entry.id, { myAnswer: text });
  res.json({ entry: final, created });
});

// --- Question bank --------------------------------------------------

router.get("/question-bank", (req, res) => {
  const { kind, company, source } = req.query;
  res.json({ entries: listBank({ kind: kind || undefined, company: company || undefined, source: source || undefined }) });
});

const bankCreateSchema = z.object({
  question: z.string().trim().min(1).max(600),
  kind: z.enum(QUESTION_KINDS).nullable().default(null),
  company: z.string().trim().max(120).nullable().default(null),
  roundKind: z.enum(ROUND_KINDS).nullable().default(null),
  myAnswer: z.string().max(8000).default(""),
  notes: z.string().max(2000).default(""),
  storyIds: z.array(z.string()).max(10).default([]),
});
router.post("/question-bank", (req, res) => {
  const parsed = bankCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const { entry, created } = upsertBankEntry({ ...d, source: "manual" });
  res.json({ entry, created });
});

const bankPatchSchema = z.object({
  question: z.string().trim().min(1).max(600).optional(),
  kind: z.enum(QUESTION_KINDS).nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  roundKind: z.enum(ROUND_KINDS).nullable().optional(),
  myAnswer: z.string().max(8000).optional(),
  notes: z.string().max(2000).optional(),
  storyIds: z.array(z.string()).max(10).optional(),
});
router.patch("/question-bank/:id", (req, res) => {
  const entry = getBankEntry(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "entry not found" });
  const parsed = bankPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  res.json({ entry: updateBankEntry(entry.id, parsed.data) });
});

router.delete("/question-bank/:id", (req, res) => {
  const entry = getBankEntry(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "entry not found" });
  deleteBankEntry(entry.id);
  res.json({ ok: true });
});

