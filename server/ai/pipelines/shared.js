// Shared helpers used by more than one pipeline: JD analysis, story
// selection, and the "no JD provided" fallbacks for a generic résumé.

import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import {
  jdAnalysisSchema, storySelectionSchema, TARGET_BULLETS_PER_ROLE, MAX_BULLET_FILLS_PER_ROLE, MAX_BULLET_FILLS_TOTAL,
  MAX_STRONG_FILLS, gapFillRoles,
} from "../schemas.js";
import { jdAnalysisPrompt, roleBriefPrompt } from "../prompts/jdAnalysis.js";
import { storySelectionPrompt } from "../prompts/storySelection.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/system.js";
import { resumeEligibleRoles } from "../../profile/render.js";
import { denyIndex, matchTerm, canonKey, namesTech } from "../coverage.js";

export function buildGenericSelection(profile) {
  const roles = resumeEligibleRoles(profile);
  // Bullets are composed from the role's context, not only its stories,
  // so a role with one story still gets the target.
  return {
    summary_angle: "General résumé, no posting. Open with the first profile target title and the years to state; take the two or three areas of practice, the outcomes and the teams from the profile's strongest skills and roles. Same four-part shape as a tailored summary.",
    role_plan: roles.map((role) => ({
      role_id: role.id,
      bullet_count: TARGET_BULLETS_PER_ROLE,
      story_ids: role.stories.map((s) => s.id),
      technologies_to_show: [],
      angle: "Represent this role faithfully in résumé order.",
    })),
    jd_coverage: [],
    skills_to_feature: profile.skills.filter((s) => s.proficiency !== "familiar").map((s) => s.skill),
    gaps: [],
    gap_fills: [],
    reframes: [],
  };
}

const eitherWay = (a, b) => namesTech(a, b) || namesTech(b, a);

/**
 * The plan's reframes, checked against the profile (the planner proposes;
 * the code decides). A reframe survives only when its technology is on the
 * role's "Technologies actually used" and on no Do NOT claim list, at least
 * one of its `replaces` is on that list too, and the posting does not ask
 * for a replaced technology itself. One per role. A kept reframe also fixes
 * the role's technologies_to_show: the reframe technology in, the replaced
 * ones out. Without a profile nothing survives (fail closed).
 */
function normalizeReframes(selection, { profile, jdAnalysis, log }) {
  const proposed = Array.isArray(selection.reframes) ? selection.reframes : [];
  selection.reframes = [];
  if (proposed.length === 0) return;
  if (!profile) {
    log(`${proposed.length} reframe(s) dropped: no profile to validate against`);
    return;
  }
  const deny = denyIndex(profile);
  const roles = new Map(resumeEligibleRoles(profile).map((r) => [r.id, r]));
  const askedFor = [
    ...(jdAnalysis?.must_haves || []).map((m) => m?.text),
    ...(jdAnalysis?.nice_to_haves || []).map((m) => m?.text),
    ...(jdAnalysis?.keywords || []),
  ].map((t) => String(t || "").trim()).filter(Boolean);
  const seen = new Set();
  const kept = [];
  for (const r of proposed) {
    const technology = String(r?.technology || "").trim();
    const label = `reframe ${r?.role_id} -> ${technology || "?"}`;
    const role = roles.get(r?.role_id);
    if (!role || !technology) { log(`${label}: dropped (unknown or hidden role, or no technology)`); continue; }
    if (seen.has(role.id)) { log(`${label}: dropped (one reframe per role)`); continue; }
    const listed = (role.tech || []).map((t) => t.name);
    const onList = (term) => listed.some((name) => eitherWay(term, name));
    if (!onList(technology)) {
      log(`${label}: dropped ("${technology}" is not in the role's "Technologies actually used"; a gap fill is the way to claim it)`);
      continue;
    }
    const key = canonKey(technology);
    if (deny.global.has(key) || deny.byRole.get(role.id)?.has(key)) { log(`${label}: dropped ("${technology}" is on a Do NOT claim list)`); continue; }
    const replaces = [...new Set((r.replaces || []).map((t) => String(t || "").trim()).filter(Boolean))]
      .filter((t) => onList(t) && !eitherWay(t, technology));
    if (replaces.length === 0) { log(`${label}: dropped (nothing on the role's list to replace)`); continue; }
    let asked = null;
    for (const t of replaces) {
      const k = askedFor.find((kw) => eitherWay(t, kw));
      if (k) { asked = { t, k }; break; }
    }
    if (asked) { log(`${label}: dropped (the posting asks for "${asked.k}", which "${asked.t}" would replace; the role shows its real stack)`); continue; }
    seen.add(role.id);
    const plan = (selection.role_plan || []).find((pl) => pl.role_id === role.id);
    if (plan) {
      const shown = (plan.technologies_to_show || []).filter((t) => !replaces.some((x) => eitherWay(x, t)));
      if (!shown.some((t) => eitherWay(t, technology))) shown.push(technology);
      plan.technologies_to_show = shown;
    }
    kept.push({ role_id: role.id, technology, replaces, note: String(r.note || "") });
  }
  selection.reframes = kept;
}

