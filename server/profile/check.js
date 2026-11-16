#!/usr/bin/env node
// npm run profile:check — human-readable summary + warnings, for spotting
// duplicate ids, still-draft stories, and unanswered <ask> placeholders
// without starting the server.
import { getProfile } from "./loader.js";
import { denyIndex } from "../ai/coverage.js";

const profile = getProfile();

console.log(`Roles: ${profile.roles.length}`);
for (const role of profile.roles) {
  const draftStories = role.stories.filter((s) => s.status === "draft").length;
  const unverifiedMetrics = role.metrics.filter((m) => !m.verified).length;
  console.log(
    `  [${role.id || "??"}] ${role.company} — ${role.title} | status=${role.status} | stories=${role.stories.length} (draft: ${draftStories}) | metrics=${role.metrics.length} (unverified: ${unverifiedMetrics})`,
  );
}

console.log(`\nSkills: ${profile.skills.length}`);
console.log(`Behavioral stories: ${profile.behavioral.length} (missing: ${profile.behavioral.filter((s) => s.status === "missing").length})`);
console.log(`Projects: ${profile.projects.length} (draft: ${profile.projects.filter((p) => p.status === "draft").length}; offered to prose: ${profile.projects.filter((p) => p.status !== "draft" && p.use === "prose").length})`);

const deny = denyIndex(profile);
console.log(`\nDo NOT claim (enforced deterministically):`);
console.log(`  global: ${[...deny.global].join(", ") || "(none)"}`);
for (const [roleId, set] of deny.byRole) {
  if (set.size) console.log(`  ${roleId}: ${[...set].join(", ")}`);
}
if (deny.softened.length) {
  console.log(`\nNamed in a "Do NOT claim" list but NOT blocked (${deny.softened.length}) —`);
  console.log(`the profile shows the skill actually used, so the prose reads as a nuance`);
  console.log(`rather than a ban. Add "deny_terms: <term>" to that section to make it hard:`);
  for (const s of deny.softened) {
    console.log(`  ${s.term}${s.scope ? ` (${s.scope})` : " (global)"} — "${s.line.slice(0, 80)}..."`);
  }
}

if (profile.warnings.length) {
  console.log(`\nWarnings (${profile.warnings.length}):`);
  for (const w of profile.warnings) console.log(`  [${w.file}] ${w.message}`);
} else {
  console.log(`\nNo warnings.`);
}
