import { PROSE_STYLE } from "./system.js";
import { resumePromptSection } from "../resumeContext.js";

function escapeTag(text, tag) {
  return String(text || "").replaceAll(`</${tag}>`, `<​/${tag}>`);
}

/**
 * @param {object} opts
 * @param {object|null} [opts.resume] - resumeContext() of the résumé this
 *   letter accompanies; null only when the job has no résumé yet, in
 *   which case the letter is written from the plan alone.
 */
export function coverLetterPrompt({ jdText, jdAnalysis, selection, profileFullText, whyLookingText, resume = null }) {
  const resumeSection = resumePromptSection(resume);
  return `${PROSE_STYLE}

Write a cover letter for this job. It goes out with the résumé below, so the two must read as one application.

<job_description>
${escapeTag(jdText, "job_description")}
</job_description>

JOB ANALYSIS:
${JSON.stringify(jdAnalysis, null, 2)}

RÉSUMÉ PLAN (summary angle + top relevant stories):
${JSON.stringify(selection, null, 2)}

${resumeSection ? `${resumeSection}\n\n` : ""}PROFILE (for story details and colour):
${profileFullText}

${whyLookingText ? `Why the candidate is looking / what they want next (use only if it fits naturally, do not force it):\n${whyLookingText}\n` : ""}

Rules:
- Use "Hiring Manager" as the greeting unless the job analysis gives a company name and a real hiring manager name is present in the job description text itself — never guess a name.
${resumeSection
    ? `- The résumé is the source of truth for every concrete claim: title, years, technologies, achievements, figures. Never contradict it and never add a claim that is on neither the résumé nor the profile.
- Lead with the résumé's strongest matches to the posting's must-haves, as the résumé states them. Profile story details may add colour only where they agree with the résumé.
- Tell 1-2 pieces of work in plain prose, not a bulleted list.
- story_ids_used lists the profile story ids the letter actually draws on; it may be empty when the material came from the résumé.`
    : `- Tell 1-2 stories from the profile in plain prose, not a bulleted list.
- story_ids_used must list every story id the letter actually draws from.`}
- Anything you say about the company beyond what's literally in the job description text goes in inferred_claims, not the letter body.`;
}
