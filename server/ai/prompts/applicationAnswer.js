import { PROSE_STYLE } from "./system.js";
import { resumePromptSection } from "../resumeContext.js";

const ANSWER_LENGTHS = {
  short: "60-100 words, 1 tight paragraph",
  medium: "120-180 words, 1-2 short paragraphs",
  long: "220-300 words, 2-3 short paragraphs",
};

function escapeTag(text, tag) {
  return String(text || "").replaceAll(`</${tag}>`, `<​/${tag}>`);
}

/**
 * @param {object} opts
 * @param {object|null} [opts.resume] - resumeContext() of the job's newest
 *   résumé, so the answer agrees with what was sent; null for an ad-hoc
 *   question with no job behind it.
 */
export function applicationAnswerPrompt({ question, jdText, profileFullText, length, resume = null }) {
  const lengthRule = ANSWER_LENGTHS[length] || ANSWER_LENGTHS.short;
  const resumeSection = resumePromptSection(resume);
  return `${PROSE_STYLE}

Answer this job application question in first person, as the candidate.

<question>
${escapeTag(question, "question")}
</question>

<job_description>
${escapeTag(jdText || "(none provided)", "job_description")}
</job_description>

${resumeSection ? `${resumeSection}\n\n` : ""}PROFILE (candidate's real experience — use one concrete story, name the actual employer):
${profileFullText}

Rules:
- Length: ${lengthRule}.${resumeSection ? `
- The answer goes to the same employer as the résumé above, so the résumé is the source of truth for every concrete claim: title, technologies, achievements, figures. Never contradict it and never add a claim that is on neither the résumé nor the profile.` : ""}
- If this is a behavioral question, use one story from the profile told naturally in prose (not labelled S/T/A/R).
- Ground the answer in specifics: what was built, the decision made, the outcome — not adjectives.
- story_ids_used must list the story id(s) the answer actually draws from.
- If the question asks something the profile has no basis for (e.g. "why this company"), keep the claim generic and add it to inferred_claims rather than inventing specifics.`;
}
