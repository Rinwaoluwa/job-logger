// Parses the profile/*.md files into structured data. The conventions are
// documented in profile/README.md; kept intentionally simple (line-based,
// no full markdown AST) since these files are hand-edited, not generated.

const STORY_HEADING_RE = /^###\s*\[([a-z0-9-]+-s\d+)\]\s*(.+)$/i;
const METRIC_ITEM_RE = /^-\s*\[([a-z0-9-]+-m\d+)\]\s*(.+?)\s*\|\s*verified:\s*(yes|no)\s*\|\s*resume:\s*(yes|no)\s*$/i;
// Matched against the bullet body, with the leading "- " already
// stripped by the caller — the dash used to be in this pattern too, so
// it never matched and every role's technology list came out empty.
const TECH_ITEM_RE = /^(.+?)(?:\s*\((.+)\))?\s*$/;
const LABEL_RE = /^\*\*([^*:]+):\*\*\s?(.*)$/;

const KNOWN_STORY_LABELS = [
  "Status", "Competencies", "Situation", "What I did",
  "Decisions / trade-offs", "Outcome", "Interview version", "Metrics",
];

function splitLines(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** Folds indented wrapped lines into the logical line above them.
 *
 * Every parser here is line-based, so a hand-wrapped entry —
 *
 *     - OpenAI, on the Northwind role only. Northwind's AI work runs on Meridian Bank's internal
 *       model, not OpenAI — do not let "OpenAI" onto a résumé.
 *
 * — used to be read as just its first physical line, silently truncating
 * the rule mid-sentence. That matters most for the do-not-claim lists,
 * whose whole job is to stop a false claim reaching a document. A blank
 * line ends the logical line; an unindented line starts a new one.
 */
function foldContinuations(sectionLines) {
  const out = [];
  for (const raw of sectionLines) {
    const isIndented = /^\s+\S/.test(raw);
    if (raw.trim() === "") {
      out.push(raw);
      continue;
    }
    const prev = out.length ? out[out.length - 1] : null;
    if (isIndented && prev !== null && prev.trim() !== "") {
      out[out.length - 1] = `${prev.replace(/\s+$/, "")} ${raw.trim()}`;
      continue;
    }
    out.push(raw);
  }
  return out;
}

/** Parses `key: value` lines at the top of a file until the first blank
 * line or the first `## `/`# ` heading. Returns { header, restIndex }. */
function parseHeaderBlock(rawLines) {
  const lines = foldContinuations(rawLines);
  const header = {};
  let i = 0;
  // Skip a leading "# Title" line (and any blank lines around it) before
  // looking for the key: value block.
  while (i < lines.length && (lines[i].trim() === "" || /^#\s+/.test(lines[i]))) {
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) break;
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) header[m[1]] = m[2].trim();
  }
  return { header, restIndex: i };
}

/** Splits the remaining lines into `## Heading` sections, each an array of
 * raw lines (heading excluded). Ignores a leading `# Title` line. */
function splitSections(lines) {
  const sections = {};
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      current = h2[1].trim();
      sections[current] = sections[current] || [];
      continue;
    }
    if (/^#\s+/.test(line)) continue; // top-level title, not a section
    if (current) sections[current].push(line);
  }
  return sections;
}

