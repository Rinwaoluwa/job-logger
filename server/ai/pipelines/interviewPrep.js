import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { interviewPrepSchema, interviewQuestionSchema } from "../schemas.js";
import { interviewPrepPrompt, interviewQuestionPrompt } from "../prompts/interviewPrep.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { profileFull, allStoryIds } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { getJob } from "../../db/repo/jobs.js";
import { latestFitForJob } from "../../db/repo/fitAnalyses.js";
import { sentResume } from "../../db/repo/documents.js";
import { insertInterviewPrep, getInterviewPrep, updateInterviewPrepResult } from "../../db/repo/interviewPreps.js";
import { getRound } from "../../db/repo/interviewRounds.js";
import { listBank } from "../../db/repo/questionBank.js";
import { resolveJdAndSelection } from "./shared.js";
import { resumeContext } from "../resumeContext.js";
import { buildStoryMap } from "../storyMap.js";

/** The prep's own format version, stored beside the model output so the
 *  UI can tell an old row from a full one. 2 added the story map and
 *  pitch; 3 the round, watch-outs, study list and top stories. */
export const INTERVIEW_PREP_FORMAT = 3;

// How many bank entries a prompt carries. The bank is cross-job and
// grows; the newest and the ones with a written answer matter most.
const BANK_LIMIT = 40;

/** The round's focus skill names resolved to their inventory rows, so
 *  the prompt sees proficiency and where each was used. Names the
 *  inventory does not have are kept as bare entries rather than dropped:
 *  the user typed them on purpose. */
export function resolveFocusSkills(profile, names = []) {
  const byName = new Map(profile.skills.map((s) => [s.skill.toLowerCase(), s]));
  return names.map((n) => byName.get(String(n).toLowerCase()) || { skill: String(n), proficiency: "unlisted", usedIn: [], notes: "not in the skills inventory" });
}

/** The question-bank slice for a round: the kinds this round asks first,
 *  then anything with a written answer, newest first. */
