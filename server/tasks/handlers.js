// One handler per task kind: the stage names it will report (declared up
// front so the activity panel can list them before they start) and the
// work itself. Handlers return the value stored as the task's result.

import { getJob } from "../db/repo/jobs.js";
import { latestDocument } from "../db/repo/documents.js";
import { setTaskJob } from "../db/repo/tasks.js";
import { tailorResume, TAILOR_STAGES } from "../ai/pipelines/tailorResume.js";
import { reviseResume, REVISE_STAGES } from "../ai/pipelines/reviseResume.js";
import { writeCoverLetter, COVER_LETTER_STAGES } from "../ai/pipelines/coverLetter.js";
import { runFitAnalysis } from "../ai/pipelines/fitAnalysis.js";
import { runInterviewPrep, regenerateInterviewQuestion } from "../ai/pipelines/interviewPrep.js";
import { critiqueMockTurn } from "../ai/pipelines/mockCritique.js";
import { runPeopleSearch, peopleStages } from "../ai/pipelines/peopleSearch.js";
import { answerQuestion } from "../ai/pipelines/answerQuestion.js";
import { extractJobFromLink, EXTRACT_JOB_STAGES } from "../ai/pipelines/extractJob.js";
import { refreshAll, refreshTargets } from "../sources/index.js";
import { isCancelled } from "./context.js";
import { genericJdAnalysis, buildGenericSelection } from "../ai/pipelines/shared.js";
import { getProfile } from "../profile/loader.js";
import { BRIEF_SOURCE } from "../../shared/briefs.js";

function requireJob(task) {
  const job = getJob(task.jobId);
  if (!job) throw new Error("job not found (it may have been deleted while this was queued)");
  return job;
}

/** The fit score inside a Prepare run. Fit is a bonus, not a requirement:
 * a failure logs, marks its stage failed and yields null rather than
 * failing the task. A cancellation still propagates. */
async function scoreFit(job, ctx) {
  ctx.beginStage("fit");
  try {
    const fit = await runFitAnalysis(job.id);
    ctx.finishStage("fit", { costUsd: fit?.cost_usd });
    return fit;
  } catch (e) {
    if (isCancelled(e)) throw e;
    console.warn(`[prepare] fit analysis failed for ${job.id}: ${e.message}`);
    ctx.failStage("fit", e);
    return null;
  }
}

