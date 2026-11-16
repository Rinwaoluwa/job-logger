// A "brief" is a résumé generated from a job title and a skills list
// rather than from a posting. Each one is backed by a hidden job row
// (source "brief") so the tailor pipeline, document versions, revisions
// and exports all work unchanged; the Résumés tab is the only place it
// shows. Shared by the browser (form parsing, routing) and the server.

export const BRIEF_SOURCE = "brief";

/** "React, TypeScript\nGraphQL" → ["React", "TypeScript", "GraphQL"]. */
export function parseSkills(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(/[,\n;]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** The job's description_text: what answers, the cover letter and the
 * Overview read when there is no posting. */
export function briefText({ title, skills = [], company, notes }) {
  const lines = [`Target role: ${title}`];
  if (company) lines.push(`Company: ${company}`);
  if (skills.length) lines.push(`Skills to feature: ${skills.join(", ")}`);
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push("(Role brief typed by the candidate — not a job posting.)");
  return lines.join("\n");
}