function parseStories(sectionLines, warnings, fileLabel) {
  const stories = [];
  let current = null;
  let currentLabel = null;

  function flush() {
    if (current) {
      if (!current.fields["Situation"]) warnings.push(`${fileLabel}: story ${current.id} missing Situation`);
      if (!current.fields["Outcome"]) warnings.push(`${fileLabel}: story ${current.id} missing Outcome`);
      stories.push(current);
    }
  }

  for (const raw of sectionLines) {
    const line = raw;
    const storyMatch = line.match(STORY_HEADING_RE);
    if (storyMatch) {
      flush();
      current = { id: storyMatch[1].toLowerCase(), title: storyMatch[2].trim(), fields: {}, raw: {} };
      currentLabel = null;
      continue;
    }
    if (!current) continue;
    const labelMatch = line.match(LABEL_RE);
    if (labelMatch) {
      const label = labelMatch[1].trim();
      currentLabel = label;
      current.fields[label] = (current.fields[label] ? current.fields[label] + "\n" : "") + labelMatch[2];
      current.raw[label] = (current.raw[label] ? current.raw[label] + "\n" : "") + labelMatch[2];
      if (!KNOWN_STORY_LABELS.includes(label)) {
        warnings.push(`${fileLabel}: story ${current.id} has unknown label "${label}"`);
      }
      continue;
    }
    if (currentLabel && line.trim() !== "") {
      current.fields[currentLabel] += "\n" + line;
    }
    // The prompt text (`fields`) drops blank lines, which the renderers
    // depend on. The Profile tab wants the paragraph breaks a story was
    // written with, so a second copy keeps them. Nothing in the AI
    // pipelines reads `verbatim`.
    if (currentLabel) current.raw[currentLabel] += "\n" + line;
  }
  flush();

  return stories.map((s) => ({
    id: s.id,
    title: s.title,
    status: (s.fields["Status"] || "draft").trim().toLowerCase(),
    competencies: (s.fields["Competencies"] || "").trim(),
    situation: (s.fields["Situation"] || "").trim(),
    whatIDid: (s.fields["What I did"] || "").trim(),
    decisions: (s.fields["Decisions / trade-offs"] || "").trim(),
    outcome: (s.fields["Outcome"] || "").trim(),
    interviewVersion: (s.fields["Interview version"] || "").trim(),
    metricIds: (s.fields["Metrics"] || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    verbatim: {
      situation: (s.raw["Situation"] || "").trim(),
      whatIDid: (s.raw["What I did"] || "").trim(),
      decisions: (s.raw["Decisions / trade-offs"] || "").trim(),
      outcome: (s.raw["Outcome"] || "").trim(),
      interviewVersion: (s.raw["Interview version"] || "").trim(),
    },
  }));
}

function parseMetrics(sectionLines, warnings, fileLabel) {
  const metrics = [];
  for (const line of foldContinuations(sectionLines)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith("- none")) continue;
    const m = trimmed.match(METRIC_ITEM_RE);
    if (m) {
      metrics.push({ id: m[1].toLowerCase(), text: m[2].trim(), verified: m[3].toLowerCase() === "yes", resume: m[4].toLowerCase() === "yes" });
    } else if (trimmed.startsWith("-")) {
      warnings.push(`${fileLabel}: unparsable metric line: "${trimmed}"`);
    }
  }
  return metrics;
}

function parseTechList(sectionLines) {
  const items = [];
  for (const line of foldContinuations(sectionLines)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const body = trimmed.replace(/^-\s*/, "");
    const m = body.match(TECH_ITEM_RE);
    if (m) items.push({ name: m[1].trim(), note: (m[2] || "").trim() });
  }
  return items;
}