/** Up to this many proposed-work fills are added by code when the planner
 * added none (proposed-work.md; the prompt asks for them too, but a prompt-only
 * rule was ignored on the first test run, 2026-10-21). */
const MAX_PROPOSED_ENRICHMENT_FILLS = 2;
const MAX_SKILL_FILLS = 3;

/**
 * Adds standard bullet fills built from the profile's proposed work (unbuilt,
 * plausible work per role) when the plan has fewer than two of them. An entry
 * qualifies when its keywords overlap the posting's own terms; the best
 * overlaps go first, one per role, and a role that already carries a fill is
 * skipped. Runs before the fill caps, so they still bind. Mutates `selection`.
 */
export function enrichWithProposedWork(selection, { profile, jdAnalysis, log = () => {} }) {
  const entries = profile?.proposedWork || [];
  if (!entries.length || !jdAnalysis) return;
  const fills = selection.gap_fills || [];
  const used = fills.filter((f) => /\[pw-[a-z0-9-]+\]/i.test(f.idea || "")).length;
  const room = MAX_PROPOSED_ENRICHMENT_FILLS - used;
  if (room <= 0) return;

  const roleIds = new Set((profile.roles || []).map((r) => r.id));
  const postingTerms = [
    ...(jdAnalysis.keywords || []),
    ...(jdAnalysis.must_haves || []).map((m) => m.text),
    ...(jdAnalysis.nice_to_haves || []).map((m) => m.text),
  ].map((t) => String(t).trim()).filter(Boolean);
  const takenRoles = new Set(fills.flatMap((f) => f.role_ids || []));
  const taken = new Set(fills.map((f) => (f.idea || "").match(/\[(pw-[a-z0-9-]+)\]/i)?.[1]?.toLowerCase()).filter(Boolean));

  const scored = [];
  for (const e of entries) {
    if (!roleIds.has(e.roleId) || taken.has(e.id)) continue;
    const terms = e.keywords.split(",").map((k) => k.trim()).filter(Boolean);
    const hits = [];
    for (const term of terms) {
      const lower = term.toLowerCase();
      const match = postingTerms.find((t) => {
        const tl = t.toLowerCase();
        return tl === lower || (lower.length > 3 && (tl.includes(lower) || lower.includes(tl)) && tl.length > 3);
      });
      if (match) hits.push(match);
    }
    if (hits.length) scored.push({ e, hits: [...new Set(hits)] });
  }
  scored.sort((a, b) => b.hits.length - a.hits.length);

  let added = 0;
  for (const { e, hits } of scored) {
    if (added >= room) break;
    if (takenRoles.has(e.roleId)) continue;
    takenRoles.add(e.roleId);
    fills.push({
      requirement: e.title,
      keywords: hits.slice(0, 4),
      role_ids: [e.roleId],
      emphasis: "standard",
      kind: "bullet",
      idea: `[${e.id}] ${e.useCase} Built with ${e.tools}. ${e.how} ${e.impact} Estimated figure: ${e.estimate}.`,
    });
    added++;
    log(`added proposed-work fill ${e.id} (${hits.join(", ")})`);
  }
  selection.gap_fills = fills;
}

