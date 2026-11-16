import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { applicationAnswerSchema } from "../schemas.js";
import { applicationAnswerPrompt } from "../prompts/applicationAnswer.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { lintAnswer } from "../lint.js";
import { profileFull } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { saveDocument, latestDocument } from "../../db/repo/documents.js";
import { resumeContext } from "../resumeContext.js";

/**
 * @param {object} opts
 * @param {string} opts.question
 * @param {string} [opts.jdText]
 * @param {"short"|"medium"|"long"} [opts.length]
 * @param {string|null} [opts.jobId] - when given, the answer is saved as a document
 */
export async function answerQuestion({ question, jdText = "", length = "medium", jobId = null }) {
  const profile = getProfile();
  const profileFullText = profileFull(profile);
  // The job's newest résumé, so the answer agrees with what was sent.
  const resumeRow = jobId ? latestDocument(jobId, "resume") : null;
  const resume = resumeRow ? resumeContext(resumeRow) : null;

  let totalCost = 0;
  let draft = await runClaude({
    purpose: `application_answer:${jobId || "adhoc"}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: applicationAnswerPrompt({ question, jdText, profileFullText, length, resume }),
    schema: applicationAnswerSchema,
    effort: "low",
    model: config.claude.modelWrite,
    jobId,
  });
  totalCost += draft.costUsd || 0;
  let data = draft.data;

  const issues = lintAnswer(data.answer);
  if (issues.length > 0) {
    const retryPrompt = `${applicationAnswerPrompt({ question, jdText, profileFullText, length, resume })}\n\nA style check flagged these issues — rewrite avoiding them:\n${JSON.stringify(issues, null, 2)}`;
    const retry = await runClaude({
      purpose: `application_answer_rewrite:${jobId || "adhoc"}`,
      system: BASE_SYSTEM_PROMPT,
      prompt: retryPrompt,
      schema: applicationAnswerSchema,
      effort: "low",
      model: config.claude.modelWrite,
      jobId,
    });
    data = retry.data;
    totalCost += retry.costUsd || 0;
  }

  let documentId = null;
  if (jobId) {
    const document = saveDocument({
      jobId,
      kind: "answer",
      title: question.slice(0, 80),
      contentJson: { ...data, resume_document_id: resume?.documentId ?? null, resume_version: resume?.version ?? null },
      contentText: data.answer,
      question,
      costUsd: totalCost,
      model: config.claude.modelWrite,
    });
    documentId = document.id;
  }

  return { ...data, costUsd: totalCost, documentId };
}
