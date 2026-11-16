import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { jobExtractSchema } from "../schemas.js";
import { jobExtractPrompt } from "../prompts/jobExtract.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { fetchPage, detectAtsBoard } from "../../sources/extract.js";
import { toJob } from "../../sources/normalize.js";
import { upsertJob } from "../../sources/dedup.js";
import { fetchGreenhouseBoard, fetchLeverBoard, fetchAshbyBoard } from "../../sources/adapters/index.js";
import { NOOP_CTX } from "../../tasks/ctx.js";

export const EXTRACT_JOB_STAGES = ["job_fetch", "job_extract"];

async function extractViaAtsBoard(url, board, slug) {
  let jobs = [];
  if (board === "greenhouse") jobs = await fetchGreenhouseBoard({ slug });
  else if (board === "lever") jobs = await fetchLeverBoard({ slug });
  else if (board === "ashby") jobs = await fetchAshbyBoard({ slug });
  return jobs.find((j) => j.url === url || j.apply_url === url) || null;
}

/** Ingests a job posting from an arbitrary URL: recognized ATS boards go
 * through their JSON API (routes/jobs.js already saved you from HTML
 * scraping in the common case); anything else is fetched and read with
 * Readability, then structured by the model. */
export async function extractJobFromLink(url, ctx = NOOP_CTX) {
  ctx.beginStage("job_fetch");
  const ats = detectAtsBoard(url);
  if (ats) {
    let matched = null;
    try {
      matched = await extractViaAtsBoard(url, ats.board, ats.slug);
    } catch (e) {
      ctx.failStage("job_fetch", e);
      throw e;
    }
    if (matched) {
      ctx.finishStage("job_fetch");
      // The board handed us structured data: nothing to extract.
      ctx.beginStage("job_extract");
      const { job, created } = upsertJob(toJob(matched), { enqueueFitOnCreate: true });
      ctx.finishStage("job_extract");
      return { job, created, costUsd: 0 };
    }
    // Fall through to generic extraction if the specific posting wasn't found on the board.
  }

  let pageTitle, pageText;
  try {
    ({ title: pageTitle, text: pageText } = await fetchPage(url));
    if (!pageText || pageText.length < 200) {
      throw new Error("Could not extract readable text from that page.");
    }
  } catch (e) {
    ctx.failStage("job_fetch", e);
    throw e;
  }
  ctx.finishStage("job_fetch");
  ctx.checkpoint();

  ctx.beginStage("job_extract");
  let data, costUsd;
  try {
    ({ data, costUsd } = await runClaude({
      purpose: "job_extract",
      system: BASE_SYSTEM_PROMPT,
      prompt: jobExtractPrompt({ url, pageText }),
      schema: jobExtractSchema,
      effort: "low",
      model: config.claude.model,
    }));
    if (!data.is_job_posting) {
      throw new Error(`That page doesn't look like a job posting: ${data.title}`);
    }
  } catch (e) {
    ctx.failStage("job_extract", e);
    throw e;
  }

  const job = toJob({
    source: "link",
    source_id: null,
    url,
    apply_url: data.apply_url || url,
    title: data.title || pageTitle,
    company: data.company,
    location_raw: data.location,
    work_mode: data.work_mode,
    description_text: data.description_markdown,
    posted_at: data.posted_at,
    salary_text: data.salary,
    raw: { employment_type: data.employment_type },
  });

  const { job: saved, created } = upsertJob(job, { enqueueFitOnCreate: true });
  ctx.finishStage("job_extract", { costUsd });
  return { job: saved, created, costUsd };
}