function parseBulletList(sectionLines) {
  return foldContinuations(sectionLines)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

/**
 * A "Do NOT claim" section may carry a machine-readable
 * `deny_terms: OpenAI, Azure` line. Those terms are absolute — the
 * deterministic checker in ai/coverage.js blocks them outright, rather
 * than inferring intent from the surrounding prose. The prose itself is
 * left untouched for the prompts.
 */
function parseDenyTerms(sectionLines) {
  const terms = [];
  for (const line of sectionLines || []) {
    const m = /^\s*deny_terms:\s*(.+)$/i.exec(line);
    if (m) terms.push(...m[1].split(",").map((t) => t.trim()).filter(Boolean));
  }
  return terms;
}

function joinFreeText(sectionLines) {
  return sectionLines.join("\n").trim();
}

const ROLE_SECTION_NAMES = {
  context: "Company & product context",
  team: "Team & my role",
  built: "What I built",
  tech: "Technologies actually used",
  metrics: "Verified metrics",
  stories: "Stories",
  doNotClaim: "Do NOT claim",
  notes: "Notes",
};

const KNOWN_ROLE_SECTIONS = new Set(Object.values(ROLE_SECTION_NAMES));

export function parseRoleFile(text, fileLabel) {
  const warnings = [];
  const lines = splitLines(text);
  const { header, restIndex } = parseHeaderBlock(lines);
  const sections = splitSections(lines.slice(restIndex));

  for (const name of Object.keys(sections)) {
    if (!KNOWN_ROLE_SECTIONS.has(name)) warnings.push(`${fileLabel}: unknown section heading "## ${name}"`);
  }

  const stories = parseStories(sections[ROLE_SECTION_NAMES.stories] || [], warnings, fileLabel);
  const metrics = parseMetrics(sections[ROLE_SECTION_NAMES.metrics] || [], warnings, fileLabel);

  const seenStoryIds = new Set();
  for (const s of stories) {
    if (seenStoryIds.has(s.id)) warnings.push(`${fileLabel}: duplicate story id ${s.id}`);
    seenStoryIds.add(s.id);
  }
  const seenMetricIds = new Set();
  for (const m of metrics) {
    if (seenMetricIds.has(m.id)) warnings.push(`${fileLabel}: duplicate metric id ${m.id}`);
    seenMetricIds.add(m.id);
    if (!m.verified) warnings.push(`${fileLabel}: metric ${m.id} is unverified ("${m.text}")`);
  }
  for (const s of stories) {
    if (s.status === "draft") warnings.push(`${fileLabel}: story ${s.id} is still a draft`);
  }

  return {
    id: header.id || null,
    company: header.company || null,
    title: header.title || null,
    dates: header.dates || null,
    location: header.location || null,
    employmentType: header.employment_type || null,
    // Free text printed after the title on the résumé ("Full-time, 40
    // hrs/week", "Contract, task-based"), for overlapping roles. Optional.
    engagement: header.engagement || null,
    status: (header.status || "draft").toLowerCase(),
    showOnResume: header.show_on_resume !== "no",
    resumeOrder: header.resume_order ? Number(header.resume_order) : 999,
    context: joinFreeText(sections[ROLE_SECTION_NAMES.context] || []),
    team: joinFreeText(sections[ROLE_SECTION_NAMES.team] || []),
    built: parseBulletList(sections[ROLE_SECTION_NAMES.built] || []),
    tech: parseTechList(sections[ROLE_SECTION_NAMES.tech] || []),
    metrics,
    stories,
    doNotClaim: parseBulletList(sections[ROLE_SECTION_NAMES.doNotClaim] || []),
    doNotClaimTerms: parseDenyTerms(sections[ROLE_SECTION_NAMES.doNotClaim] || []),
    notes: joinFreeText(sections[ROLE_SECTION_NAMES.notes] || []),
    warnings,
  };
}

export function parseFactsFile(text) {
  const warnings = [];
  const lines = splitLines(text);
  const sections = splitSections(lines);

  const header = {};
  for (const line of foldContinuations(sections["Header"] || [])) {
    const m = line.trim().match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) header[m[1]] = m[2].trim();
  }

  const targets = {};
  for (const line of foldContinuations(sections["Targets"] || [])) {
    const m = line.trim().match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) targets[m[1]] = m[2].trim();
  }

  const workAuth = {};
  for (const line of foldContinuations(sections["Work authorization"] || [])) {
    const m = line.trim().match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) workAuth[m[1]] = m[2].trim();
  }

  const timeline = [];
  let overlapExplanation = "";
  // The other `key: value` notes in the timeline section (where the work
  // was done from, the tails after each end date, the study overlap) are
  // interview framing the Profile tab shows; the prompts read only
  // overlap_explanation, as before.
  const timelineNotes = {};
  for (const line of foldContinuations(sections["Employment timeline (truth)"] || [])) {
    const trimmed = line.trim();
    if (trimmed.startsWith("overlap_explanation:")) {
      overlapExplanation = trimmed.replace(/^overlap_explanation:\s*/, "").trim();
      continue;
    }
    const kv = trimmed.match(/^([a-z0-9_]+):\s*(.*)$/i);
    if (kv) {
      timelineNotes[kv[1]] = kv[2].trim();
      continue;
    }
    if (!trimmed.startsWith("-")) continue;
    const parts = trimmed.replace(/^-\s*/, "").split("|").map((p) => p.trim());
    const [id, company, title, dates, employmentType, showOnResume] = parts;
    timeline.push({ id, company, title, dates, employmentType, showOnResume: showOnResume !== "show on résumé: no" && showOnResume !== "no" });
    if (id && !/ask/i.test(employmentType || "") && !employmentType) {
      warnings.push(`facts.md: timeline entry ${id} missing employment type`);
    }
  }

  const education = parseBulletList(sections["Education"] || []);
  const certifications = parseBulletList(sections["Certifications"] || []);
  const globalDoNotClaim = parseBulletList(sections["Do NOT claim (global)"] || []);
  const globalDoNotClaimTerms = parseDenyTerms(sections["Do NOT claim (global)"] || []);
  const whyLooking = joinFreeText(sections["Why looking / what next"] || []);

  let years = null;
  for (const line of (sections["Years of experience to state"] || [])) {
    const m = line.trim().match(/^years:\s*(\d+)/);
    if (m) years = Number(m[1]);
  }

  for (const key of Object.keys(targets)) {
    if (String(targets[key]).includes("<ask")) warnings.push(`facts.md: targets.${key} still needs an answer`);
  }
  for (const key of Object.keys(workAuth)) {
    if (String(workAuth[key]).includes("<ask")) warnings.push(`facts.md: work_authorization.${key} still needs an answer`);
  }

  return { header, targets, workAuth, timeline, timelineNotes, overlapExplanation, education, certifications, globalDoNotClaim, globalDoNotClaimTerms, whyLooking, years, warnings };
}

