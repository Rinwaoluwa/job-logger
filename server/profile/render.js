// Turns the parsed profile into prompt text (profileFull for
// story-selection/write/rewrite/cover-letter/answer stages, profileCompact
// for fit-analysis where the full story text isn't needed) and small
// lookup indexes used by ai/verify.js for traceability checks.

export function allStoryIds(profile) {
  const ids = new Set();
  for (const role of profile.roles) for (const s of role.stories) ids.add(s.id);
  for (const s of profile.behavioral) if (s.status !== "missing") ids.add(s.id);
  for (const p of profile.projects || []) if (p.status !== "draft" && p.use === "prose") ids.add(p.id);
  return ids;
}

export function allMetricIds(profile) {
  const ids = new Set();
  for (const role of profile.roles) for (const m of role.metrics) ids.add(m.id);
  return ids;
}

export function verifiedMetricsIndex(profile) {
  const index = new Map();
  for (const role of profile.roles) {
    for (const m of role.metrics) {
      index.set(m.id, { ...m, roleId: role.id });
    }
  }
  return index;
}

export function findStory(profile, storyId) {
  for (const role of profile.roles) {
    const s = role.stories.find((x) => x.id === storyId);
    if (s) return { ...s, roleId: role.id, roleCompany: role.company };
  }
  const b = profile.behavioral.find((x) => x.id === storyId);
  if (b) return { ...b, roleId: null, roleCompany: null };
  return null;
}

export function resumeEligibleRoles(profile) {
  return profile.roles.filter((r) => r.showOnResume !== false);
}

