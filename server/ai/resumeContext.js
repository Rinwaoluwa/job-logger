// The finished résumé, rendered for a prompt. The cover letter and the
// application answers are written AFTER the résumé and must agree with
// it: same title, same technologies, same achievements — including the
// gap fills the résumé carries by the candidate's choice. So they read
// the résumé as it exports (gap fills on unless rejected, held estimates
// off), the same view resumePdf prints, rather than the plan it was
// written from.

import { applyReview, isInventedReason } from "../../shared/applyReview.js";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * @param {object} document - a résumé document row (content_json + review_decisions)
 * @returns {{ text: string, gapFills: Array<{text: string, reason: string}>, documentId: number, version: number }}
 */
export function resumeContext(document) {
  const contentJson = document.content_json || {};
  const decisions = document.review_decisions || {};
  const resume = applyReview(contentJson, decisions, { mode: "export" });

  const lines = [];
  if (clean(resume.target_title)) lines.push(`TITLE: ${clean(resume.target_title)}`);
  if (clean(resume.professional_summary)) lines.push("", "SUMMARY", clean(resume.professional_summary));

  const groups = (resume.skill_groups || []).filter((g) => (g.items || []).length);
  if (groups.length) {
    lines.push("", "SKILLS");
    for (const g of groups) lines.push(`${clean(g.title)}: ${g.items.map(clean).filter(Boolean).join(", ")}`);
  }

  if ((resume.certifications || []).length) {
    lines.push("", "CERTIFICATIONS");
    for (const c of resume.certifications) lines.push(`- ${clean(c)}`);
  }

  const roles = resume.experience || [];
  if (roles.length) {
    lines.push("", "EXPERIENCE");
    for (const role of roles) {
      const head = [clean(role.company), clean(role.title)].filter(Boolean).join(" — ");
      const side = [clean(role.location), clean(role.dates)].filter(Boolean).join(" | ");
      lines.push("", side ? `${head} (${side})` : head);
      for (const b of role.bullets || []) {
        const text = clean(typeof b === "string" ? b : b?.text);
        if (text) lines.push(`- ${text}`);
      }
    }
  }

  if ((resume.education || []).length) {
    lines.push("", "EDUCATION");
    for (const e of resume.education) lines.push(`- ${clean(e)}`);
  }

  // The placements that depart from the profile and are on the page: every
  // gap-fill entry (bullet, skill or summary term) and every reframed
  // bullet the candidate has not rejected. A rejected reframe prints its
  // real-stack wording, which the export text above already carries.
  const gapFills = (contentJson.additions_to_review || [])
    .filter((a) => isInventedReason(a) && !a.blocking && decisions[a.id] !== "rejected")
    .map((a) => ({ text: clean(a.text), reason: clean(a.reason) }))
    .filter((a) => a.text);

  return { text: lines.join("\n").trim(), gapFills, documentId: document.id, version: document.version };
}

/** The prompt section both prose writers share. Empty when there is no résumé. */
export function resumePromptSection(rc) {
  if (!rc) return "";
  const fills = rc.gapFills.length
    ? `\n\nRÉSUMÉ CLAIMS THAT DEPART FROM THE PROFILE (on the résumé by the candidate's choice: gap fills, and reframed bullets whose reason begins "Reframed:", which are real work the résumé presents in the posting's framework; for that work name the framework the résumé names, never the profile's. Use them as freely as the rest; copy each one you draw on into inferred_claims with the reason "From résumé: <first words of the claim>"):\n${rc.gapFills.map((f) => `- ${f.text}`).join("\n")}`
    : "";
  return `THE RÉSUMÉ THE CANDIDATE IS SENDING (the source of truth for what he claims — title, technologies, achievements, figures; never contradict it, never add a concrete claim that is on neither the résumé nor the profile):
<resume>
${rc.text.replaceAll("</resume>", "<​/resume>")}
</resume>${fills}`;
}
