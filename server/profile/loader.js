// Loads and caches the profile/ directory. Cache key is the max mtime
// across all profile files, so editing any file (facts.md, a role file,
// etc.) invalidates the cache on the next read without a server restart —
// fixing the old interviewContextCache-never-invalidates bug.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { parseRoleFile, parseFactsFile, parseSkillsFile, parseBehavioralFile, parseProjectsFile, parseProposedWorkFile } from "./parse.js";

const PROFILE_DIR = path.join(config.root, "profile");
const ROLES_DIR = path.join(PROFILE_DIR, "roles");

let cache = null; // { mtimeKey, profile }

function fileMtime(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function computeMtimeKey() {
  const paths = [
    path.join(PROFILE_DIR, "facts.md"),
    path.join(PROFILE_DIR, "skills.md"),
    path.join(PROFILE_DIR, "behavioral.md"),
    path.join(PROFILE_DIR, "projects.md"),
    path.join(PROFILE_DIR, "proposed-work.md"),
  ];
  if (existsSync(ROLES_DIR)) {
    for (const f of readdirSync(ROLES_DIR)) {
      if (f.endsWith(".md")) paths.push(path.join(ROLES_DIR, f));
    }
  }
  return paths.map((p) => `${p}:${fileMtime(p)}`).join("|");
}

function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function loadProfile() {
  const warnings = [];

  const factsText = readIfExists(path.join(PROFILE_DIR, "facts.md"));
  const facts = parseFactsFile(factsText);
  warnings.push(...facts.warnings.map((w) => ({ file: "facts.md", message: w })));

  const skillsText = readIfExists(path.join(PROFILE_DIR, "skills.md"));
  const skillsData = parseSkillsFile(skillsText);
  warnings.push(...skillsData.warnings.map((w) => ({ file: "skills.md", message: w })));

  const behavioralText = readIfExists(path.join(PROFILE_DIR, "behavioral.md"));
  const behavioral = parseBehavioralFile(behavioralText);
  warnings.push(...behavioral.warnings.map((w) => ({ file: "behavioral.md", message: w })));

  // Optional: a missing projects.md means no projects, not an error.
  const proposedData = parseProposedWorkFile(readIfExists(path.join(PROFILE_DIR, "proposed-work.md")));
  warnings.push(...proposedData.warnings.map((w) => ({ file: "proposed-work.md", message: w })));
  const projectsText = readIfExists(path.join(PROFILE_DIR, "projects.md"));
  const projectsData = parseProjectsFile(projectsText);
  warnings.push(...projectsData.warnings.map((w) => ({ file: "projects.md", message: w })));

  const roles = [];
  if (existsSync(ROLES_DIR)) {
    const files = readdirSync(ROLES_DIR).filter((f) => f.endsWith(".md")).sort();
    for (const f of files) {
      const text = readFileSync(path.join(ROLES_DIR, f), "utf8");
      const role = parseRoleFile(text, f);
      warnings.push(...role.warnings.map((w) => ({ file: f, message: w })));
      roles.push(role);
    }
  }
  roles.sort((a, b) => (a.resumeOrder ?? 999) - (b.resumeOrder ?? 999));

  const roleIds = new Set(roles.map((r) => r.id).filter(Boolean));
  const dup = new Set();
  const seen = new Set();
  for (const r of roles) {
    if (r.id && seen.has(r.id)) dup.add(r.id);
    seen.add(r.id);
  }
  for (const id of dup) warnings.push({ file: "roles/", message: `duplicate role id "${id}"` });

  for (const s of skillsData.skills) {
    for (const usedRole of s.usedIn) {
      if (!roleIds.has(usedRole)) warnings.push({ file: "skills.md", message: `skill "${s.skill}" references unknown role id "${usedRole}"` });
    }
  }

  return {
    facts,
    skills: skillsData.skills,
    glossary: skillsData.glossary || [],
    skillsDoNotClaim: skillsData.doNotClaim,
    skillsDoNotClaimTerms: skillsData.doNotClaimTerms || [],
    behavioral: behavioral.stories,
    roles,
    projects: projectsData.projects,
    proposedWork: proposedData.entries,
    warnings,
  };
}

export function getProfile() {
  const mtimeKey = computeMtimeKey();
  if (cache && cache.mtimeKey === mtimeKey) return cache.profile;
  const profile = loadProfile();
  cache = { mtimeKey, profile };
  return profile;
}

export function reloadProfile() {
  cache = null;
  return getProfile();
}
