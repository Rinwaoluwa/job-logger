// Deterministic traceability checks: does every claim in the draft résumé
// actually trace to something in the profile? This is the safety net that
// makes "flagged additions allowed" actually enforceable instead of an
// instruction the model can silently ignore.

import { allStoryIds, allMetricIds, verifiedMetricsIndex } from "../profile/render.js";
import { canonicalTokens, containsTerm, claimIndex, matchTerm, namesTech } from "./coverage.js";
import { isGapFillReason, isReframeReason } from "../../shared/applyReview.js";
import { MAX_ESTIMATES_PER_ROLE } from "./schemas.js";

const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A version digit inside a technology name ("Nuxt 3", "Vue 3", "OAuth2",
// "ES6+", "HTML5", "HTTP/2") is not a figure, but the plain digit test read
// it as an unverified metric and bought a full rewrite that only respelled
// the name. The scrubber removes such tokens before the digit test. Three
// sources, none of them a generic "<Word> <number>" rule, because
// "Processed 30 reports" must still count as a figure:
//  1. digit-bearing terms from the profile's technology lists and skills
//     and from the plan (posting spellings: technologies_to_show, gap-fill
//     keywords, skills_to_feature), split on separators so a phrase like
//     "JWT / OAuth2" yields "OAuth2";
//  2. a known framework or runtime name followed by a version;
//  3. letters running straight into digits (OAuth2, ES2020, S3, EC2,
//     i18n) and a name over a slash and digits (HTTP/2). "sub-200ms" has a
//     hyphen between the letters and the digits, so it stays a figure.
const VERSIONED_TECH =
  /\b(?:Nuxt|Vue|Angular|React|Node|Next|Nest|Express|Python|Java|Laravel|Rails|Django|Svelte|Postgres|PostgreSQL|MySQL|MongoDB|Redis|PHP|Ruby|Vite|Webpack|TypeScript|Swift|Kotlin|Spring Boot|Spring|Symfony|Drupal|WordPress|Bootstrap|Tailwind|jQuery|Ember|Flutter|Dart|Unity|Elasticsearch|Kafka|Terraform|Jenkins|Ionic|Electron|Gatsby|Remix|Astro|Deno|Bun|Strapi|Sequelize|Prisma|TypeORM|Jest|Cypress|Playwright|Storybook|GraphQL|Apollo|Fastify|Koa|Vuetify|Quasar|Pinia|Vuex|\.NET|C\+\+|C#|SQL Server|Windows Server|Ubuntu|Debian|Android|iOS)(?:\.js)?\s?v?\d+(?:\.\d+)*\+?/gi;
const LETTERS_THEN_DIGITS = /\b[A-Za-z]+\d+[A-Za-z0-9.]*\+?/g;
const LETTERS_SLASH_DIGITS = /\b[A-Za-z]+\/\d+(?:\.\d+)*\b/g;

/** Returns text → text with technology-name digits removed. Built once per
 * verify run from the profile and the plan. */
export function techDigitScrubber(profile, selection) {
  const sources = [
    ...(profile?.roles || []).flatMap((r) => (r.tech || []).map((t) => t.name)),
    ...(profile?.skills || []).map((sk) => sk.skill),
    ...(selection?.role_plan || []).flatMap((pl) => pl.technologies_to_show || []),
    ...(selection?.gap_fills || []).flatMap((f) => f.keywords || []),
    ...(selection?.skills_to_feature || []),
  ];
  const terms = new Set();
  for (const src of sources) {
    for (const piece of String(src || "").split(/\s*(?:[\/,;|()]|—|\bor\b|\band\b)\s*|\s-\s/)) {
      const term = piece.trim();
      if (!term || !/\d/.test(term) || term.length > 30 || term.split(/\s+/).length > 3) continue;
      // A term that is only a number (a metric id or a count) is not a technology.
      if (!/[A-Za-z]/.test(term)) continue;
      terms.add(term);
    }
  }
  const termRes = [...terms].map((t) => new RegExp(`(?<![\\w])${escapeRe(t)}(?![\\w])`, "gi"));
  return (text) => {
    let out = String(text || "");
    for (const re of termRes) out = out.replace(re, " ");
    return out.replace(VERSIONED_TECH, " ").replace(LETTERS_SLASH_DIGITS, " ").replace(LETTERS_THEN_DIGITS, " ");
  };
}

function digitsMentionedInMetric(metricText, bulletText) {
  const metricNumbers = (metricText.match(/\d[\d.,%]*/g) || []);
  if (metricNumbers.length === 0) return true; // metric has no digits to cross-check against
  return metricNumbers.some((n) => bulletText.includes(n));
}

/**
 * @param {object} draft - resumeTailorSchema-shaped object (the "resume" + "additions_to_review" etc.)
 * @param {object} profile
 * @param {object} selection - storySelectionSchema output (for bullet-count checks)
 * @returns {{issues: Array, additions: Array, hardErrors: Array}}
 */
const slug = (v) => String(v || "").toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "");

export const isGapFillEntry = (a) => a?.kind === "bullet" && isGapFillReason(a);

/** Ids of a draft's gap-fill bullets (inferred, with a "Gap fill:" entry). */
export const gapFillBulletIds = (additions = []) => new Set((additions || []).filter(isGapFillEntry).map((a) => a.location));

export const isReframeEntry = (a) => a?.kind === "bullet" && isReframeReason(a);

/** Ids of a draft's reframed bullets (real work written in the posting's
 * framework, with a "Reframed:" entry and a real-stack fallback). */
export const reframeBulletIds = (additions = []) => new Set((additions || []).filter(isReframeEntry).map((a) => a.location));

/**
 * Keeps the reframe data honest on every draft the model returns: a bullet
 * with a "Reframed:" entry is inferred (the flag is what routes it through
 * the review gate), and a bullet without one carries no fallback (a stray
 * text_without_reframe would otherwise print if an entry were ever added
 * by hand). Mutates and returns the draft.
 */
export function normalizeReframes(draft) {
  const ids = reframeBulletIds(draft?.additions_to_review);
  for (const role of draft?.resume?.experience || []) {
    for (const bullet of role.bullets || []) {
      if (ids.has(bullet.id)) bullet.inferred = true;
      else bullet.text_without_reframe = null;
    }
  }
  return draft;
}

/**
 * A role's bullets of real work: everything except its gap-fill bullets
 * (inferred, with a "Gap fill:" review entry). An estimate is inferred
 * too, but it is real work with a hedged figure, so it counts. The plan's
 * bullet_count is measured in these.
 */
export function realWorkBullets(roleEntry, additions = []) {
  const fillIds = gapFillBulletIds(additions);
  return (roleEntry?.bullets || []).filter((b) => !(b.inferred && fillIds.has(b.id)));
}

/**
 * Is a skill_groups item backed by the profile?
 *
 * Exact name equality is too strict: the model writes "Redis caching" and
 * "Azure DevOps CI/CD" where the profile says "Redis" and
 * "Azure DevOps / CI-CD", so every such item was flagged as unsupported and
 * the review panel filled with noise. An item counts as supported when a
 * profile skill is named inside it, matched over whole canonical tokens —
 * which still refuses "JavaScript" as evidence for "Java".
 */
function skillSupported(item, claims) {
  const itemTokens = canonicalTokens(item);
  if (!itemTokens.length) return false;
  return claims.some((c) => containsTerm(itemTokens, c.tokens));
}

export function verifyResume(draft, profile, selection) {
  const storyIds = allStoryIds(profile);
  const metricIds = allMetricIds(profile);
  const metricsIndex = verifiedMetricsIndex(profile);
  const roleIds = new Set(profile.roles.map((r) => r.id));

  const issues = [];
  const autoAdditions = [];
  const hardErrors = [];

  const knownSkillNames = new Set(profile.skills.map((s) => s.skill.toLowerCase()));
  const fillIds = gapFillBulletIds(draft.additions_to_review);
  // Reframed bullets are inferred (their entry gates them) but they are
  // real work: the figure rules apply to them as to any real bullet.
  const reframeIds = reframeBulletIds(draft.additions_to_review);
  const reframeFor = (roleId) => (selection?.reframes || []).find((r) => r.role_id === roleId) || null;
  const scrub = techDigitScrubber(profile, selection);
  const hasFigure = (text) => /\d/.test(scrub(text));

  // "resume: no" metrics are verified facts the profile keeps off the page.
  const backedByVerifiedMetric = (bullet) =>
    (bullet.metric_ids || []).some((mid) => {
      const m = metricsIndex.get(mid);
      return m && m.verified && m.resume !== false && digitsMentionedInMetric(m.text, bullet.text);
    });

  // A duplicate bullet id across roles would make additions_to_review and
  // the fail-safe rewrite-tracking (both keyed by bullet id) ambiguous —
  // catch it as a hard error rather than silently misattributing a review
  // decision to the wrong bullet.
  const seenBulletIds = new Set();
  for (const roleEntry of draft.resume.experience || []) {
    for (const bullet of roleEntry.bullets || []) {
      if (seenBulletIds.has(bullet.id)) hardErrors.push(`duplicate bullet id "${bullet.id}" used in more than one place`);
      seenBulletIds.add(bullet.id);
    }
  }

  for (const roleEntry of draft.resume.experience || []) {
    if (!roleIds.has(roleEntry.role_id)) {
      hardErrors.push(`unknown role_id "${roleEntry.role_id}" in resume.experience`);
      continue;
    }
    const plan = selection?.role_plan?.find((p) => p.role_id === roleEntry.role_id);
    const bullets = roleEntry.bullets || [];

    const real = realWorkBullets(roleEntry, draft.additions_to_review).length;
    const fillCount = bullets.length - real;
    if (plan && Math.abs(real - plan.bullet_count) > 1) {
      issues.push({
        location: roleEntry.role_id,
        kind: "vague",
        excerpt: `${real} bullets of real work (${bullets.length} on the page)`,
        fix_hint: `Plan called for ${plan.bullet_count} bullets of real work in this role (currently ${real}, plus ${fillCount} gap fill${fillCount === 1 ? "" : "s"}).`,
      });
    }

    for (const bullet of bullets) {
      for (const sid of bullet.source_story_ids || []) {
        if (!storyIds.has(sid)) hardErrors.push(`bullet ${bullet.id} references unknown story id "${sid}"`);
      }
      for (const mid of bullet.metric_ids || []) {
        if (!metricIds.has(mid)) hardErrors.push(`bullet ${bullet.id} references unknown metric id "${mid}"`);
      }

      // A bullet with no story behind it and no inferred flag is one the
      // model composed from the role's context. That is allowed by design
      // (the stories are context, not a menu), so it is not an issue here;
      // composedAdditions() below lists it for review instead.

      // An inferred bullet (an estimate, a gap fill, or a claim beyond the
      // role's context) needs a row in the review panel: a gap fill's row
      // is what lets him reject it, any other's is what lets him accept
      // it. The writer is told to add one; when it forgets, add a held one
      // here rather than leaving the bullet silently stuck.
      if (bullet.inferred) {
        const listed = (draft.additions_to_review || []).some((a) => a.kind === "bullet" && a.location === bullet.id);
        if (!listed) {
          autoAdditions.push({
            id: `auto-bullet-${bullet.id}`,
            kind: "bullet",
            location: bullet.id,
            text: bullet.text,
            reason: "Marked inferred by the writer without an explanation; contains an unverified figure or a claim beyond the role's context.",
            confidence: "low",
          });
        }
      }

      if ((!bullet.inferred || reframeIds.has(bullet.id)) && hasFigure(bullet.text) && !backedByVerifiedMetric(bullet)) {
        issues.push({
          location: bullet.id,
          kind: "unverified_metric",
          excerpt: bullet.text,
          fix_hint: reframeIds.has(bullet.id)
            ? "Contains a number not backed by a verified metric id. A reframed bullet never carries an estimate: cite a verified metric or state the impact in words."
            : "Contains a number not backed by a verified metric id — remove the number or mark the bullet inferred.",
        });
      }
      const fallbackText = typeof bullet.text_without_reframe === "string" ? bullet.text_without_reframe : "";
      if (reframeIds.has(bullet.id) && fallbackText && hasFigure(fallbackText) && !backedByVerifiedMetric({ ...bullet, text: fallbackText })) {
        issues.push({
          location: bullet.id,
          kind: "unverified_metric",
          excerpt: fallbackText,
          fix_hint: "The real-stack version (text_without_reframe) contains a number not backed by a verified metric id; it carries the same figures as the bullet, which means verified ones only.",
        });
      }
    }

    // A reframed role shows the posting's framework and nothing of the one
    // it replaces: a leaked "Nuxt" next to "React" tells the reader the
    // role was a Vue shop after all, which the reviewer cannot judge from
    // the profile. Each reframed bullet also needs its real-stack fallback,
    // in the real stack and in the same length class, so a rejection
    // restores the bullet without moving the page.
    const reframe = reframeFor(roleEntry.role_id);
    if (reframe) {
      const realStack = (reframe.replaces || []).join(", ");
      for (const bullet of bullets) {
        const leaked = (reframe.replaces || []).find((t) => namesTech(t, bullet.text));
        if (leaked) {
          issues.push({
            location: bullet.id,
            kind: "reframe",
            excerpt: bullet.text,
            fix_hint: `The plan reframes this role to ${reframe.technology}; this bullet names "${leaked}". Rewrite it in ${reframe.technology} with text_without_reframe as the same bullet in the real stack (${realStack}), or, if it does not touch the frontend, describe the mechanism without naming "${leaked}".`,
          });
          continue;
        }
        if (!reframeIds.has(bullet.id)) continue;
        const fallback = typeof bullet.text_without_reframe === "string" ? bullet.text_without_reframe.trim() : "";
        if (!fallback) {
          issues.push({ location: bullet.id, kind: "reframe", excerpt: bullet.text, fix_hint: `This reframed bullet has no text_without_reframe. Supply the same bullet written in the role's real stack (${realStack}), same length and figures.` });
        } else if (namesTech(reframe.technology, fallback)) {
          issues.push({ location: bullet.id, kind: "reframe", excerpt: fallback, fix_hint: `text_without_reframe still names ${reframe.technology}; it must be the same bullet in the role's real stack (${realStack}).` });
        } else if (fallback.length > String(bullet.text || "").length + 20) {
          issues.push({ location: bullet.id, kind: "reframe", excerpt: fallback, fix_hint: `text_without_reframe runs longer than the bullet (${fallback.length} vs ${String(bullet.text || "").length} characters); keep it in the same length class so a rejection does not change the page.` });
        }
      }
    }

    // Estimated figures are capped per role (real-work estimates and
    // gap-fill figures together). Real work keeps its figures first, in
    // page order; gap fills lose theirs first. The rewrite removes the
    // figure and states the impact in words; a figure that survives the
    // pass budget is held for review by applyFailSafe.
    const withFigure = bullets.filter((b) => hasFigure(b.text) && !backedByVerifiedMetric(b));
    const ordered = [...withFigure.filter((b) => !fillIds.has(b.id)), ...withFigure.filter((b) => fillIds.has(b.id))];
    const keptIds = ordered.slice(0, MAX_ESTIMATES_PER_ROLE).map((b) => b.id);
    for (const b of ordered.slice(MAX_ESTIMATES_PER_ROLE)) {
      issues.push({
        location: b.id,
        kind: "too_many_estimates",
        excerpt: b.text,
        fix_hint:
          `This role already carries ${MAX_ESTIMATES_PER_ROLE} bullets with estimated figures (${keptIds.join(", ")}). ` +
          `Remove the figure from this bullet and state the impact in words; keep the bullet, its id, its "inferred" flag and its review entry, and drop the sentence in the reason that explained the figure.`,
      });
    }
  }

  // One addition per (group, item). The location has to name the item, not
  // just the group: applyReview resolves a flagged skill by location, so
  // sharing one location across a group's items meant only the first was
  // ever gated — the rest shipped into the export unreviewed.
  const claims = claimIndex(profile);
  for (const group of draft.resume.skill_groups || []) {
    for (const item of group.items || []) {
      if (knownSkillNames.has(item.toLowerCase()) || skillSupported(item, claims)) continue;
      const location = `skills/${group.title}/${item}`;
      const alreadyFlagged = (draft.additions_to_review || []).some(
        (a) =>
          a.kind === "skill" &&
          a.text.trim().toLowerCase() === item.trim().toLowerCase() &&
          (a.location === location || a.location === `skills/${group.title}`),
      );
      if (alreadyFlagged) continue;
      autoAdditions.push({
        id: `auto-skill-${slug(group.title)}--${slug(item)}`,
        kind: "skill",
        location,
        text: item,
        reason: "Not found in the profile's skill inventory at working+ proficiency.",
        confidence: "low",
      });
    }
  }

  // Strong gap-fill placements on the summary and stack lines are reviewed
  // through their own entries. Like an inferred bullet without an entry, a
  // placement the writer forgot to list would have no row to reject it
  // from, so add the entry here.
  const gapReason = (term) => `Gap fill: ${term}. Placed by the writer as a gap fill without a review entry.`;
  for (const roleEntry of draft.resume.experience || []) {
    const fills = (roleEntry.stack_fills || []).map((t) => String(t).trim()).filter(Boolean);
    if (!fills.length) continue;
    // A fill term also written into `stack` would export ungated.
    if (roleEntry.stack) {
      const kept = roleEntry.stack.split(",").map((p) => p.trim()).filter((piece) => !fills.some((t) => matchTerm(t, piece)));
      roleEntry.stack = kept.join(", ");
    }
    for (const term of fills) {
      const location = `stack/${roleEntry.role_id}/${term}`;
      const listed = (draft.additions_to_review || []).some(
        (a) => a.kind === "stack" && (a.location === location || (a.location === `stack/${roleEntry.role_id}` && a.text === term)),
      );
      if (listed) continue;
      autoAdditions.push({ id: `auto-stack-${slug(roleEntry.role_id)}--${slug(term)}`, kind: "stack", location, text: term, reason: gapReason(term), confidence: "low" });
    }
  }
  const withoutFills = draft.resume.professional_summary_without_fills;
  if (typeof withoutFills === "string" && withoutFills !== draft.resume.professional_summary) {
    const strongTerms = (selection?.gap_fills || [])
      .filter((f) => f.emphasis === "strong")
      .flatMap((f) => f.keywords || []);
    for (const term of new Set(strongTerms)) {
      const inFull = matchTerm(term, draft.resume.professional_summary || "");
      const inWithout = matchTerm(term, withoutFills);
      if (!inFull || inWithout) continue;
      const listed = (draft.additions_to_review || []).some((a) => a.kind === "summary" && matchTerm(term, a.text || ""));
      if (listed) continue;
      autoAdditions.push({ id: `auto-summary-${slug(term)}`, kind: "summary", location: "summary", text: term, reason: gapReason(term), confidence: "low" });
    }
  }

  return { issues, autoAdditions, hardErrors };
}

/**
 * Bullets the model composed from a role's context rather than from a
 * story. Each gets an addition with gate "open": applyReview keeps it on
 * the page unless the reviewer rejects it, and the UI badges it as
 * AI-composed. Call this last, after fail-safe and do-not-claim handling,
 * so a bullet that ended up inferred or blocked is not also listed here.
 */
export function composedAdditions(draft, profile) {
  const companyById = new Map(profile.roles.map((r) => [r.id, r.company]));
  const out = [];
  for (const role of draft.resume.experience || []) {
    for (const bullet of role.bullets || []) {
      if (bullet.inferred || (bullet.source_story_ids || []).length > 0) continue;
      out.push({
        id: `composed-${bullet.id}`,
        kind: "bullet",
        location: bullet.id,
        text: bullet.text,
        reason: `AI-composed from the ${companyById.get(role.role_id) || role.role_id} role's context (product, stack), not from a profile story. Check that it happened.`,
        confidence: "medium",
        gate: "open",
      });
    }
  }
  return out;
}

/** After the rewrite loop, force any remaining unresolved issue's bullet to
 * inferred=true with a held review entry, so the pipeline never silently
 * ships an untraceable claim as a confirmed fact. A reviewer truth failure
 * (severity "block") that survived the pass budget gets the same
 * treatment. A third estimated figure on a role (too_many_estimates) that
 * survived is held too, even on an already-inferred gap-fill bullet: the
 * held entry outranks the open gap-fill entry in applyReview, so the
 * bullet waits for his decision instead of exporting with the figure. */
export function applyFailSafe(draft, remainingIssues) {
  const byBullet = new Map();
  for (const issue of remainingIssues) {
    const reviewerBlock = issue.source === "reviewer" && issue.severity === "block";
    if (issue.kind === "untraceable_claim" || issue.kind === "unverified_metric" || issue.kind === "too_many_estimates" || reviewerBlock) {
      byBullet.set(issue.location, issue);
    }
  }
  if (byBullet.size === 0) return draft;

  const additions = [...(draft.additions_to_review || [])];
  const alreadyHeld = (id) => additions.some((a) => a.id === `failsafe-${id}`);
  // A reframed bullet is already inferred (its open "Reframed:" entry); a
  // truth failure on it still gets a held entry, which outranks the open
  // one in applyReview, so the bullet waits for his decision.
  const reframeIds = reframeBulletIds(additions);
  for (const role of draft.resume.experience || []) {
    for (const bullet of role.bullets || []) {
      const issue = byBullet.get(bullet.id);
      if (!issue || alreadyHeld(bullet.id)) continue;
      if (issue.kind === "too_many_estimates") {
        additions.push({
          id: `failsafe-${bullet.id}`,
          kind: "bullet",
          location: bullet.id,
          text: bullet.text,
          reason: `Held for review: this role already has ${MAX_ESTIMATES_PER_ROLE} estimated figures and the rewrite could not remove this one. Accept it with the figure, or edit the figure out.`,
          confidence: "low",
        });
        continue;
      }
      if (!bullet.inferred || reframeIds.has(bullet.id)) {
        bullet.inferred = true;
        additions.push({
          id: `failsafe-${bullet.id}`,
          kind: "bullet",
          location: bullet.id,
          text: bullet.text,
          reason: issue.source === "reviewer"
            ? `Reviewer: ${issue.fix_hint}`
            : `Could not trace to a verified story/metric (${issue.kind}).`,
          confidence: "low",
        });
      }
    }
  }
  return { ...draft, additions_to_review: additions };
}
