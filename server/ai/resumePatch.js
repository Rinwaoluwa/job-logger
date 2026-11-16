// The patch side of a rewrite pass (schemas.js resumePatchSchema). The
// model returns only what changes; this file merges it onto the previous
// draft and refuses anything that points at nothing. A refused patch is a
// PatchError, which finishResume answers by running the old full rewrite
// for that pass, so a bad patch costs one call and never a run.

import { MIN_BULLETS_PER_ROLE } from "./schemas.js";

export class PatchError extends Error {
  constructor(problems) {
    super(`patch rejected: ${problems.join("; ")}`);
    this.name = "PatchError";
    this.problems = problems;
  }
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Applies a patch to a draft. The previous draft is never mutated; every
 * bullet the patch does not name is the same object in the clone, so
 * "unchanged" means byte-identical, not "the model copied it well".
 *
 * @param {object} previous - the draft the patch was written against
 * @param {object} patch - resumePatchSchema output
 * @returns {{draft: object, changedLocations: Set<string>, log: string[]}}
 * @throws {PatchError} listing every problem found, when any op cannot apply
 */
export function applyResumePatch(previous, patch) {
  const draft = structuredClone(previous);
  const problems = [];
  const log = [];
  const changed = new Set();
  const roles = new Map((draft.resume?.experience || []).map((r) => [r.role_id, r]));
  const allIds = new Set();
  for (const role of roles.values()) for (const b of role.bullets || []) allIds.add(b.id);

  for (const op of patch.bullets || []) {
    const role = roles.get(op.role_id);
    if (!role) {
      problems.push(`${op.op} ${op.id}: no role "${op.role_id}" on the résumé`);
      continue;
    }
    role.bullets = role.bullets || [];
    const idx = role.bullets.findIndex((b) => b.id === op.id);
    if (op.op === "replace") {
      if (idx < 0) { problems.push(`replace ${op.id}: not a bullet on ${op.role_id}`); continue; }
      if (!op.bullet) { problems.push(`replace ${op.id}: no bullet given`); continue; }
      role.bullets[idx] = { ...op.bullet, id: op.id };
      changed.add(op.id);
      log.push(`replaced ${op.id}`);
    } else if (op.op === "add") {
      if (!op.bullet) { problems.push(`add ${op.id}: no bullet given`); continue; }
      if (!new RegExp(`^${escapeRe(op.role_id)}-b\\d+$`).test(op.id)) { problems.push(`add ${op.id}: id must be "${op.role_id}-b<n>"`); continue; }
      if (allIds.has(op.id)) { problems.push(`add ${op.id}: that id is already in use`); continue; }
      role.bullets.push({ ...op.bullet, id: op.id });
      allIds.add(op.id);
      changed.add(op.id);
      log.push(`added ${op.id}`);
    } else if (op.op === "remove") {
      if (idx < 0) { problems.push(`remove ${op.id}: not a bullet on ${op.role_id}`); continue; }
      role.bullets.splice(idx, 1);
      allIds.delete(op.id);
      changed.add(op.id);
      log.push(`removed ${op.id}`);
    }
  }
  for (const role of roles.values()) {
    const n = (role.bullets || []).length;
    if (n < MIN_BULLETS_PER_ROLE) problems.push(`${role.role_id} would be left with ${n} bullet${n === 1 ? "" : "s"}, below the floor of ${MIN_BULLETS_PER_ROLE}`);
  }

  if (patch.summary) {
    draft.resume.professional_summary = patch.summary.professional_summary;
    draft.resume.professional_summary_without_fills = patch.summary.professional_summary_without_fills;
    changed.add("summary");
    log.push("rewrote the summary");
  }
  if (patch.skill_groups) {
    draft.resume.skill_groups = patch.skill_groups;
    changed.add("skills");
    log.push("rewrote the skills section");
  }

  const additions = [...(draft.additions_to_review || [])];
  for (const a of patch.additions || []) {
    const i = additions.findIndex((x) => x.id === a.id);
    if (a.op === "remove") {
      if (i >= 0) { additions.splice(i, 1); log.push(`removed review entry ${a.id}`); } else log.push(`review entry ${a.id} to remove was not there (ignored)`);
      continue;
    }
    if (!a.entry) { problems.push(`upsert ${a.id}: no entry given`); continue; }
    if (a.entry.kind === "bullet" && !allIds.has(a.entry.location)) {
      problems.push(`upsert ${a.id}: its bullet ${a.entry.location} is not on the résumé`);
      continue;
    }
    const entry = { ...(i >= 0 ? additions[i] : {}), ...a.entry, id: a.id };
    if (i >= 0) additions[i] = entry; else additions.push(entry);
    log.push(`${i >= 0 ? "updated" : "added"} review entry ${a.id}`);
  }
  // An entry about a bullet that is gone gates nothing.
  draft.additions_to_review = additions.filter((e) => !(e.kind === "bullet" && !allIds.has(e.location)));

  for (const key of ["match_score", "must_have_gaps", "nice_to_have_gaps", "ats_keywords"]) {
    if (patch[key] !== null && patch[key] !== undefined) draft[key] = patch[key];
  }
  draft.rewrite_notes = [...(previous.rewrite_notes || []), ...(patch.rewrite_notes || [])];

  if (problems.length) throw new PatchError(problems);
  return { draft, changedLocations: changed, log };
}

// The writer's own line budget (prompts/system.js, LENGTH): about 130
// characters to a line; the most recent role may run bullets to two lines,
// the most relevant other role two of its bullets, every other role one
// line each.
const LINE = 130;
const TWO_LINES = 250;

/**
 * Bullets over their line budget, longest excess first, so a LENGTH
 * directive can name exactly what to tighten.
 * @returns {Array<{id: string, role_id: string, chars: number, limit: number}>}
 */
export function overLengthBullets(draft, { latestRoleId = null, selection = null } = {}) {
  const roles = draft.resume?.experience || [];
  const latest = latestRoleId || roles[0]?.role_id || null;
  const planOrder = (selection?.role_plan || []).map((p) => p.role_id);
  const secondary = planOrder.find((id) => id !== latest) || roles.find((r) => r.role_id !== latest)?.role_id || null;
  const out = [];
  for (const role of roles) {
    const bullets = role.bullets || [];
    let limitFor;
    if (role.role_id === latest) {
      limitFor = () => TWO_LINES;
    } else if (role.role_id === secondary) {
      const longest = [...bullets].sort((a, b) => (b.text || "").length - (a.text || "").length).slice(0, 2);
      const twoLine = new Set(longest.filter((b) => (b.text || "").length > LINE).map((b) => b.id));
      limitFor = (b) => (twoLine.has(b.id) ? TWO_LINES : LINE);
    } else {
      limitFor = () => LINE;
    }
    for (const b of bullets) {
      const chars = (b.text || "").length;
      const limit = limitFor(b);
      if (chars > limit) out.push({ id: b.id, role_id: role.role_id, chars, limit });
    }
  }
  return out.sort((a, b) => (b.chars - b.limit) - (a.chars - a.limit));
}

const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/**
 * The LENGTH directive for a patch pass. The full rewrite's version let the
 * model "shorten and remove text outside the flagged locations"; a patch
 * cannot be given that licence, so this one names the bullets to tighten
 * and the exact order of fallbacks.
 */
export function patchLengthDirective({ draft, measured, maxPages, latestRoleId, selection }) {
  const over = overLengthBullets(draft, { latestRoleId, selection });
  const words = countWords(draft.resume?.professional_summary);
  const n = measured.linesOver;
  const list = over.length
    ? over.map((b) => `${b.id} (${b.chars} characters, at most ${b.limit})`).join("; ")
    : "none: every bullet is already inside its line budget, so start at step 2";
  return `The résumé runs ${n} line${n === 1 ? "" : "s"} past its ${maxPages}-page budget (a line holds about 130 characters). Cut at least that many lines, in this order, stopping as soon as the cut is made: (1) tighten exactly these bullets, one "replace" each, to the length given: ${list}; (2) if that is not enough, shorten the summary toward 50 words (it has ${words}) with a "summary" entry, changing both versions the same way; (3) then shorten any other bullet outside the most recent role that still runs past one line; (4) only if that is still not enough, "remove" the real-work bullet that carries least weight for this job from the least relevant older role (the plan's angles and technologies_to_show say which), never leaving a role with fewer than ${MIN_BULLETS_PER_ROLE} bullets; (5) as the very last step, "remove" one standard (not strong) gap-fill bullet together with its additions_to_review entry (an "additions" remove), and say which in rewrite_notes. Every shortened bullet keeps its verb, technology and impact. Never drop a skill or summary gap-fill placement, never drop a strong fill's bullet, never drop a role, and never solve length by deleting a whole section. A shortened reframed bullet (entry reason "Reframed:") has its text_without_reframe shortened the same way.`;
}