/**
 * The plan's hard limits, applied in code rather than trusted to the
 * prompt. Every role is planned at the target count (the floor is for the
 * trim, not the plan); gap-fill bullets are capped per role and in total;
 * strong fills past their cap become standard; and a bullet fill left with
 * no room is dropped into `gaps`, so the user still sees the requirement.
 * Strong fills are placed first so a must-have never loses its slot to a
 * nice-to-have. Mutates and returns `selection`.
 */
export function normalizePlan(selection, { log = (m) => console.warn(`[plan] ${m}`), profile = null, jdAnalysis = null } = {}) {
  enrichWithProposedWork(selection, { profile, jdAnalysis, log });
  for (const plan of selection.role_plan || []) {
    plan.bullet_count = Math.min(5, Math.max(TARGET_BULLETS_PER_ROLE, plan.bullet_count || 0));
  }

  const perRole = new Map();
  let total = 0;
  let strong = 0;
  let skillFills = 0;
  const kept = [];
  const fills = selection.gap_fills || [];
  const ordered = [...fills.filter((f) => f.emphasis === "strong"), ...fills.filter((f) => f.emphasis !== "strong")];
  // One role per fill technology: a standard bullet fill whose keywords are
  // all carried by an earlier fill is dropped, so Kafka or Terraform is not
  // claimed on several roles in one résumé (decided 2026-10-21). Strong fills
  // go first and keep their own placements; a partial overlap is kept.
  const claimed = new Set();
  const norm = (k) => String(k).trim().toLowerCase();
  const unique = [];
  for (const fill of ordered) {
    const keys = (fill.keywords || []).map(norm);
    if (fill.kind === "bullet" && fill.emphasis !== "strong" && keys.length && keys.every((k) => claimed.has(k))) {
      log(`"${fill.requirement}": dropped, its keywords are already carried by another fill`);
      continue;
    }
    keys.forEach((k) => claimed.add(k));
    unique.push(fill);
  }
  for (const fill of unique) {
    if (fill.emphasis === "strong") {
      if (strong >= MAX_STRONG_FILLS) {
        fill.emphasis = "standard";
        log(`"${fill.requirement}": downgraded to a standard fill (more than ${MAX_STRONG_FILLS} strong fills)`);
      } else {
        strong++;
      }
    }
    if (fill.kind !== "bullet") {
      // Skill fills are capped (2026-10-21) so the skills section stays credible;
      // a strong fill's own skills entry is part of its bullet fill and not counted.
      if (fill.emphasis !== "strong" && skillFills >= MAX_SKILL_FILLS) {
        log(`"${fill.requirement}": skill fill dropped (cap ${MAX_SKILL_FILLS})`);
        selection.gaps = [...(selection.gaps || []), `${fill.requirement} (no room for a skill fill)`];
        continue;
      }
      if (fill.emphasis !== "strong") skillFills++;
      kept.push(fill);
      continue;
    }
    let roles = gapFillRoles(fill);
    // One role per fill technology, strong fills included (2026-10-21; this
    // reverses the earlier "two roles for a strong fill").
    roles = roles.slice(0, 1);
    const placed = [];
    for (const roleId of roles) {
      if (total >= MAX_BULLET_FILLS_TOTAL || (perRole.get(roleId) || 0) >= MAX_BULLET_FILLS_PER_ROLE) continue;
      perRole.set(roleId, (perRole.get(roleId) || 0) + 1);
      total++;
      placed.push(roleId);
    }
    if (placed.length === 0) {
      log(`"${fill.requirement}": bullet fill dropped (per-role cap ${MAX_BULLET_FILLS_PER_ROLE} / total cap ${MAX_BULLET_FILLS_TOTAL} reached)`);
      selection.gaps = [...(selection.gaps || []), `${fill.requirement} (no room for a gap-fill bullet)`];
      continue;
    }
    if (placed.length !== roles.length) log(`"${fill.requirement}": kept on ${placed.join(", ")} only (role cap reached)`);
    fill.role_ids = placed;
    kept.push(fill);
  }
  selection.gap_fills = kept;
  normalizeReframes(selection, { profile, jdAnalysis, log });
  return selection;
}

