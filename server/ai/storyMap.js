// The JD-requirement → stories map a résumé's plan already holds. Story
// selection (tailorResume) records, for every posting item it considered,
// which profile stories answer it and how well. That is exactly what an
// interview needs — which story to reach for when a requirement comes up
// — so it is shown on the Interview tab at once, before any prep run, in
// the same item shape the AI prep later fills in with angles.

import { allStoryIds } from "../profile/render.js";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * @param {object|null} resumeDocument - a résumé document row (content_json.plan.jd_coverage)
 * @param {object|null} jdAnalysis - the job's cached analysis, for must-have/responsibility labels
 * @param {object} profile
 * @returns {null | {source: string, resumeDocumentId: number, resumeVersion: number, items: Array}}
 */
export function buildStoryMap(resumeDocument, jdAnalysis, profile) {
  const coverage = resumeDocument?.content_json?.plan?.jd_coverage;
  if (!Array.isArray(coverage) || coverage.length === 0) return null;

  const known = allStoryIds(profile);
  const mustHaves = new Map((jdAnalysis?.must_haves || []).map((m) => [norm(m.text), !!m.critical]));
  const responsibilities = new Set((jdAnalysis?.responsibilities || []).map(norm));

  const items = coverage.map((c) => {
    const key = norm(c.jd_item);
    const isMust = mustHaves.has(key);
    const kind = isMust ? "must_have" : responsibilities.has(key) ? "responsibility" : "nice_to_have";
    return {
      jd_item: String(c.jd_item || "").trim(),
      kind,
      critical: isMust ? mustHaves.get(key) : false,
      strength: ["strong", "partial", "none"].includes(c.strength) ? c.strength : "none",
      stories: (c.story_ids || [])
        .map((id) => String(id).toLowerCase())
        .filter((id) => known.has(id))
        .slice(0, 3)
        .map((story_id) => ({ story_id, angle: null })),
      if_asked: null,
    };
  }).filter((i) => i.jd_item);

  return {
    source: "resume_plan",
    resumeDocumentId: resumeDocument.id,
    resumeVersion: resumeDocument.version,
    items,
  };
}