export function parseSkillsFile(text) {
  const warnings = [];
  const lines = splitLines(text);
  const sections = splitSections(lines);
  const skills = [];

  const tableLines = (sections["Skills"] || lines).filter((l) => l.trim().startsWith("|"));
  for (const line of tableLines) {
    const cells = line.split("|").map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));
    if (cells.length < 4) continue;
    const [skill, proficiency, usedIn, notes] = cells;
    if (/^-+$/.test(skill) || skill.toLowerCase() === "skill") continue; // header/divider row
    skills.push({
      skill,
      proficiency: proficiency.toLowerCase(),
      usedIn: usedIn.split(",").map((s) => s.trim()).filter(Boolean),
      notes: notes || "",
    });
  }

  // Buzzword glossary: term | status | basis. The status's first word decides
  // how the pipeline may use the term (say / planned / avoid).
  const glossary = [];
  for (const line of (sections["Buzzword glossary"] || []).filter((l) => l.trim().startsWith("|"))) {
    const cells = line.split("|").map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));
    if (cells.length < 3) continue;
    const [term, status, basis] = cells;
    if (/^-+$/.test(term) || term.toLowerCase() === "term") continue;
    glossary.push({ term, status, basis });
  }

  const doNotClaim = parseBulletList(sections["Do NOT claim"] || []);
  const doNotClaimTerms = parseDenyTerms(sections["Do NOT claim"] || []);

  const validProficiencies = new Set(["expert", "strong", "working", "familiar"]);
  for (const s of skills) {
    if (!validProficiencies.has(s.proficiency)) warnings.push(`skills.md: "${s.skill}" has unknown proficiency "${s.proficiency}"`);
  }

  return { skills, glossary, doNotClaim, doNotClaimTerms, warnings };
}

export function parseBehavioralFile(text) {
  const warnings = [];
  const lines = splitLines(text);
  const sections = splitSections(lines);
  const stories = [];
  let idx = 0;
  for (const [heading, sectionLines] of Object.entries(sections)) {
    idx += 1;
    const id = `gen-s${idx}`;
    const fields = {};
    let currentLabel = null;
    // An HTML comment in a section is a note to the editor, not part of
    // the story; it used to ride along on the last field it followed.
    const cleaned = splitLines(sectionLines.join("\n").replace(/<!--[\s\S]*?-->/g, ""));
    for (const raw of cleaned) {
      const m = raw.match(/^-\s*\*\*([^*:]+):\*\*\s?(.*)$/);
      if (m) {
        currentLabel = m[1].trim();
        fields[currentLabel] = m[2] || "";
        continue;
      }
      if (currentLabel && raw.trim() !== "") fields[currentLabel] += "\n" + raw.trim();
    }
    const hasContent = Object.values(fields).some((v) => v && v.trim());
    stories.push({
      id,
      title: heading,
      status: hasContent ? "verified" : "missing",
      prompt: (fields["Prompt"] || "").trim(),
      s: (fields["S"] || "").trim(),
      t: (fields["T"] || "").trim(),
      a: (fields["A"] || "").trim(),
      r: (fields["R"] || "").trim(),
    });
    if (!hasContent) warnings.push(`behavioral.md: "${heading}" has no content yet`);
  }
  return { stories, warnings };
}

// ---------------------------------------------------------------------------
// profile/projects.md — personal and side projects. One `### [proj-slug]
// Title` block per project with labelled fields, the same shape as a role
// story so the file reads like the rest of the profile. Projects never go
// on the résumé page (the user's decision, 2026-10-11); a project whose
// `Use` is "prose" and whose status is verified is offered to the cover
// letter, application answers and interview prep as background.

const PROJECT_HEADING_RE = /^###\s*\[(proj-[a-z0-9-]+)\]\s*(.+)$/i;
const KNOWN_PROJECT_LABELS = [
  "Status", "Dates", "Link", "Stack", "What it is", "What I built",
  "Decisions / trade-offs", "Outcome", "Use",
];

