// One mock-interview answer judged. Cheap by design: a low-effort call
// that sees the question card, the stories it cites and the do-not-say
// lists, not the whole profile.

import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { mockCritiqueSchema } from "../schemas.js";
import { mockCritiquePrompt } from "../prompts/mockCritique.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { findStory } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { getJob } from "../../db/repo/jobs.js";
import { getInterviewPrep } from "../../db/repo/interviewPreps.js";
import { getMockTurn, setMockTurnCritique } from "../../db/repo/mockTurns.js";
import { sentResume } from "../../db/repo/documents.js";
import { resumeContext } from "../resumeContext.js";

/** A story as the critique prompt needs it: the STAR and the spoken
 *  version, nothing else. Projects (proj-*) have no story shape and are
 *  rendered from their fields. */
function renderStory(profile, id) {
  const s = findStory(profile, id);
  if (s) {
    const lines = [`[${s.id}] ${s.title}${s.roleCompany ? ` (${s.roleCompany})` : ""}`];
    if (s.situation) lines.push(`  Situation: ${s.situation}`);
    if (s.whatIDid) lines.push(`  What I did: ${s.whatIDid}`);
    if (s.decisions) lines.push(`  Decisions / trade-offs: ${s.decisions}`);
    if (s.outcome) lines.push(`  Outcome: ${s.outcome}`);
    if (s.s) lines.push(`  Situation: ${s.s}`);
    if (s.t) lines.push(`  Task: ${s.t}`);
    if (s.a) lines.push(`  Action: ${s.a}`);
    if (s.r) lines.push(`  Result: ${s.r}`);
    if (s.interviewVersion && !/^\(/.test(s.interviewVersion)) lines.push(`  How he tells it: ${s.interviewVersion}`);
    return lines.join("\n");
  }
  const p = (profile.projects || []).find((x) => x.id === id);
  if (p) {
    return [`[${p.id}] ${p.title} (personal project)`, p.whatIBuilt ? `  What I built: ${p.whatIBuilt}` : "", p.outcome ? `  Outcome: ${p.outcome}` : ""].filter(Boolean).join("\n");
  }
  return null;
}

function doNotClaimText(profile) {
  const lines = [];
  for (const d of profile.facts.globalDoNotClaim || []) lines.push(`- ${d}`);
  for (const d of profile.skillsDoNotClaim || []) lines.push(`- skill: ${d}`);
  for (const role of profile.roles) {
    for (const d of role.doNotClaim || []) lines.push(`- at ${role.company}: ${d}`);
    for (const m of role.metrics || []) if (!m.verified) lines.push(`- unverified number at ${role.company}: ${m.text}`);
  }
  if (profile.facts.overlapExplanation) lines.push(`- Employment overlap, say it this way: ${profile.facts.overlapExplanation}`);
  return lines.join("\n");
}

/**
 * @param {number} turnId
 * @returns {{ turn: object, costUsd: number }}
 */
export async function critiqueMockTurn(turnId) {
  const turn = getMockTurn(turnId);
  if (!turn) throw new Error(`mock turn not found: ${turnId}`);
  const job = getJob(turn.job_id);
  if (!job) throw new Error(`job not found: ${turn.job_id}`);
  const profile = getProfile();
  const prep = turn.interview_prep_id ? getInterviewPrep(turn.interview_prep_id) : null;
  const parent = turn.parent_turn_id ? getMockTurn(turn.parent_turn_id) : null;

  // The card the question came from: by index when the text still
  // matches (a rewrite may have replaced it since), else by text.
  const questions = prep?.result_json?.questions || [];
  const sourceIndex = parent?.question_index ?? turn.question_index;
  const sourceQuestion = parent ? parent.question : turn.question;
  let card = Number.isInteger(sourceIndex) && questions[sourceIndex]?.question === sourceQuestion ? questions[sourceIndex] : null;
  if (!card) card = questions.find((q) => q.question === sourceQuestion) || null;
  // For a follow-up the card's talking points are the parent's; the
  // follow-up itself is judged on the same stories.
  const cardForPrompt = parent ? (card ? { ...card, talking_points: [], draft_answer: "", why_asked: "" } : null) : card;

  // No card (a question typed by hand, or a prep rewritten since): the
  // round's top stories are the best guess at what the answer draws on.
  const storyIds = card?.story_ids?.length
    ? [...new Set(card.story_ids)]
    : (prep?.result_json?.top_stories || []).map((t) => t.story_id);
  const storiesText = storyIds.map((id) => renderStory(profile, id)).filter(Boolean).join("\n\n");

  const resumeRow = sentResume(job.id).document;
  const gapFills = resumeRow ? resumeContext(resumeRow).gapFills : [];

  const { data, costUsd } = await runClaude({
    purpose: `mock_critique:${job.id}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: mockCritiquePrompt({
      jobTitle: job.title,
      jobCompany: job.company,
      roundKind: prep?.result_json?.round_kind || null,
      turn,
      card: cardForPrompt,
      parent,
      storiesText,
      doNotClaimText: doNotClaimText(profile),
      watchOuts: prep?.result_json?.watch_outs || [],
      gapFills,
    }),
    schema: mockCritiqueSchema,
    effort: "low",
    model: config.claude.model,
    timeoutMs: 120_000,
    jobId: job.id,
  });

  const updated = setMockTurnCritique(turnId, data, costUsd || 0);
  return { turn: updated, costUsd: costUsd || 0 };
}