export const handlers = {
  prepare_application: {
    // "fit" is listed first because it starts first: it needs only the
    // posting and the compact profile, so it runs alongside the tailor
    // pipeline instead of waiting behind it at the end.
    stages: ({ coverLetter = true, fit = true } = {}) => [
      ...(fit ? ["fit"] : []),
      ...TAILOR_STAGES,
      ...(coverLetter ? COVER_LETTER_STAGES : []),
    ],
    async run(task, ctx) {
      const job = requireJob(task);
      const { coverLetter = true, fit: wantFit = true } = task.payload || {};
      const jdText = task.payload?.jdText ?? job.description_text;

      // Started before anything is awaited, with a handler attached right
      // away: a rejection (a cancellation) while the tailor pipeline is
      // still running must never surface as an unhandled rejection. The
      // real outcome is read from the same promise below.
      const fitPromise = wantFit ? scoreFit(job, ctx) : Promise.resolve(null);
      fitPromise.catch(() => {});

      let tailorResult;
      let coverLetterDoc = null;
      try {
        // A brief (Résumés tab) has no posting: its analysis is inferred
        // from the typed title and skills instead of read from the text.
        const brief = job.source === BRIEF_SOURCE ? job.raw?.brief || null : null;
        tailorResult = await tailorResume({ jobId: job.id, jdText, brief, ctx });
        if (coverLetter) {
          const cover = await writeCoverLetter({
            jobId: job.id, jdText,
            jdAnalysis: tailorResult.jdAnalysis, selection: tailorResult.selection,
            resumeDocument: tailorResult.document, ctx,
          });
          coverLetterDoc = cover.document;
        }
      } catch (e) {
        // Let the fit call finish (or be cancelled) before the task is
        // marked failed, so no CLI process outlives its task.
        await fitPromise.catch(() => {});
        throw e;
      }
      const fit = await fitPromise;
      return { resumeDocId: tailorResult.document.id, coverLetterDocId: coverLetterDoc?.id ?? null, fitId: fit?.id ?? null };
    },
  },

  // A follow-up instruction on an existing résumé version. The result is
  // the next version of that résumé; the Documents tab moves to it. When
  // the job has a cover letter (the route sets `coverLetter`), a fresh
  // one is written from the revised résumé so the two keep agreeing; a
  // letter failure is logged, never fails the revision.
  revise_resume: {
    stages: ({ coverLetter = false } = {}) => [...REVISE_STAGES, ...(coverLetter ? COVER_LETTER_STAGES : [])],
    async run(task, ctx) {
      const job = requireJob(task);
      const { documentId, instruction, coverLetter = false } = task.payload || {};
      const { document, costUsd } = await reviseResume({ jobId: task.jobId, documentId: Number(documentId), instruction, ctx });
      let coverLetterDoc = null;
      let coverCost = 0;
      if (coverLetter) {
        try {
          // Both inputs are always given so the letter never rebuilds the
          // JD analysis and plan (a stage this task does not declare).
          const profile = getProfile();
          const cover = await writeCoverLetter({
            jobId: job.id,
            jdText: job.description_text,
            jdAnalysis: job.jd_analysis || genericJdAnalysis(profile),
            selection: document.content_json.plan || buildGenericSelection(profile),
            resumeDocument: document,
            ctx,
          });
          coverLetterDoc = cover.document;
          coverCost = cover.costUsd || 0;
        } catch (e) {
          if (isCancelled(e)) throw e;
          console.warn(`[revise] cover letter rewrite failed for ${job.id}: ${e.message}`);
        }
      }
      return { resumeDocId: document.id, version: document.version, coverLetterDocId: coverLetterDoc?.id ?? null, costUsd: costUsd + coverCost };
    },
  },

  // A fresh cover letter from the job's newest résumé as it stands now
  // (review decisions included): the way to catch the letter up after
  // accepting or rejecting gap fills, or when the automatic rewrite on a
  // revision failed. The newest letter version is the result.
  cover_letter: {
    stages: () => [...COVER_LETTER_STAGES],
    async run(task, ctx) {
      const job = requireJob(task);
      const resume = latestDocument(job.id, "resume");
      if (!resume) throw new Error("this job has no résumé yet; run Prepare application first");
      const profile = getProfile();
      const cover = await writeCoverLetter({
        jobId: job.id,
        jdText: job.description_text,
        jdAnalysis: job.jd_analysis || genericJdAnalysis(profile),
        selection: resume.content_json.plan || buildGenericSelection(profile),
        resumeDocument: resume,
        ctx,
      });
      return { coverLetterDocId: cover.document.id, version: cover.document.version, resumeVersion: resume.version, costUsd: cover.costUsd };
    },
  },

  // The prep for one interview round (payload.roundId), or the job's
  // general prep when no round is given.
  interview_prep: {
    stages: () => ["interview_prep"],
    async run(task, ctx) {
      requireJob(task);
      const roundId = task.payload?.roundId ? Number(task.payload.roundId) : null;
      ctx.beginStage("interview_prep");
      try {
        const record = await runInterviewPrep(task.jobId, { roundId });
        ctx.finishStage("interview_prep", { costUsd: record.cost_usd });
        return { interviewPrepId: record.id };
      } catch (e) {
        ctx.failStage("interview_prep", e);
        throw e;
      }
    },
  },

  // One question card of an existing prep rewritten in place.
  interview_prep_question: {
    stages: () => ["interview_prep_question"],
    async run(task, ctx) {
      requireJob(task);
      const { interviewPrepId, index, note } = task.payload || {};
      ctx.beginStage("interview_prep_question");
      try {
        const { costUsd } = await regenerateInterviewQuestion({ jobId: task.jobId, interviewPrepId, index, note });
        ctx.finishStage("interview_prep_question", { costUsd });
        return { interviewPrepId, index, costUsd };
      } catch (e) {
        ctx.failStage("interview_prep_question", e);
        throw e;
      }
    },
  },

  // One mock-interview answer judged; the critique lands on its row.
  mock_critique: {
    stages: () => ["mock_critique"],
    async run(task, ctx) {
      requireJob(task);
      const turnId = Number(task.payload?.turnId);
      ctx.beginStage("mock_critique");
      try {
        const { turn, costUsd } = await critiqueMockTurn(turnId);
        ctx.finishStage("mock_critique", { costUsd });
        return { turnId: turn.id, score: turn.critique?.score ?? null, costUsd };
      } catch (e) {
        ctx.failStage("mock_critique", e);
        throw e;
      }
    },
  },

  // Who to contact at the company, with a draft note each. The pipeline
  // reports its own two stages; a zero-person result still completes.
  people: {
    stages: () => peopleStages(),
    async run(task, ctx) {
      requireJob(task);
      const { hints = "", buildOn = true } = task.payload || {};
      const record = await runPeopleSearch({ jobId: task.jobId, hints, buildOn, ctx });
      return {
        peopleSearchId: record.id,
        found: record.result_json.people.length,
        rounds: record.result_json.rounds,
        costUsd: record.cost_usd,
      };
    },
  },

  answer: {
    stages: () => ["answer_write"],
    async run(task, ctx) {
      const { question, jdText = "", length = "medium", jobId = null } = task.payload || {};
      ctx.beginStage("answer_write");
      try {
        const result = await answerQuestion({ question, jdText, length, jobId });
        ctx.finishStage("answer_write", { costUsd: result.costUsd });
        return result;
      } catch (e) {
        ctx.failStage("answer_write", e);
        throw e;
      }
    },
  },

  fit: {
    stages: () => ["fit"],
    async run(task, ctx) {
      requireJob(task);
      ctx.beginStage("fit");
      try {
        const record = await runFitAnalysis(task.jobId);
        ctx.finishStage("fit", { costUsd: record.cost_usd });
        return { fitId: record.id, score: record.score, verdict: record.verdict };
      } catch (e) {
        ctx.failStage("fit", e);
        throw e;
      }
    },
  },

  add_job_link: {
    stages: () => [...EXTRACT_JOB_STAGES],
    async run(task, ctx) {
      const { job, created, costUsd } = await extractJobFromLink(task.payload.url, ctx);
      setTaskJob(task.id, job.id);
      return { jobId: job.id, created, costUsd };
    },
  },

  sources_refresh: {
    stages: ({ only } = {}) => refreshTargets({ only }).map((a) => a.name),
    async run(task, ctx) {
      const summaries = await refreshAll({ only: task.payload?.only, groupId: task.id, ctx });
      return { summaries };
    },
  },
};
