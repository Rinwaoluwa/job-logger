import { createHash } from "node:crypto";
import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { fitAnalysisSchema } from "../schemas.js";
import { fitAnalysisPrompt } from "../prompts/fitAnalysis.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { profileCompact } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { insertFitAnalysis } from "../../db/repo/fitAnalyses.js";
import { getJob } from "../../db/repo/jobs.js";

export async function runFitAnalysis(jobId) {
  const job = getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  const profile = getProfile();
  const compactText = profileCompact(profile);
  const profileHash = createHash("sha1").update(compactText).digest("hex");

  const { data, costUsd } = await runClaude({
    purpose: `fit_analysis:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: fitAnalysisPrompt({ jobTitle: job.title, jobCompany: job.company, jdText: job.description_text, profileCompactText: compactText }),
    schema: fitAnalysisSchema,
    effort: "low",
    model: config.claude.model,
    jobId,
  });

  const record = insertFitAnalysis({
    jobId,
    score: data.score,
    verdict: data.verdict,
    applyRecommendation: data.apply_recommendation,
    resultJson: data,
    profileHash,
    model: config.claude.model,
    costUsd,
  });

  return record;
}
