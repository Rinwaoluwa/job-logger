// A follow-up on a generated résumé: the user tells the AI what to change,
// the model applies it to the version they were looking at, and the result
// is saved as the next version with the instruction on it. One write call,
// then the same deterministic checks and page fit a fresh generation gets.
// Every Claude CLI call is a stateless one-shot, so the "conversation" is
// rebuilt each time from the previous version's JSON plus the chain of
// earlier instructions on that résumé.

import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { resumeReviseSchema } from "../schemas.js";
import { resumeRevisePrompt } from "../prompts/resumeRevise.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { profileFull, verifiedMetricsText, skillsTableText } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { getJob } from "../../db/repo/jobs.js";
import { getDocument, saveDocument, instructionThread } from "../../db/repo/documents.js";
import { NOOP_CTX } from "../../tasks/ctx.js";
import { genericJdAnalysis, latestRoleId as findLatestRoleId } from "./shared.js";
import { finishResume, withoutStackAdditions } from "./finishResume.js";
import { realWorkBullets } from "../verify.js";
import { isReframeReason } from "../../../shared/applyReview.js";

/** Stage names a revision reports, in order. */
export const REVISE_STAGES = ["resume_revise", "verify_lint", "page_fit", "resume_rewrite"];

// The keys the writer's schema knows. A stored document also carries the
// reports the pipeline adds afterwards (keyword_coverage, reviewer_report,
// layout, plan), which are 10-17 KB of prompt the model has no use for.
const SCHEMA_KEYS = ["resume", "additions_to_review", "match_score", "must_have_gaps", "nice_to_have_gaps", "ats_keywords", "rewrite_notes"];

// Additions the model must not see on the way in. Reviewer notes describe
// the previous text and have a kind the writer's schema cannot express;
// blocked entries would lose their `blocking` flag on the way through the
// schema and come back as ordinary, acceptable additions; composed entries
// are recomputed from the final draft. finishResume regenerates the last
// two deterministically. Gap-fill entries go through: the writer's schema
// has no `gate`, so finishResume re-derives their open gate from the
// "Gap fill:" prefix, and the do-not-claim sentence it appended to a
// fill's reason is copied back by the model (the append is idempotent).
const REGENERATED_PREFIXES = ["reviewer-note-", "blocked-", "composed-"];

function promptInput(contentJson) {
  const out = {};
  for (const key of SCHEMA_KEYS) if (key in contentJson) out[key] = contentJson[key];
  out.additions_to_review = (out.additions_to_review || []).filter(
    (a) => !REGENERATED_PREFIXES.some((p) => String(a.id || "").startsWith(p)),
  );
  out.rewrite_notes = [];
  // The model sees the engagement override only, never the resolved
  // label, so a profile edit still reaches the next revision.
  if (out.resume?.experience) {
    out.resume = {
      ...out.resume,
      experience: out.resume.experience.map(({ engagement_label, ...role }) => ({ ...role, engagement: role.engagement ?? null })),
    };
  }
  return out;
}

// The posting itself rides along so an instruction can refer to its
// wording ("rephrase anything that mirrors the posting"). Postings in
// the live data top out around 11 KB; the cap is a guard.
const JD_TEXT_MAX = 12_000;

/**
 * The plan the checks measure the revised draft against. The original
 * plan's roles, ordering and coverage targets are kept; its bullet counts
 * are replaced by the revised draft's own real-work counts, so verify.js does not flag a
 * role the user asked to grow or shrink; and its gap fills are dropped, so
 * a fill the user removed is not reported as missing and reinstated.
 */
function planForRevision(storedPlan, jdCoverage, draft) {
  const stored = storedPlan || {};
  const counts = new Map((draft.resume.experience || []).map((r) => [r.role_id, realWorkBullets(r, draft.additions_to_review).length]));
  const rolePlan = (stored.role_plan || []).map((p) => ({ ...p, bullet_count: counts.get(p.role_id) ?? p.bullet_count }));
  return {
    ...stored,
    summary_angle: "Keep the existing summary's angle unless the candidate's instruction changes it.",
    role_plan: rolePlan,
    jd_coverage: jdCoverage || stored.jd_coverage || [],
    gap_fills: [],
    // A reframe stays in force only while the revised draft still carries a
    // "Reframed:" bullet on that role; one the user asked to drop would
    // otherwise be reinstated by the leak check.
    reframes: (stored.reframes || []).filter((r) => reframedRoleIds(draft).has(r.role_id)),
  };
}

