function escapeTag(text, tag) {
  return String(text || "").replaceAll(`</${tag}>`, `<​/${tag}>`);
}

export function fitAnalysisPrompt({ jobTitle, jobCompany, jdText, profileCompactText }) {
  return `Assess how well this candidate fits this job. Be honest, not encouraging — the candidate would rather skip a bad-fit application than waste time on it.

Job: ${jobTitle} at ${jobCompany}

<job_description>
${escapeTag(jdText, "job_description")}
</job_description>

CANDIDATE PROFILE (compact):
${profileCompactText}

Scoring rubric:
- 85-100 "strong": every critical must-have is covered by the candidate at "working" proficiency or above, and location/work-mode is compatible.
- 70-84 "good": minor gaps only.
- 50-69 "stretch": real gaps but plausible with ramp-up.
- 0-49 "weak": multiple significant gaps.
- verdict "no" (score can still be numeric) whenever there is a blocker: a work-authorization/visa requirement the candidate doesn't meet, a security clearance requirement, onsite location incompatible with the candidate's targets, or seniority far above/below what the candidate has.

Rules:
- must_have_gaps: every job requirement the candidate's profile doesn't clearly cover, with a severity.
- red_flags must quote or closely paraphrase the actual job description text that triggered them.
- reasons_for / reasons_against should be specific (name the actual technology or requirement), not generic.
- apply_recommendation: "skip" whenever verdict is "no" or score is weak with no compelling reasons_for; "apply" for strong/good; "maybe" otherwise.`;
}
