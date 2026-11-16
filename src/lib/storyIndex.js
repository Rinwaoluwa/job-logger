// One flat list of every story in the profile — the role stories and the
// behavioural ones — in a single shape, so the stories list, the rehearse
// deck, the role pages and the job drawer's story chips all read the
// same thing. Built in the browser from GET /api/profile.

import { plainText } from "./profileText.js";
import { PROFILE_HASH_PREFIX } from "./profileHash.js";

const ROLE_STAR = [
  ["situation", "Situation"],
  ["whatIDid", "What I did"],
  ["decisions", "Decisions / trade-offs"],
  ["outcome", "Outcome"],
];
const BEHAVIORAL_STAR = [
  ["s", "Situation"],
  ["t", "Task"],
  ["a", "Action"],
  ["r", "Result"],
];

/** Where a story lives on the Profile tab; `rehearse` opens it as a flashcard. */
export function storyHash(id, { rehearse = false } = {}) {
  const enc = encodeURIComponent(id);
  return rehearse ? `${PROFILE_HASH_PREFIX}/rehearse?story=${enc}` : `${PROFILE_HASH_PREFIX}/story/${enc}`;
}

export function splitCompetencies(text) {
  return String(text || "")
    .split(/[,;]/)
    .map((c) => c.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
}

export function buildStoryIndex(profile) {
  const roles = profile?.roles || [];
  const metricsById = new Map();
  for (const r of roles) {
    for (const m of r.metrics || []) metricsById.set(m.id, { ...m, roleId: r.id, company: r.company });
  }

  const stories = [];
  for (const r of roles) {
    for (const s of r.stories || []) {
      const spokenRaw = (s.interviewVersion || "").trim();
      // A spoken version that opens with "(" is a note about the story
      // ("(see gen-s5)"), not something to say; render.js skips it too.
      const isNote = spokenRaw.startsWith("(");
      const star = ROLE_STAR.map(([key, label]) => ({ key, label, text: s[key] || "" })).filter((f) => f.text);
      const metrics = (s.metricIds || []).map((id) => metricsById.get(id) || { id, text: "", verified: false, resume: false, unresolved: true });
      const competencies = splitCompetencies(s.competencies);
      stories.push({
        id: s.id,
        kind: "role",
        roleId: r.id,
        company: r.company,
        roleTitle: r.title,
        roleDates: r.dates,
        title: s.title,
        status: s.status,
        competencies,
        prompt: "",
        star,
        outcome: s.outcome || "",
        spoken: isNote ? "" : spokenRaw,
        spokenNote: isNote ? spokenRaw : "",
        metrics,
        hash: storyHash(s.id),
        searchText: [s.id, s.title, r.company, competencies.join(" "), ...star.map((f) => plainText(f.text)), plainText(spokenRaw)]
          .join(" ")
          .toLowerCase(),
      });
    }
  }
  for (const b of profile?.behavioral || []) {
    if (b.status === "missing") continue;
    const star = BEHAVIORAL_STAR.map(([key, label]) => ({ key, label, text: b[key] || "" })).filter((f) => f.text);
    stories.push({
      id: b.id,
      kind: "behavioral",
      roleId: null,
      company: "",
      roleTitle: "",
      roleDates: "",
      title: b.title,
      status: b.status,
      competencies: [b.title.toLowerCase()],
      prompt: b.prompt || "",
      star,
      outcome: b.r || "",
      spoken: "",
      spokenNote: "",
      metrics: [],
      hash: storyHash(b.id),
      searchText: [b.id, b.title, ...star.map((f) => plainText(f.text))].join(" ").toLowerCase(),
    });
  }

  const byId = new Map(stories.map((s) => [s.id, s]));

  const counts = new Map();
  for (const s of stories) for (const c of s.competencies) counts.set(c, (counts.get(c) || 0) + 1);
  const competencies = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const projectsById = new Map((profile?.projects || []).map((p) => [p.id, p]));

  const resolve = (rawId) => {
    const id = String(rawId || "").toLowerCase();
    const s = byId.get(id);
    if (s) return { hash: s.hash, label: `${s.company || "Behavioural"} — ${s.title}`, kind: "story" };
    const m = metricsById.get(id);
    if (m) return { hash: `${PROFILE_HASH_PREFIX}/metric/${encodeURIComponent(id)}`, label: m.text, kind: "metric" };
    const p = projectsById.get(id);
    if (p) return { hash: `${PROFILE_HASH_PREFIX}/project/${encodeURIComponent(id)}`, label: p.title, kind: "project" };
    return null;
  };

  return { stories, byId, metricsById, competencies, roles, resolve };
}

export const DEFAULT_FILTERS = { q: "", role: "all", competencies: [], hideDrafts: false };

/** The stories list and the rehearse deck share one filter model. `role`
 *  is a role id, "behavioral", or "all". */
export function applyFilters(stories, filters = DEFAULT_FILTERS) {
  const q = String(filters.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const comps = filters.competencies || [];
  return stories.filter((s) => {
    if (filters.role && filters.role !== "all") {
      if (filters.role === "behavioral" ? s.kind !== "behavioral" : s.roleId !== filters.role) return false;
    }
    if (filters.hideDrafts && s.status === "draft") return false;
    if (comps.length && !comps.some((c) => s.competencies.includes(c))) return false;
    if (q.length && !q.every((term) => s.searchText.includes(term))) return false;
    return true;
  });
}
