import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { coverLetterSchema } from "../schemas.js";
import { coverLetterPrompt } from "../prompts/coverLetter.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { lintCoverLetter } from "../lint.js";
import { profileFull } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { saveDocument, latestDocument } from "../../db/repo/documents.js";
import { resolveJdAndSelection } from "./shared.js";
import { resumeContext } from "../resumeContext.js";
import { NOOP_CTX } from "../../tasks/ctx.js";

/** Stage names a cover letter reports when it follows a tailor run (the
 * JD analysis and story selection are reused from it). */
export const COVER_LETTER_STAGES = ["cover_letter"];
/** ...and when it runs on its own and has to build that context first. */
export const COVER_LETTER_STANDALONE_STAGES = ["cover_letter_context", "cover_letter"];

async function writeOnce({ jdText, jdAnalysis, selection, profileFullText, whyLookingText, resume, jobId }) {
  return runClaude({
    purpose: `cover_letter:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: coverLetterPrompt({ jdText, jdAnalysis, selection, profileFullText, whyLookingText, resume }),
    schema: coverLetterSchema,
    effort: "medium",
    model: config.claude.modelWrite,
    timeoutMs: 240_000,
    jobId,
  });
}

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.jdText
 * @param {object} [opts.jdAnalysis] - reuse from a prior tailorResume call if available
 * @param {object} [opts.selection]
 * @param {object} [opts.resumeDocument] - the résumé row this letter goes out
 *   with; defaults to the job's newest résumé. The letter is written from
 *   it (as it exports), not just from the plan, so the two agree.
 * @param {object} [opts.ctx] - task context for progress and cancellation
 */
export async function writeCoverLetter({ jobId, jdText, jdAnalysis, selection, resumeDocument = null, ctx = NOOP_CTX }) {
  const profile = getProfile();
  const profileFullText = profileFull(profile);
  const whyLookingText = profile.facts.whyLooking && !profile.facts.whyLooking.includes("<ask") ? profile.facts.whyLooking : "";
  const resumeRow = resumeDocument || latestDocument(jobId, "resume");
  const resume = resumeRow ? resumeContext(resumeRow) : null;

  let totalCost = 0;

  if (!jdAnalysis || !selection) {
    ctx.beginStage("cover_letter_context");
    try {
      const resolved = await resolveJdAndSelection({ jdText, profile, profileFullText, jobId });
      jdAnalysis = resolved.jdAnalysis;
      selection = resolved.selection;
      totalCost += resolved.costUsd || 0;
      ctx.finishStage("cover_letter_context", { costUsd: resolved.costUsd });
    } catch (e) {
      ctx.failStage("cover_letter_context", e);
      throw e;
    }
  }

  ctx.beginStage("cover_letter");
  let draft;
  try {
    const { data, costUsd } = await writeOnce({ jdText, jdAnalysis, selection, profileFullText, whyLookingText, resume, jobId });
    draft = data;
    totalCost += costUsd || 0;

    const issues = lintCoverLetter(draft.paragraphs);
    if (issues.length > 0) {
      // One rewrite pass: same prompt plus the issues found, asking for a clean rewrite.
      const retryPrompt = `${coverLetterPrompt({ jdText, jdAnalysis, selection, profileFullText, whyLookingText, resume })}\n\nA style check found these issues in your last draft — rewrite avoiding them:\n${JSON.stringify(issues, null, 2)}`;
      const retry = await runClaude({
        purpose: `cover_letter_rewrite:${jobId}`,
        system: BASE_SYSTEM_PROMPT,
        prompt: retryPrompt,
        schema: coverLetterSchema,
        effort: "medium",
        model: config.claude.modelWrite,
        timeoutMs: 240_000,
        jobId,
      });
      draft = retry.data;
      totalCost += retry.costUsd || 0;
    }
    ctx.finishStage("cover_letter", { costUsd: totalCost });
  } catch (e) {
    ctx.failStage("cover_letter", e);
    throw e;
  }

  const document = saveDocument({
    jobId,
    kind: "cover_letter",
    title: jdAnalysis.company ? `Cover letter — ${jdAnalysis.company}` : "Cover letter",
    // Which résumé version the letter was written to match; the rail and
    // the letter panel show it, and a revision writes a fresh letter.
    contentJson: { ...draft, resume_document_id: resume?.documentId ?? null, resume_version: resume?.version ?? null },
    contentText: draft.paragraphs.join("\n\n"),
    costUsd: totalCost,
    model: config.claude.modelWrite,
  });

  return { document, costUsd: totalCost };
}
