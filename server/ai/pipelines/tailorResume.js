import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { resumeTailorSchema } from "../schemas.js";
import { resumeWritePrompt } from "../prompts/resumeWrite.js";
import { resumeWriterSystemPrompt } from "../prompts/system.js";
import { profileFull, verifiedMetricsText, skillsTableText, glossaryText, proposedWorkText } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { setJobJdAnalysis, getJob } from "../../db/repo/jobs.js";
import { saveDocument } from "../../db/repo/documents.js";
import { NOOP_CTX } from "../../tasks/ctx.js";
import { analyseJd, analyseRoleBrief, selectStories, buildGenericSelection, genericJdAnalysis, latestRoleId as findLatestRoleId } from "./shared.js";
import { finishResume, withoutStackAdditions } from "./finishResume.js";

/** Stage names a tailor run reports, in order. Routes declare these up
 * front so the progress view can list them before they start. */
export const TAILOR_STAGES = [
  "jd_analysis", "story_selection", "resume_write", "verify_lint", "page_fit",
  ...(config.resume.reviewer.enabled ? ["resume_review"] : []),
  "resume_rewrite",
];

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.jdText - may be "" for a generic (untailored) résumé
 * @param {object} [opts.brief] - a role brief ({ title, skills, company,
 *   notes }) in place of a posting: the analysis is inferred from the
 *   title and skills (shared/briefs.js) rather than read from jdText
 * @param {object} [opts.ctx] - task context (server/tasks/ctx.js) stage
 *   progress and cancellation are reported through; NOOP_CTX by default
 */
export async function tailorResume({ jobId, jdText, brief = null, ctx = NOOP_CTX }) {
  const profile = getProfile();
  // No spoken story versions: the résumé is composed fresh in a clean
  // professional register, not in the candidate's conversational voice.
  const profileFullText = profileFull(profile, { interviewVersions: false });
  const metricsText = verifiedMetricsText(profile);
  const skillsText = skillsTableText(profile);
  const latestRoleId = findLatestRoleId(profile);

  let totalCost = 0;
  const track = (c) => { totalCost += c || 0; };

  const cachedJob = jdText && jdText.trim() ? getJob(jobId) : null;
  let jdAnalysis;
  if (cachedJob?.jd_analysis) {
    jdAnalysis = cachedJob.jd_analysis;
  } else if (jdText && jdText.trim()) {
    ctx.beginStage("jd_analysis");
    try {
      const { data, costUsd } = brief ? await analyseRoleBrief(brief, jobId) : await analyseJd(jdText, jobId);
      jdAnalysis = data;
      track(costUsd);
      setJobJdAnalysis(jobId, jdAnalysis);
      ctx.finishStage("jd_analysis", { costUsd });
    } catch (e) {
      ctx.failStage("jd_analysis", e);
      throw e;
    }
  } else {
    jdAnalysis = genericJdAnalysis(profile);
  }

  let selection;
  if (jdText && jdText.trim()) {
    ctx.beginStage("story_selection");
    try {
      const { data, costUsd } = await selectStories(jdAnalysis, [profileFullText, glossaryText(profile), proposedWorkText(profile)].filter(Boolean).join("\n\n"), jobId, { latestRoleId, profile });
      selection = data;
      track(costUsd);
      ctx.finishStage("story_selection", { costUsd });
    } catch (e) {
      ctx.failStage("story_selection", e);
      throw e;
    }
  } else {
    selection = buildGenericSelection(profile);
  }

  // Plan limits (the target count on every role, the gap-fill caps) are
  // applied in selectStories/normalizePlan and buildGenericSelection.

  ctx.beginStage("resume_write");
  let draft;
  try {
    const { data, costUsd } = await runClaude({
      purpose: `resume_write:${jobId}`,
      // Identical to the rewrite passes' system prompt, so they read it from the cache.
      system: resumeWriterSystemPrompt({ profileFullText, verifiedMetricsText: metricsText, skillsTableText: skillsText }),
      prompt: resumeWritePrompt({ jdAnalysis, selection, latestRoleId }),
      schema: resumeTailorSchema,
      effort: config.claude.effortWrite,
      model: config.claude.modelWrite,
      // At medium effort the draft has run 88-186s; high effort reasons
      // longer, and a schema retry runs the call twice, so give it room.
      timeoutMs: 480_000,
      jobId,
    });
    draft = withoutStackAdditions(data);
    track(costUsd);
    ctx.finishStage("resume_write", { costUsd });
  } catch (e) {
    ctx.failStage("resume_write", e);
    throw e;
  }

  const finished = await finishResume({ draft, profile, jdAnalysis, selection, jobId, ctx });
  draft = finished.draft;
  track(finished.costUsd);

  // The plan rides on the document so a later revision can measure the
  // revised draft against the same roles, ordering and coverage targets.
  draft.plan = selection;

  const document = saveDocument({
    jobId,
    kind: "resume",
    title: jdAnalysis.company ? `Résumé — ${jdAnalysis.company}` : "Résumé",
    contentJson: draft,
    costUsd: totalCost,
    model: config.claude.modelWrite,
  });

  return { document, jdAnalysis, selection, costUsd: totalCost };
}