export function parseProjectsFile(text) {
  const warnings = [];
  const lines = splitLines(text || "");
  const projects = [];
  let current = null;
  let currentLabel = null;

  function flush() {
    if (!current) return;
    if (!current.fields["What it is"]) warnings.push(`projects.md: project ${current.id} missing "What it is"`);
    projects.push(current);
  }

  for (const line of lines) {
    const head = line.match(PROJECT_HEADING_RE);
    if (head) {
      flush();
      current = { id: head[1].toLowerCase(), title: head[2].trim(), fields: {} };
      currentLabel = null;
      continue;
    }
    if (!current) continue;
    const labelMatch = line.match(LABEL_RE);
    if (labelMatch) {
      const label = labelMatch[1].trim();
      currentLabel = label;
      current.fields[label] = (current.fields[label] ? current.fields[label] + "\n" : "") + labelMatch[2];
      if (!KNOWN_PROJECT_LABELS.includes(label)) warnings.push(`projects.md: project ${current.id} has unknown label "${label}"`);
      continue;
    }
    if (currentLabel && line.trim() !== "") current.fields[currentLabel] += "\n" + line;
  }
  flush();

  const seen = new Set();
  const out = projects.map((p) => {
    if (seen.has(p.id)) warnings.push(`projects.md: duplicate project id ${p.id}`);
    seen.add(p.id);
    const f = (k) => (p.fields[k] || "").trim();
    const status = (f("Status") || "draft").toLowerCase();
    const use = (f("Use") || "none").toLowerCase();
    if (status === "draft") warnings.push(`projects.md: project ${p.id} is still a draft`);
    if (!["prose", "none"].includes(use)) warnings.push(`projects.md: project ${p.id} has unknown Use "${use}" (prose | none)`);
    return {
      id: p.id,
      title: p.title,
      status,
      dates: f("Dates"),
      link: f("Link"),
      stack: f("Stack"),
      whatItIs: f("What it is"),
      whatIBuilt: f("What I built"),
      decisions: f("Decisions / trade-offs"),
      outcome: f("Outcome"),
      // "prose": offered to cover letters, answers and interview prep once
      // verified. "none": shown on the Profile tab only. Never the résumé.
      use,
    };
  });
  return { projects: out, warnings };
}

// ---------------------------------------------------------------------------
// profile/proposed-work.md — plausible, UNBUILT work per role. One `### [pw-
// role-N] Title` block per entry. It feeds only the résumé gap-fill planner
// and is never a fact about what happened (2026-10-21).

const PW_HEADING_RE = /^###\s*\[(pw-[a-z0-9-]+)\]\s*(.+)$/i;
const KNOWN_PW_LABELS = ["Role", "Area", "Use case", "Tools", "How", "Impact", "Estimate", "Keywords", "Be ready to explain"];

export function parseProposedWorkFile(text) {
  const warnings = [];
  const entries = [];
  let current = null;
  let currentLabel = null;
  for (const line of splitLines(text || "")) {
    const head = line.match(PW_HEADING_RE);
    if (head) {
      if (current) entries.push(current);
      current = { id: head[1].toLowerCase(), title: head[2].trim(), fields: {} };
      currentLabel = null;
      continue;
    }
    if (!current) continue;
    const m = line.match(LABEL_RE);
    if (m) {
      currentLabel = m[1].trim();
      current.fields[currentLabel] = (current.fields[currentLabel] ? current.fields[currentLabel] + "\n" : "") + m[2];
      if (!KNOWN_PW_LABELS.includes(currentLabel)) warnings.push(`proposed-work.md: ${current.id} has unknown label "${currentLabel}"`);
      continue;
    }
    if (currentLabel && line.trim() !== "" && !line.startsWith("## ")) current.fields[currentLabel] += "\n" + line;
  }
  if (current) entries.push(current);

  const seen = new Set();
  const out = entries.map((e) => {
    if (seen.has(e.id)) warnings.push(`proposed-work.md: duplicate id ${e.id}`);
    seen.add(e.id);
    const f = (k) => (e.fields[k] || "").trim();
    for (const k of ["Role", "Use case", "Tools", "How", "Impact"]) {
      if (!f(k)) warnings.push(`proposed-work.md: ${e.id} missing "${k}"`);
    }
    return {
      id: e.id, title: e.title, roleId: f("Role").toLowerCase(), area: f("Area"), useCase: f("Use case"),
      tools: f("Tools"), how: f("How"), impact: f("Impact"), estimate: f("Estimate"),
      keywords: f("Keywords"), beReady: f("Be ready to explain"),
    };
  });
  return { entries: out, warnings };
}