function reframedRoleIds(draft) {
  const ids = new Set((draft.additions_to_review || []).filter((a) => a.kind === "bullet" && isReframeReason(a)).map((a) => a.location));
  const roles = new Set();
  for (const role of draft.resume?.experience || []) {
    if ((role.bullets || []).some((b) => ids.has(b.id))) roles.add(role.role_id);
  }
  return roles;
}

/** A decision carries over only when the addition it was about is still
 * there with the same text; a bullet the user just asked to rewrite starts
 * its review afresh. */
function carriedDecisions(base, draft) {
  const previous = base.review_decisions || {};
  const byId = new Map((base.content_json.additions_to_review || []).map((a) => [a.id, a]));
  const out = {};
  for (const a of draft.additions_to_review || []) {
    const decision = previous[a.id];
    const before = byId.get(a.id);
    if (decision && before && before.text === a.text) out[a.id] = decision;
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {number} opts.documentId - the résumé version the instruction is about
 * @param {string} opts.instruction - what the user asked for
 * @param {object} [opts.ctx]
 * @returns {Promise<{document: object, costUsd: number}>}
 */
export async function reviseResume({ jobId, documentId, instruction, ctx = NOOP_CTX }) {
  const base = getDocument(documentId);
  if (!base) throw new Error("the résumé version this instruction was about no longer exists");
  if (base.kind !== "resume") throw new Error(`document ${documentId} is a ${base.kind}, not a résumé`);
  if (base.job_id !== jobId) throw new Error("document does not belong to this job");
  const text = String(instruction || "").trim();
  if (!text) throw new Error("instruction is empty");

  const profile = getProfile();
  const profileFullText = profileFull(profile, { interviewVersions: false });
  const metricsText = verifiedMetricsText(profile);
  const skillsText = skillsTableText(profile);
  const latestRoleId = findLatestRoleId(profile);

  const job = getJob(jobId);
  const jdAnalysis = job?.jd_analysis || genericJdAnalysis(profile);
  const jdText = String(job?.description_text || "").slice(0, JD_TEXT_MAX);
  const priorInstructions = instructionThread(documentId).map((t) => t.instruction);
  // Questions the last revision left open; this instruction may answer them.
  const previousQuestions = Array.isArray(base.content_json.open_questions) ? base.content_json.open_questions : [];
  const previousResume = promptInput(base.content_json);
  // The plan the model reads is the original one (angles, technologies to
  // show, relevance ordering); the checks get the adjusted copy below.
  const storedPlan = base.content_json.plan && typeof base.content_json.plan === "object" ? base.content_json.plan : null;

  let totalCost = 0;
  const track = (c) => { totalCost += c || 0; };

  ctx.beginStage("resume_revise");
  let draft;
  let revisionNotes;
  let openQuestions;
  try {
    const { data, costUsd } = await runClaude({
      purpose: `resume_revise:${jobId}`,
      system: BASE_SYSTEM_PROMPT,
      prompt: resumeRevisePrompt({
        jdAnalysis,
        selection: storedPlan || { note: "No stored plan for this version; follow the previous résumé's shape." },
        profileFullText,
        verifiedMetricsText: metricsText,
        skillsTableText: skillsText,
        previousResume,
        instruction: text,
        priorInstructions,
        previousQuestions,
        jdText,
        latestRoleId,
      }),
      schema: resumeReviseSchema,
      effort: "medium",
      model: config.claude.modelWrite,
      timeoutMs: 300_000,
      jobId,
    });
    revisionNotes = data.revision_notes || [];
    openQuestions = data.open_questions || [];
    delete data.revision_notes;
    delete data.open_questions;
    draft = withoutStackAdditions(data);
    track(costUsd);
    ctx.finishStage("resume_revise", { costUsd });
  } catch (e) {
    ctx.failStage("resume_revise", e);
    throw e;
  }

  const selection = planForRevision(storedPlan, base.content_json.jd_coverage, draft);
  const finished = await finishResume({
    draft, profile, jdAnalysis, selection, jobId, ctx,
    reviewer: false,
    coverageMayForce: false,
    // The user may have asked for exactly the wording the style lint
    // objects to; the instruction wins, the lint becomes a note.
    styleMayForce: false,
    userDirective: [...priorInstructions, text].map((s, i) => `${i + 1}. ${s}`).join("\n"),
  });
  draft = finished.draft;
  track(finished.costUsd);

  draft.revision_notes = revisionNotes;
  draft.open_questions = openQuestions;
  draft.plan = storedPlan;

  const document = saveDocument({
    jobId,
    kind: "resume",
    title: base.title,
    contentJson: draft,
    costUsd: totalCost,
    model: config.claude.modelWrite,
    parentId: base.id,
    instruction: text,
    reviewDecisions: carriedDecisions(base, draft),
  });

  return { document, costUsd: totalCost };
}