function bankForRound(round) {
  const rows = listBank({ limit: 500 });
  if (!rows.length) return [];
  const prefer = round ? KIND_PREFERENCE[round.kind] || null : null;
  const score = (b) => (b.my_answer ? 2 : 0) + (prefer && b.kind && prefer.includes(b.kind) ? 1 : 0) + (round && b.round_kind === round.kind ? 1 : 0);
  return rows
    .map((b, i) => ({ b, s: score(b), i }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .slice(0, BANK_LIMIT)
    .map((x) => x.b);
}
const KIND_PREFERENCE = {
  recruiter_screen: ["culture", "role_specific"],
  hiring_manager: ["behavioral", "role_specific"],
  technical: ["technical", "system_design"],
  panel: ["behavioral", "technical", "system_design", "role_specific", "culture"],
  coding: ["technical"],
  other: null,
};

function prepContext(jobId, roundId = null) {
  const job = getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  const profile = getProfile();
  const profileFullText = profileFull(profile);
  const whyLookingText = profile.facts.whyLooking && !profile.facts.whyLooking.includes("<ask") ? profile.facts.whyLooking : "";
  // The résumé he sent, as it exports: the interviewer has read it, so
  // the prep must agree with it (see RESUME_RULES_FOR_PREP for how its
  // invented gap fills are handled).
  const sent = sentResume(jobId);
  const resumeRow = sent.document;
  const resume = resumeRow ? resumeContext(resumeRow) : null;
  const round = roundId ? getRound(roundId) : null;
  if (roundId && (!round || round.job_id !== jobId)) throw new Error(`interview round not found: ${roundId}`);
  const focusSkills = round ? resolveFocusSkills(profile, round.focus_skills) : [];
  const bank = bankForRound(round);
  return { job, profile, profileFullText, whyLookingText, resumeRow, resume, resumeSentExplicit: sent.explicit, round, focusSkills, bank };
}

/** Drops story ids the profile does not have (the model occasionally
 *  invents or misspells one) so the UI never links to nothing. */
function scrubStoryIds(data, profile) {
  const known = allStoryIds(profile);
  const dropped = new Set();
  const keep = (id) => {
    const ok = known.has(String(id || "").toLowerCase());
    if (!ok && id) dropped.add(id);
    return ok;
  };
  const one = (id) => (id && keep(id) ? String(id).toLowerCase() : null);
  const many = (ids) => (ids || []).filter(keep).map((id) => String(id).toLowerCase());

  for (const q of data.questions || []) q.story_ids = many(q.story_ids);
  for (const item of data.story_map || []) item.stories = (item.stories || []).filter((s) => keep(s.story_id)).map((s) => ({ ...s, story_id: s.story_id.toLowerCase() }));
  for (const p of Object.values(data.pitch || {})) if (p) p.story_ids = many(p.story_ids);
  for (const g of data.gap_defenses || []) g.bridge_story_id = one(g.bridge_story_id);
  for (const c of data.resume_claims || []) c.nearest_real_story_id = one(c.nearest_real_story_id);
  if (data.top_stories) data.top_stories = data.top_stories.filter((t) => keep(t.story_id)).map((t) => ({ ...t, story_id: t.story_id.toLowerCase() }));
  if (dropped.size) console.warn(`[interview_prep] dropped unknown story ids: ${[...dropped].join(", ")}`);
  return data;
}

/**
 * @param {string} jobId
 * @param {{ roundId?: number|null }} [opts] - the round to prepare for; none = the job's general prep
 */
export async function runInterviewPrep(jobId, { roundId = null } = {}) {
  const { job, profile, profileFullText, whyLookingText, resumeRow, resume, resumeSentExplicit, round, focusSkills, bank } = prepContext(jobId, roundId);

  let totalCost = 0;
  let jdAnalysis = job.jd_analysis;
  if (!jdAnalysis) {
    const resolved = await resolveJdAndSelection({ jdText: job.description_text, profile, profileFullText, jobId });
    jdAnalysis = resolved.jdAnalysis;
    totalCost += resolved.costUsd || 0;
  }

  const fit = latestFitForJob(jobId);
  const startingMap = buildStoryMap(resumeRow, jdAnalysis, profile);
  if (bank.length) console.log(`[interview_prep] ${jobId}: ${bank.length} question-bank entries in the prompt`);

  const { data, costUsd } = await runClaude({
    purpose: `interview_prep:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: interviewPrepPrompt({
      jobTitle: job.title,
      jobCompany: job.company,
      jdAnalysis,
      fit: fit?.result_json,
      profileFullText,
      whyLookingText,
      resume,
      startingMap,
      round,
      focusSkills,
      bank,
    }),
    schema: interviewPrepSchema,
    effort: "medium",
    model: config.claude.model,
    // The output is roughly three times the old questions-only prep.
    timeoutMs: 360_000,
    jobId,
  });
  totalCost += costUsd || 0;

  scrubStoryIds(data, profile);
  if (resume && data.resume_claims.length !== resume.gapFills.length) {
    console.warn(`[interview_prep] ${jobId}: ${resume.gapFills.length} résumé gap fills but ${data.resume_claims.length} resume_claims entries`);
  }

  const record = insertInterviewPrep({
    jobId,
    roundId: round?.id ?? null,
    resultJson: {
      ...data,
      format: INTERVIEW_PREP_FORMAT,
      resume_document_id: resume?.documentId ?? null,
      resume_version: resume?.version ?? null,
      // Whether that version was the one marked as sent, or just the newest at the time.
      resume_sent_explicit: resume ? resumeSentExplicit : null,
      round_id: round?.id ?? null,
      round_kind: round?.kind ?? null,
      // What the round said when this ran, so the UI can tell a prep
      // that predates an edit to the focus or the notes.
      round_updated_at: round?.updated_at ?? null,
      focus: round ? { skills: round.focus_skills, text: round.focus_text } : null,
      bank_entries: bank.length,
    },
    costUsd: totalCost,
  });
  return record;
}

/**
 * Rewrites one question card of an existing prep in place; the rest of
 * the prep is untouched.
 * @returns {{ record: object, costUsd: number }}
 */
export async function regenerateInterviewQuestion({ jobId, interviewPrepId, index, note = "" }) {
  const prep = getInterviewPrep(interviewPrepId);
  if (!prep || prep.job_id !== jobId) throw new Error("interview prep not found");
  const { job, profile, profileFullText, resume, round, focusSkills, bank } = prepContext(jobId, prep.round_id || null);
  const questions = prep.result_json?.questions || [];
  if (!Number.isInteger(index) || index < 0 || index >= questions.length) throw new Error(`no question at index ${index}`);

  const { data, costUsd } = await runClaude({
    purpose: `interview_prep_question:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: interviewQuestionPrompt({
      jobTitle: job.title,
      jobCompany: job.company,
      jdAnalysis: job.jd_analysis,
      existing: questions[index],
      otherQuestions: questions.filter((_, i) => i !== index).map((q) => q.question),
      note: String(note || "").trim(),
      profileFullText,
      resume,
      round,
      focusSkills,
      bank,
    }),
    schema: interviewQuestionSchema,
    effort: "low",
    model: config.claude.model,
    jobId,
  });

  scrubStoryIds({ questions: [data] }, profile);

  // Re-read before writing: another card may have been rewritten while
  // this one ran.
  const fresh = getInterviewPrep(interviewPrepId);
  const next = [...(fresh.result_json.questions || [])];
  next[index] = data;
  const record = updateInterviewPrepResult(interviewPrepId, { ...fresh.result_json, questions: next });
  return { record, costUsd: costUsd || 0 };
}