function renderRoleFull(role, { interviewVersions = true } = {}) {
  const lines = [];
  lines.push(`### Role [${role.id}] ${role.company} — ${role.title} (${role.dates})${role.engagement ? ` — engagement: ${role.engagement}` : ""}`);
  lines.push(`Status: ${role.status}`);
  if (role.context) lines.push(`Context: ${role.context}`);
  if (role.team) lines.push(`Team & my role: ${role.team}`);
  if (role.tech.length) lines.push(`Technologies actually used: ${role.tech.map((t) => t.note ? `${t.name} (${t.note})` : t.name).join(", ")}`);
  if (role.metrics.length) {
    lines.push(`Verified metrics:`);
    for (const m of role.metrics) {
      const note = !m.verified ? "NO — do not use this number" : m.resume === false ? "yes, but NOT for the résumé — do not quote it in a bullet or summary" : "yes";
      lines.push(`- [${m.id}] ${m.text} (verified: ${note})`);
    }
  } else {
    lines.push(`Verified metrics: none — do not put numbers on this role.`);
  }
  if (role.doNotClaim.length) lines.push(`Do NOT claim: ${role.doNotClaim.join("; ")}`);
  lines.push(`Stories:`);
  for (const s of role.stories) {
    lines.push(`  [${s.id}] ${s.title} (status: ${s.status})`);
    if (s.situation) lines.push(`    Situation: ${s.situation}`);
    if (s.whatIDid) lines.push(`    What I did: ${s.whatIDid}`);
    if (s.decisions) lines.push(`    Decisions / trade-offs: ${s.decisions}`);
    if (s.outcome) lines.push(`    Outcome: ${s.outcome}`);
    // The spoken version is a voice sample for first-person prose (cover
    // letters, answers, interview prep). The résumé writer composes fresh
    // in a clean professional register and is not shown it.
    if (interviewVersions && s.interviewVersion && !/^\(/.test(s.interviewVersion)) lines.push(`    How he tells it: ${s.interviewVersion}`);
    if (s.metricIds.length) lines.push(`    Uses metrics: ${s.metricIds.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * @param {object} profile
 * @param {{interviewVersions?: boolean}} [opts] - pass interviewVersions:false
 *   to leave each story's spoken version out (the résumé writer does this).
 */
export function profileFull(profile, { interviewVersions = true } = {}) {
  const { facts, skills, behavioral, roles } = profile;
  const lines = [];

  lines.push(`## Candidate facts`);
  lines.push(`Name: ${facts.header.name || ""}`);
  lines.push(`Years of experience to state: ${facts.years ?? "unspecified"}`);
  lines.push(`Target titles: ${facts.targets.titles || "unspecified"}`);
  lines.push(`Target seniority: ${facts.targets.seniority || "unspecified"}`);
  lines.push(`Target locations: ${facts.targets.locations || "unspecified"}`);
  if (facts.globalDoNotClaim.length) lines.push(`Global do NOT claim: ${facts.globalDoNotClaim.join("; ")}`);
  if (facts.overlapExplanation) lines.push(`Employment overlap explanation: ${facts.overlapExplanation}`);
  if (facts.whyLooking) lines.push(`Why looking / what's next: ${facts.whyLooking}`);

  lines.push(``, `## Skills inventory`);
  for (const s of skills) {
    lines.push(`- ${s.skill} — ${s.proficiency}${s.usedIn.length ? ` (used in: ${s.usedIn.join(", ")})` : ""}${s.notes ? ` — ${s.notes}` : ""}`);
  }
  if (profile.skillsDoNotClaim?.length) lines.push(`Do NOT claim skills: ${profile.skillsDoNotClaim.join("; ")}`);

  lines.push(``, `## Roles (reverse chronological order matters for résumé ordering)`);
  for (const role of resumeEligibleRoles(profile)) {
    lines.push(``, renderRoleFull(role, { interviewVersions }));
  }

  const verifiedBehavioral = behavioral.filter((s) => s.status !== "missing");
  if (verifiedBehavioral.length) {
    lines.push(``, `## General / behavioral stories`);
    for (const s of verifiedBehavioral) {
      lines.push(`[${s.id}] ${s.title}`);
      if (s.s) lines.push(`  Situation: ${s.s}`);
      if (s.t) lines.push(`  Task: ${s.t}`);
      if (s.a) lines.push(`  Action: ${s.a}`);
      if (s.r) lines.push(`  Result: ${s.r}`);
    }
  }

  // Personal and side projects: background for prose only. The résumé
  // writer never sees them (it does not use profileFull), and a project
  // reaches here only once verified and marked "Use: prose".
  const proseProjects = (profile.projects || []).filter((p) => p.status !== "draft" && p.use === "prose");
  if (proseProjects.length) {
    lines.push(``, `## Personal projects (background only — never a résumé entry; may be mentioned in a letter or answer when relevant)`);
    for (const p of proseProjects) {
      lines.push(`[${p.id}] ${p.title}${p.dates ? ` (${p.dates})` : ""}`);
      if (p.stack) lines.push(`  Stack: ${p.stack}`);
      if (p.whatItIs) lines.push(`  What it is: ${p.whatItIs}`);
      if (p.whatIBuilt) lines.push(`  What I built: ${p.whatIBuilt}`);
      if (p.decisions) lines.push(`  Decisions / trade-offs: ${p.decisions}`);
      if (p.outcome) lines.push(`  Outcome: ${p.outcome}`);
    }
  }

  return lines.join("\n");
}

export function profileCompact(profile) {
  const { facts, skills, roles } = profile;
  const lines = [];
  lines.push(`Target titles: ${facts.targets.titles || "unspecified"}; seniority: ${facts.targets.seniority || "unspecified"}`);
  lines.push(`Target locations: ${facts.targets.locations || "unspecified"}`);
  lines.push(`Work authorization — Canada: ${facts.workAuth.canada || "unspecified"}; USA: ${facts.workAuth.usa || "unspecified"}; relocation: ${facts.workAuth.relocation || "unspecified"}`);
  lines.push(`Years of experience: ${facts.years ?? "unspecified"}`);
  lines.push(``, `Skills (name — proficiency):`);
  for (const s of skills) lines.push(`- ${s.skill} — ${s.proficiency}`);
  lines.push(``, `Roles (most recent first):`);
  for (const role of resumeEligibleRoles(profile)) {
    lines.push(`- [${role.id}] ${role.company} — ${role.title} (${role.dates}): ${role.context.slice(0, 240)}`);
    if (role.tech.length) lines.push(`  stack: ${role.tech.map((t) => t.name).join(", ")}`);
  }
  return lines.join("\n");
}

const titleCase = (s) => String(s || "").trim().toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());

/** The name he signs a message with. facts.md may say so outright
 * (first_name:); otherwise the LinkedIn slug usually leads with it
 * (alex-morgan), and the header's first word is the last resort. */
export function signOffName(profile) {
  const h = profile?.facts?.header || {};
  if (h.first_name) return titleCase(h.first_name);
  const slug = String(h.linkedin || "").match(/linkedin\.com\/in\/([a-z]+)/i)?.[1];
  if (slug) return titleCase(slug);
  return titleCase(String(h.name || "").split(/\s+/)[0]);
}

/** Sign-off appended to outreach emails: name, phone, LinkedIn, portfolio,
 * whichever the facts.md header has. The name is title-cased: the header
 * keeps it in capitals for the résumé. */
export function emailSignature(profile) {
  const h = profile?.facts?.header || {};
  return [titleCase(h.name), h.phone, h.linkedin, h.portfolio].map((v) => (v || "").trim()).filter(Boolean).join("\n");
}

export function verifiedMetricsText(profile) {
  const lines = [];
  for (const role of profile.roles) {
    for (const m of role.metrics) {
      // A metric the profile marks "resume: no" is true but not for the page.
      if (m.verified && m.resume !== false) lines.push(`${m.id} | ${m.text}`);
    }
  }
  return lines.length ? lines.join("\n") : "(none — no verified metrics yet; do not use any numbers)";
}

export function skillsTableText(profile) {
  const table = profile.skills
    .filter((s) => s.proficiency !== "familiar")
    .map((s) => `${s.skill} | ${s.proficiency}`)
    .join("\n");
  const glossary = glossaryText(profile);
  return glossary ? `${table}\n\n${glossary}` : table;
}

/** The buzzword glossary as prompt text: which industry terms are true
 * work (say), which only a planned app would earn (gap fill only) and which
 * have no basis (avoid). Empty when the profile has no glossary. */
export function glossaryText(profile) {
  const rows = profile.glossary || [];
  if (!rows.length) return "";
  const lines = rows.map((g) => `${g.term} | ${g.status} | ${g.basis}`);
  return [
    "BUZZWORD GLOSSARY (term | status | basis). \"say\" terms may appear in real-work bullets on the roles named in the basis. \"gap fill only\" terms are not true work history: use them only as a labelled gap fill, never as real work. \"avoid\" terms are never written, not even as a gap fill. Prefer a \"gap fill only\" term when a posting asks for it and nothing else covers it.",
    ...lines,
  ].join("\n");
}

/** Proposed (unbuilt) work as planner-only text. Every entry is labelled as
 * not done, so the planner can build gap-fill ideas from it but never mistakes
 * it for the candidate's history. Empty when the file has no entries. */
export function proposedWorkText(profile) {
  const rows = profile.proposedWork || [];
  if (!rows.length) return "";
  const blocks = rows.map((e) =>
    [`[${e.id}] role ${e.roleId} | ${e.area} | ${e.title}`,
     `  use case: ${e.useCase}`, `  tools: ${e.tools}`, `  how: ${e.how}`, `  impact: ${e.impact}`,
     e.estimate ? `  estimate (the one figure a fill may carry): ${e.estimate}` : "",
     `  keywords: ${e.keywords}`].filter(Boolean).join("\n"));
  return [
    "PROPOSED WORK (NOT DONE: plausible projects per role, for gap fills only). These are not in the candidate's history. Use one ONLY as the basis for a gap fill, on the role named in its entry, when it covers a keyword the profile lacks. Never present one as a story or as real work, and never mix its tools into a role's real bullets.",
    ...blocks,
  ].join("\n\n");
}