export function genericJdAnalysis(profile) {
  return {
    role_title: profile.facts.targets.titles || "Software Engineer",
    company: null,
    seniority: "unknown",
    work_mode: "unknown",
    location: null,
    location_constraints: [],
    domain: "general",
    product_summary: "No specific job description provided — this is a general-purpose résumé.",
    must_haves: [],
    nice_to_haves: [],
    responsibilities: [],
    keywords: [],
    tone: "formal",
    red_flags: [],
  };
}

/** jdAnalysis from a role brief ({ title, skills, company, notes })
 * instead of a posting; see roleBriefPrompt. Same purpose and schema as
 * analyseJd so the stage, cost log and cache behave identically. */
export async function analyseRoleBrief(brief, jobId) {
  return runClaude({
    purpose: `jd_analysis:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: roleBriefPrompt(brief),
    schema: jdAnalysisSchema,
    effort: "low",
    model: config.claude.model,
    jobId,
  });
}

export async function analyseJd(jdText, jobId) {
  return runClaude({
    purpose: `jd_analysis:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: jdAnalysisPrompt({ jdText }),
    schema: jdAnalysisSchema,
    effort: "low",
    model: config.claude.model,
    jobId,
  });
}

/** The role the résumé leads with, which the prompts treat as the
 * technical showcase. Roles are already in résumé order. */
export const latestRoleId = (profile) => resumeEligibleRoles(profile)[0]?.id || null;

export async function selectStories(jdAnalysis, profileFullText, jobId, { latestRoleId = null, profile = null } = {}) {
  const result = await runClaude({
    purpose: `story_selection:${jobId}`,
    system: BASE_SYSTEM_PROMPT,
    prompt: storySelectionPrompt({ jdAnalysis, profileFullText, latestRoleId }),
    schema: storySelectionSchema,
    effort: "medium",
    model: config.claude.model,
    // The plan reads the whole profile and has run 150-180s on sonnet; the
    // 180s default has cut it off at the finish line more than once.
    timeoutMs: 300_000,
    jobId,
  });
  normalizePlan(result.data, { profile, jdAnalysis });
  return result;
}

/** Resolves jdAnalysis + selection for a pipeline call, given optional
 * jdText. Returns { jdAnalysis, selection, costUsd }. Does not cache/save
 * anything — callers decide what to persist. */
export async function resolveJdAndSelection({ jdText, profile, profileFullText, jobId }) {
  let totalCost = 0;
  let jdAnalysis;
  if (jdText && jdText.trim()) {
    const { data, costUsd } = await analyseJd(jdText, jobId);
    jdAnalysis = data;
    totalCost += costUsd || 0;
  } else {
    jdAnalysis = genericJdAnalysis(profile);
  }

  let selection;
  if (jdText && jdText.trim()) {
    const { data, costUsd } = await selectStories(jdAnalysis, profileFullText, jobId, { latestRoleId: latestRoleId(profile), profile });
    selection = data;
    totalCost += costUsd || 0;
  } else {
    selection = buildGenericSelection(profile);
  }

  return { jdAnalysis, selection, costUsd: totalCost };
}
