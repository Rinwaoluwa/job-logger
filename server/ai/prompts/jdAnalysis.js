function escapeTag(text, tag) {
  return String(text || "").replaceAll(`</${tag}>`, `<​/${tag}>`);
}

export function jdAnalysisPrompt({ jdText }) {
  return `Analyse this job description for a software engineer applying to it.

<job_description>
${escapeTag(jdText, "job_description")}
</job_description>

Rules:
- must_haves are requirements the posting states as required (phrased with "must", "required", "X+ years", or similar) — do not invent requirements it doesn't state. Mark "critical": true when the posting phrases it as a hard requirement.
- nice_to_haves are things phrased as preferred/bonus/nice-to-have.
- location_constraints must be direct claims from the text (e.g. "must be based in Ontario", "requires US work authorization") — do not infer constraints that aren't stated.
- keywords are ATS-relevant terms exactly as they appear in the posting (technologies, methodologies, practices, domain skills); every technology named in must_haves or nice_to_haves must also appear here. Every keyword must be something a résumé bullet or skills entry could plausibly evidence. Do not include the company's description of itself or its goals ("engineering velocity", "resilient systems", "world-class team"), the people the product serves ("annotators", "ML researchers") unless serving them is a stated requirement, or generic nouns ("software", "team"). Those belong in product_summary or domain, not in keywords.
- red_flags: note seniority far outside 3-8 years of experience, any visa/citizenship/security-clearance requirement, onsite work outside the Greater Vancouver Area, unpaid or commission-only compensation, or anything else a candidate should notice before applying.
- product_summary: 1-2 sentences on what the team actually builds, in plain language.`;
}

/**
 * The same analysis, built from a role brief (a title, optional skills,
 * company and notes) instead of a posting. The model fills in what a
 * typical posting for that title would ask for, so a title alone still
 * gives the planner something concrete to map stories and gap fills to.
 */
export function roleBriefPrompt({ title, skills = [], company = null, notes = "" }) {
  return `There is no job posting. The candidate, a software engineer, typed a short brief for the kind of role they want a résumé for. Produce the same job analysis you would for a real posting, filled in with what a typical posting for this title asks for.

<role_brief>
Title: ${escapeTag(title, "role_brief")}
Company: ${company ? escapeTag(company, "role_brief") : "(not given)"}
Skills the candidate wants featured: ${skills.length ? escapeTag(skills.join(", "), "role_brief") : "(none given — infer the usual stack for the title)"}
Notes: ${notes ? escapeTag(notes, "role_brief") : "(none)"}
</role_brief>

Rules:
- role_title is the title exactly as typed. company is the company as typed, or null.
- seniority: infer from the title ("Senior", "Staff", "Lead", "Junior"); "mid" when the title does not say.
- must_haves: every skill the candidate listed is a must-have with "critical": true, in the candidate's own spelling, with its best category. Then add the hard requirements a typical posting for this title states (the core language or framework, years of experience, testing, version control, the usual infrastructure), each "critical": false. Stay within 15 in total.
- nice_to_haves: what such postings usually list as preferred or bonus — adjacent tools, cloud, CI/CD, observability, domain experience.
- keywords (8-25): every listed skill word for word, plus the technologies, methodologies and practices a posting for this title would name. Each must be something a résumé bullet or skills entry could evidence; no generic nouns ("software", "team"), no company slogans, and not the job title itself.
- responsibilities (3-10): the typical duties of the role, as a posting would phrase them.
- work_mode "unknown", location null, location_constraints [], red_flags [] — the brief states none.
- product_summary: one sentence saying this is a role brief the candidate wrote, not a posting, and what the role typically builds.
- domain: from the notes or company when they say; otherwise "general".
- tone: "formal".`;
}
