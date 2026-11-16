// Everything that happens to a résumé draft after the model has written
// it: profile invariants, the deterministic verify/lint/coverage checks,
// page measurement, the optional truth reviewer, the bounded rewrite loop,
// the do-not-claim scrub, composed additions, reviewer notes, the 9.5pt
// fallback and the persisted reports. Shared by the tailor pipeline (a
// fresh write) and the revise pipeline (a user instruction applied to an
// existing version), so a revision gets exactly the checks a generation
// does.

import { runClaude } from "../claude.js";
import { config } from "../../config.js";
import { resumeTailorSchema, resumePatchSchema, resumeReviewSchema, REVIEW_KINDS, MIN_BULLETS_PER_ROLE } from "../schemas.js";
import { resumeRewritePrompt, resumePatchPrompt } from "../prompts/resumeWrite.js";
import { applyResumePatch, PatchError, patchLengthDirective } from "../resumePatch.js";
import { resumeReviewPrompt, resumeReviewSystemPrompt } from "../prompts/resumeReview.js";
import { resumeWriterSystemPrompt } from "../prompts/system.js";
import { lintResume } from "../lint.js";
import { buildSurfaceIndex, computeCoverage, checkDoNotClaim, missingKeywordIssue, missingGapFillIssue, matchTerm, denyIndex, canonKey } from "../coverage.js";
import { stripTerm, isGapFillReason, isInventedReason } from "../../../shared/applyReview.js";
import { measureResume } from "../../render/measure.js";
import { verifyResume, applyFailSafe, composedAdditions, normalizeReframes } from "../verify.js";
import { profileFull, verifiedMetricsText, skillsTableText } from "../../profile/render.js";
import { isCancelled } from "../../tasks/context.js";
import { latestRoleId as findLatestRoleId } from "./shared.js";

// Profile locations carry context the résumé line does not want —
// "Vancouver, British Columbia (hybrid)", "Remote (Lisbon, Portugal — occasionally in
// office)". The parenthetical is for interviews; the résumé prints the
// part before it.
function resumeLocation(raw) {
  const value = (raw || "").trim();
  if (!value || value.includes("<ask")) return "";
  return value.split(" (")[0].trim();
}

// Education and certification lines in facts.md may carry a note in
// parentheses meant for the app, not the page — "(show GPA: no — omit from
// the résumé; ...)". The résumé prints the line without the note, and when
// the note says the GPA is not to be shown, the GPA segment goes too. A
// placeholder prints nothing: "none", "n/a", or a line that starts with
// one of those and goes on to explain ("none — and none in progress or
// planned (confirmed ...)"), which is a note to the app, not a credential.
const CREDENTIAL_PLACEHOLDER = /^(none|n\/a|no|nil)\b/i;
function resumeCredential(raw) {
  const value = (raw || "").trim();
  if (!value || value.includes("<ask") || CREDENTIAL_PLACEHOLDER.test(value)) return "";
  const noteMatch = value.match(/\(([^)]*)\)\s*$/);
  const note = noteMatch ? noteMatch[1] : "";
  let line = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (CREDENTIAL_PLACEHOLDER.test(line)) return "";
  if (/show gpa:\s*no/i.test(note)) {
    line = line
      .split(",")
      .map((part) => part.trim())
      .filter((part) => !/^gpa\b/i.test(part))
      .join(", ");
  }
  return line;
}

export function applyProfileInvariants(resume, profile) {
  // Company/title/dates/location/header/education/certifications are
  // always injected from the profile, never left to the model — this is a
  // hard invariant, not a suggestion. The stack line is blanked the same
  // way: the one-page résumé has none, and a stray one left in the data
  // would count toward keyword coverage without being on the page.
  const header = profile.facts.header;
  const roleById = new Map(profile.roles.map((r) => [r.id, r]));
  return {
    ...resume,
    header: {
      name: header.name || "",
      phone: header.phone || "",
      email: header.email || "",
      location: resumeLocation(header.location),
      linkedin: header.linkedin || "",
      github: header.github || "",
      portfolio: header.portfolio || "",
    },
    education: (profile.facts.education || []).map(resumeCredential).filter(Boolean),
    certifications: (profile.facts.certifications || []).map(resumeCredential).filter(Boolean),
    experience: (resume.experience || []).map((entry) => {
      const role = roleById.get(entry.role_id);
      return {
        ...entry,
        company: role?.company || entry.role_id,
        title: role?.title || "",
        dates: role?.dates || "",
        location: resumeLocation(role?.location),
        stack: "",
        stack_fills: [],
        // The override stays an override (so a profile edit still reaches
        // later revisions); the renderers read the resolved label.
        engagement: entry.engagement ?? null,
        engagement_label: entry.engagement == null ? (role?.engagement || "") : String(entry.engagement),
      };
    }),
  };
}

/** A rewrite pass is told to copy each role's engagement override through,
 * but nothing should depend on that: a forced pass must never reset a
 * label the user set (or cleared) to the profile default. */
function restoreEngagement(draft, previous) {
  const before = new Map((previous.resume.experience || []).map((r) => [r.role_id, r.engagement ?? null]));
  for (const role of draft.resume.experience || []) {
    if (before.has(role.role_id)) role.engagement = before.get(role.role_id);
  }
  return draft;
}

/** Page count for a draft at a layout step. A broken or missing browser
 * must not fail a generation, so an unmeasurable draft reports 0 pages,
 * which reads as "unknown" everywhere below and never triggers a trim. */
async function measurePages(draft, maxPages, step = 0) {
  try {
    return await measureResume(draft, { maxPages, step });
  } catch (e) {
    if (isCancelled(e)) throw e;
    console.warn(`[tailor] could not measure résumé length: ${e.message}`);
    return { pages: 0, method: "unavailable", linesOver: 0, step };
  }
}

function overflowIssue(measured, maxPages) {
  return {
    location: "document",
    kind: "overflow",
    excerpt: `${measured.pages} pages`,
    fix_hint: `The résumé runs to ${measured.pages} pages against a ${maxPages}-page budget. Cut roughly ${measured.linesOver} lines of bullet text.`,
  };
}

const isOverBudget = (measured, maxPages) => measured.pages > 0 && measured.pages > maxPages;
const hasOverflow = (list) => list.some((i) => i.kind === "overflow");

/** The LENGTH directive of the full rewrite (RESUME_REWRITE_MODE=full). It
 * allows cuts outside the flagged locations, which a patch pass cannot be
 * given; the patch's version (resumePatch.js) names the bullets instead. */
function fullLengthDirective(measured, maxPages) {
  return `The résumé runs ${measured.linesOver} line${measured.linesOver === 1 ? "" : "s"} past its ${maxPages}-page budget (a line holds about 130 characters). Cut at least that many lines, in this order: (1) tighten the two-line bullets on the most recent role and the most relevant other role to one line each; (2) shorten the summary toward 50 words; (3) shorten any bullet anywhere that still runs past one line; (4) only if that is still not enough, drop the real-work bullet that carries least weight for this job from the least relevant older role (the plan's angles and technologies_to_show say which), never leaving a role with fewer than ${MIN_BULLETS_PER_ROLE} bullets; (5) as the very last step, drop one standard (not strong) gap-fill bullet together with its additions_to_review entry, and say which in rewrite_notes. Every shortened bullet keeps its verb, technology and impact. You may shorten and remove text outside the flagged locations to do this; that restriction does not apply to trimming. Never drop a skill or summary gap-fill placement, never drop a strong fill's bullet, never drop a role, and never solve length by deleting a whole section. A shortened reframed bullet (entry reason "Reframed:") has its text_without_reframe shortened the same way.`;
}

/** With no stack lines on the page, a stack placement the model still
 * emits would sit in the review panel gating nothing. */
export const withoutStackAdditions = (draft) => {
  draft.additions_to_review = (draft.additions_to_review || []).filter((a) => a.kind !== "stack");
  return draft;
};

/** Deterministic checks over a finished draft. Free — no model call. The
 * surface index is built once and shared, so the résumé is walked once for
 * both keyword coverage and do-not-claim. */
function assess(draft, profile, jdAnalysis, selection) {
  // Additions let the index mark held surfaces (estimates, flagged skills)
  // so coverage does not count them as delivered, and gap-fill surfaces so
  // do-not-claim exempts them.
  const index = buildSurfaceIndex(draft.resume, draft.additions_to_review || []);
  const coverage = computeCoverage({ jdAnalysis, resume: draft.resume, profile, index });
  const keywordIssue = missingKeywordIssue(coverage);
  return {
    coverage,
    issues: [
      ...checkDoNotClaim(draft.resume, profile, index),
      ...(keywordIssue ? [keywordIssue] : []),
      // A planned gap fill the writer skipped or paraphrased past its
      // keyword. Rides the same one-shot coverage trigger as the ask above.
      ...missingGapFillIssue(selection, index),
    ],
  };
}

/** Additions can arrive from the model and be generated again on re-verify. */
export const dedupeById = (list) => {
  const seen = new Map();
  for (const a of list) if (a && a.id && !seen.has(a.id)) seen.set(a.id, a);
  return [...seen.values()];
};

// The reviewer's severity is advisory. A truth failure may force a rewrite
// and, if it survives the pass budget, gates the bullet; an undelivered
// plan item may force a rewrite once (the same one-shot rule keyword
// coverage has), after which it is only a note in the review panel.
const REVIEW_CEILING = {
  unsupported_claim: "block",
  unflagged_number: "block",
  technology_not_shown: "fix",
  missing_impact: "fix",
  summary_not_skills_profile: "fix",
};
const SEVERITY_RANK = { note: 0, fix: 1, block: 2 };
const REVIEW_LABEL = {
  unsupported_claim: "claim not supported by the profile",
  unflagged_number: "figure not backed by a verified metric",
  technology_not_shown: "planned technology not shown doing work",
  missing_impact: "recorded outcome left out",
  summary_not_skills_profile: "summary names a job or achievement",
};
const slug = (v) => String(v || "").toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "");

/** The truth and JD-fit reviewer. Advisory: an outage logs and returns
 * null rather than failing the run, and the stage finishes either way. */
async function reviewDraft({ draft, jdAnalysis, selection, profileFullText, metricsText, jobId, ctx }) {
  ctx.beginStage("resume_review");
  try {
    const { data, costUsd } = await runClaude({
      purpose: `resume_review:${jobId}`,
      system: resumeReviewSystemPrompt({ profileFullText, verifiedMetricsText: metricsText }),
      prompt: resumeReviewPrompt({ jdAnalysis, selection, draft }),
      schema: resumeReviewSchema,
      effort: config.resume.reviewer.effort,
      model: config.resume.reviewer.model,
      timeoutMs: 300_000,
      jobId,
    });
    ctx.finishStage("resume_review", { costUsd });
    return { issues: data.issues || [], costUsd };
  } catch (e) {
    if (isCancelled(e)) throw e;
    console.warn(`[tailor] reviewer unavailable, continuing without it: ${e.message}`);
    ctx.finishStage("resume_review", {});
    return null;
  }
}

/** Reviewer output in the pipeline's issue shape, with the severity
 * ceiling applied. Fit kinds may only force a rewrite while fitMayForce is
 * true. A figure verify.js already flagged on the same bullet is skipped:
 * that check owns digits and its fail-safe already gates the bullet. */
function reviewerIssues(review, { fitMayForce, existing }) {
  const out = [];
  for (const r of review.issues) {
    if (!REVIEW_CEILING[r.kind]) continue;
    if (r.kind === "unflagged_number" && existing.some((i) => i.kind === "unverified_metric" && i.location === r.location)) continue;
    const ceiling = REVIEW_CEILING[r.kind];
    let severity = SEVERITY_RANK[r.severity] < SEVERITY_RANK[ceiling] ? r.severity : ceiling;
    if (severity === "fix" && !fitMayForce) severity = "note";
    out.push({
      location: r.location,
      kind: r.kind,
      excerpt: r.text,
      fix_hint: `${r.reason}${r.suggested_fix ? ` Fix: ${r.suggested_fix}` : ""}`,
      severity,
      source: "reviewer",
      role_id: r.role_id,
      evidence: r.evidence,
    });
  }
  return out;
}
const reviewerForces = (list) => list.some((i) => i.source === "reviewer" && i.severity !== "note");
const reviewerNotes = (list) => list.filter((i) => i.source === "reviewer" && i.severity === "note");

function bulletText(draft, id) {
  for (const role of draft.resume.experience || []) {
    for (const b of role.bullets || []) if (b.id === id) return b.text;
  }
  return undefined;
}

/**
 * @param {object} opts
 * @param {object} opts.draft - the model's résumé output (resumeTailorSchema shape)
 * @param {object} opts.profile - getProfile()
 * @param {object} opts.jdAnalysis
 * @param {object} opts.selection - the résumé plan the checks measure against
 * @param {string} opts.jobId
 * @param {object} opts.ctx - task context for stage progress
 * @param {boolean} [opts.reviewer=true] - run the model-based truth reviewer
 *   (when enabled in config). A revision skips it: one write call plus the
 *   free checks keeps follow-ups fast, and anything the user asked for
 *   beyond the profile is gated by the prompt's own rules.
 * @param {boolean} [opts.coverageMayForce=true] - whether a missing keyword
 *   or gap fill may buy the first rewrite pass. Off for a revision, where
 *   "drop that bullet" must not be undone by the coverage trigger.
 * @param {string|null} [opts.userDirective] - the candidate's standing
 *   instructions, repeated to every rewrite so a trim never undoes them.
 * @returns {Promise<{draft: object, costUsd: number}>}
 */
export async function finishResume({ draft, profile, jdAnalysis, selection, jobId, ctx, reviewer = true, coverageMayForce = true, styleMayForce = true, userDirective = null }) {
  const profileFullText = profileFull(profile, { interviewVersions: false });
  const metricsText = verifiedMetricsText(profile);
  const skillsText = skillsTableText(profile);
  const latestRoleId = findLatestRoleId(profile);

  let totalCost = 0;
  const track = (c) => { totalCost += c || 0; };

  // Applied to every draft the moment it comes back, not just at the end:
  // real company names and dates change how the page fills, so the length
  // measurement below has to see the finished document.
  draft.resume = applyProfileInvariants(draft.resume, profile);
  normalizeReframes(draft);

  ctx.beginStage("verify_lint");
  const { issues: verifyIssues, autoAdditions, hardErrors } = verifyResume(draft, profile, selection);
  const lintIssues = lintResume(draft.resume);
  draft.additions_to_review = dedupeById([...(draft.additions_to_review || []), ...autoAdditions]);
  const hardErrorIssues = hardErrors.map((msg) => ({ location: "unknown", kind: "untraceable_claim", excerpt: "", fix_hint: msg }));
  let { coverage, issues: assessIssues } = assess(draft, profile, jdAnalysis, selection);
  let issues = [...verifyIssues, ...lintIssues, ...hardErrorIssues, ...assessIssues];
  let currentHardErrors = hardErrors;
  ctx.finishStage("verify_lint", {});

  const maxPages = config.resume.maxPages;
  ctx.beginStage("page_fit");
  let measured = await measurePages(draft, maxPages);
  if (isOverBudget(measured, maxPages)) issues.push(overflowIssue(measured, maxPages));
  ctx.finishStage("page_fit", {});

  // The reviewer reads the finished draft against the profile and the
  // plan. It is the one model-based trigger, and it is scoped to truth and
  // fit: a claim the profile does not support, a figure with no metric
  // behind it, a planned technology not shown, a recorded outcome left
  // out, a summary that recaps a job. It never comments on the writing; an
  // earlier critique pass did, and that pushed every bullet toward a house
  // style. Its issues ride in the same rewrite as everything below.
  let reviewsLeft = reviewer && config.resume.reviewer.enabled ? config.resume.reviewer.maxCalls : 0;
  let reviewNotes = [];
  let lastReview = null;
  if (reviewsLeft > 0) {
    reviewsLeft--;
    lastReview = await reviewDraft({ draft, jdAnalysis, selection, profileFullText, metricsText, jobId, ctx });
    if (lastReview) {
      track(lastReview.costUsd);
      const fromReviewer = reviewerIssues(lastReview, { fitMayForce: true, existing: issues });
      issues.push(...fromReviewer);
      reviewNotes = reviewerNotes(fromReviewer);
    }
  }

  // Only mechanical failures buy a rewrite: a broken reference, a banned
  // phrase, profile placeholder text on the page, or a document that won't
  // fit its page budget. A number we can't tie to a verified metric is
  // flagged into the review panel by applyFailSafe below rather than being
  // argued with the model, and a bullet composed from the role's context
  // with no story behind it is allowed outright (listed for review with an
  // open gate at the end of the pipeline). There used to be a count-based
  // trigger here too; it mostly served to push the writing back toward a
  // house style, which is the thing that made the bullets read as
  // templates. A do-not-claim hit joins them: claiming a forbidden
  // technology as real work is a truth failure, not a style nit. So does a
  // third estimated figure on one role (too_many_estimates): the fix is
  // local to that bullet and cheap.
  // On a revision the style kinds do not force a rewrite: the user may
  // have asked for exactly that wording (a first-person summary, a phrase
  // of his own). They still reach rewrite_notes as "style:" lines.
  const STYLE_KINDS = new Set(["banned_phrase", "placeholder", "pronoun"]);
  const forcesRewrite = (list) =>
    list.some((i) => i.kind === "do_not_claim" || i.kind === "too_many_estimates" || i.kind === "reframe" || (styleMayForce && STYLE_KINDS.has(i.kind)));

  // Keyword coverage may buy the FIRST pass only. Coverage is recomputed
  // every pass so the persisted report always describes the final draft,
  // but as a *trigger* it is one-shot: `issues` is replaced (not
  // accumulated) each pass, so without this latch a still-missing keyword
  // would re-arm the trigger and spend the second pass stuffing terms in.
  let coverageLatch = coverageMayForce;
  const COVERAGE_KINDS = new Set(["missing_keyword", "missing_gap_fill"]);
  const coverageForces = (list) => coverageLatch && list.some((i) => COVERAGE_KINDS.has(i.kind));

  let needsRewrite = currentHardErrors.length > 0 || forcesRewrite(issues) || hasOverflow(issues) || coverageForces(issues) || reviewerForces(issues);

  // Up to 2 passes, so a trim that still overflows gets one more attempt.
  for (let pass = 0; needsRewrite && issues.length > 0 && pass < 2; pass++) {
    ctx.beginStage("resume_rewrite");
    const flaggedLocations = new Set(issues.map((i) => i.location));
    // Length and coverage pull against each other — adding skills costs
    // lines. When the page budget is blown, length wins. A revision never
    // asks for coverage: the user's instruction decides what is on the page.
    const coverageDirective = hasOverflow(issues) || !coverageMayForce
      ? null
      : issues.filter((i) => COVERAGE_KINDS.has(i.kind)).map((i) => i.fix_hint).join("\n\n") || null;
    coverageLatch = false;
    try {
      const before = draft;
      const patchMode = config.resume.rewriteMode === "patch";
      const lengthDirective = !hasOverflow(issues)
        ? null
        : patchMode
          ? patchLengthDirective({ draft, measured, maxPages, latestRoleId, selection })
          : fullLengthDirective(measured, maxPages);
      const promptArgs = { jdAnalysis, selection, previousResume: draft, issues, latestRoleId, userDirective, lengthDirective, coverageDirective };
      const callOpts = {
        system: resumeWriterSystemPrompt({ profileFullText, verifiedMetricsText: metricsText, skillsTableText: skillsText }),
        effort: config.claude.effortWrite,
        model: config.claude.modelWrite,
        jobId,
      };
      let next = null;
      let costUsd = 0;
      if (patchMode) {
        // The model returns only what changes (a few bullets, not the
        // 11k-token résumé); the merge keeps everything else byte for byte
        // and refuses a patch that points at nothing, in which case the
        // full rewrite below runs for this pass instead.
        const res = await runClaude({
          ...callOpts,
          purpose: `resume_rewrite_patch:${jobId}`,
          prompt: resumePatchPrompt(promptArgs),
          schema: resumePatchSchema,
          timeoutMs: 240_000,
        });
        costUsd += res.costUsd;
        try {
          const merged = applyResumePatch(before, res.data);
          next = merged.draft;
          console.log(`[tailor] rewrite pass ${pass + 1} (patch): ${merged.log.join("; ") || "no changes"}`);
        } catch (e) {
          if (!(e instanceof PatchError)) throw e;
          console.warn(`[tailor] patch rejected, running the full rewrite for this pass: ${e.problems.join("; ")}`);
        }
      }
      if (!next) {
        const res = await runClaude({
          ...callOpts,
          purpose: `resume_rewrite:${jobId}`,
          prompt: resumeRewritePrompt(promptArgs),
          schema: resumeTailorSchema,
          timeoutMs: 480_000,
        });
        costUsd += res.costUsd;
        next = res.data;
      }
      draft = restoreEngagement(withoutStackAdditions(next), before);
      track(costUsd);
      draft.resume = applyProfileInvariants(draft.resume, profile);
      normalizeReframes(draft);
      const reverify = verifyResume(draft, profile, selection);
      const relint = lintResume(draft.resume);
      draft.additions_to_review = dedupeById([...(draft.additions_to_review || []), ...reverify.autoAdditions]);
      currentHardErrors = reverify.hardErrors;
      const reassess = assess(draft, profile, jdAnalysis, selection);
      coverage = reassess.coverage;
      issues = [
        ...reverify.issues,
        ...relint,
        ...reassess.issues,
        ...currentHardErrors.map((msg) => ({ location: "unknown", kind: "untraceable_claim", excerpt: "", fix_hint: msg })),
      ];
      measured = await measurePages(draft, maxPages);
      if (isOverBudget(measured, maxPages)) issues.push(overflowIssue(measured, maxPages));
      ctx.finishStage("resume_rewrite", { costUsd });

      // A note about a bullet the rewrite just touched describes text that
      // no longer exists. Then, while a pass remains to act on it, read
      // the new draft again; fit kinds have had their one shot by now
      // (coverageLatch is down), so from here they only become notes.
      reviewNotes = reviewNotes.filter((n) => !flaggedLocations.has(n.location));
      if (reviewsLeft > 0 && pass + 1 < 2) {
        reviewsLeft--;
        lastReview = await reviewDraft({ draft, jdAnalysis, selection, profileFullText, metricsText, jobId, ctx });
        if (lastReview) {
          track(lastReview.costUsd);
          const fromReviewer = reviewerIssues(lastReview, { fitMayForce: coverageLatch, existing: issues });
          issues.push(...fromReviewer);
          reviewNotes = [...reviewNotes, ...reviewerNotes(fromReviewer)];
        }
      }
      needsRewrite = currentHardErrors.length > 0 || forcesRewrite(issues) || hasOverflow(issues) || coverageForces(issues) || reviewerForces(issues);
    } catch (e) {
      if (isCancelled(e)) throw e;
      ctx.failStage("resume_rewrite", e);
      // Fall through with the pre-rewrite draft rather than losing all progress.
      break;
    }
  }

  draft = applyFailSafe(draft, issues);
  draft.resume = applyProfileInvariants(draft.resume, profile);

  // Last line of defence on do-not-claim. The rewrite gets first go, but a
  // forbidden term must not survive it as real work, so anything still
  // standing is removed here rather than shipped. A skill or stack fragment
  // can simply be deleted; a bullet or the summary can't be safely
  // auto-edited, so it becomes a blocking addition that applyReview
  // withholds from the page in every mode — accepting it is not offered.
  // Gap-fill placements are exempt (the index carries the additions, so
  // buildSurfaceIndex marks them); they are annotated below instead.
  const scrubbed = [];
  const survivors = checkDoNotClaim(draft.resume, profile, buildSurfaceIndex(draft.resume, draft.additions_to_review || []));
  if (survivors.length) {
    for (const group of draft.resume.skill_groups || []) {
      group.items = (group.items || []).filter((item) => {
        // A skills surface's excerpt IS the item, so compare directly.
        const hit = survivors.find(
          (i) => i.surface.surface === "skills" && i.surface.group === group.title && i.excerpt === item,
        );
        if (!hit) return true;
        scrubbed.push(`removed "${item}" from skills — "${hit.term}" is on a Do NOT claim list`);
        return false;
      });
    }

    for (const role of draft.resume.experience || []) {
      const stackHit = survivors.find((i) => i.surface.surface === "stack" && i.surface.role_id === role.role_id);
      if (stackHit && role.stack) {
        const kept = role.stack.split(",").map((p) => p.trim()).filter((piece) => checkDoNotClaim(
          { experience: [{ role_id: role.role_id, stack: piece, bullets: [] }] }, profile,
        ).length === 0);
        if (kept.join(", ") !== role.stack) {
          scrubbed.push(`trimmed the ${role.role_id} stack line — "${stackHit.term}" is on a Do NOT claim list`);
          role.stack = kept.join(", ");
        }
      }
      if (stackHit && (role.stack_fills || []).length) {
        const keptFills = role.stack_fills.filter((term) => checkDoNotClaim(
          { experience: [{ role_id: role.role_id, stack: term, bullets: [] }] }, profile,
        ).length === 0);
        if (keptFills.length !== role.stack_fills.length) {
          scrubbed.push(`removed a gap-fill term from the ${role.role_id} stack line — "${stackHit.term}" is on a Do NOT claim list`);
          role.stack_fills = keptFills;
        }
      }
      for (const bullet of role.bullets || []) {
        const hit = survivors.find((i) => i.location === bullet.id);
        if (!hit) continue;
        bullet.inferred = true;
        draft.additions_to_review = dedupeById([
          ...(draft.additions_to_review || []),
          {
            id: `blocked-${bullet.id}`,
            kind: "bullet",
            location: bullet.id,
            text: bullet.text,
            reason: hit.fix_hint,
            confidence: "low",
            blocking: true,
          },
        ]);
        scrubbed.push(`blocked bullet ${bullet.id} — "${hit.term}" is on a Do NOT claim list`);
      }
    }
    if (survivors.find((i) => i.location === "summary")) {
      scrubbed.push(`the summary still names a Do NOT claim term — edit it by hand before exporting`);
    }
  }

  // Gap fills may name a Do NOT claim term (the user's choice, 2026-10-06:
  // the fill is invented work either way). He still gets to see it: each
  // such placement's review row says which list the term is on and why.
  // Checked one surface at a time with no index, so nothing is exempt. The
  // append is idempotent, so a revision does not stack a second sentence.
  {
    const deny = denyIndex(profile);
    const companyById = new Map(profile.roles.map((r) => [r.id, r.company]));
    const roleOfBullet = (id) => (draft.resume.experience || []).find((r) => (r.bullets || []).some((b) => b.id === id));
    for (const a of draft.additions_to_review || []) {
      if (a.blocking || !isGapFillReason(a) || /Do NOT claim list/.test(String(a.reason || ""))) continue;
      let synthetic = null;
      let roleId = null;
      if (a.kind === "bullet") {
        const role = roleOfBullet(a.location);
        if (!role) continue;
        roleId = role.role_id;
        synthetic = { experience: [{ role_id: roleId, bullets: [{ id: a.location, text: bulletText(draft, a.location) ?? a.text }] }] };
      } else if (a.kind === "skill") {
        const m = /^skills\/([^/]*)/.exec(String(a.location || ""));
        synthetic = { skill_groups: [{ title: m ? m[1] : "Skills", items: [a.text] }] };
      } else if (a.kind === "summary") {
        synthetic = { professional_summary: a.text };
      }
      if (!synthetic) continue;
      const notes = [];
      for (const hit of checkDoNotClaim(synthetic, profile)) {
        if (notes.some((n) => n.term === hit.term)) continue;
        const scope = deny.global.has(canonKey(hit.term)) ? "global" : `${companyById.get(roleId) || roleId}`;
        notes.push({ term: hit.term, scope, why: String(hit.why || "").slice(0, 200) });
      }
      if (!notes.length) continue;
      a.reason = `${String(a.reason || "").trim()} ${notes.map((n) => `"${n.term}" is on the ${n.scope} Do NOT claim list${n.why ? `: ${n.why}` : "."}`).join(" ")}`;
      scrubbed.push(`gap fill ${a.location} names ${notes.map((n) => `"${n.term}"`).join(", ")} (allowed as a fill; shown on its review row)`);
    }
  }

  // A strong gap-fill term in the summary is reviewed through the
  // without-fills version, which the export falls back to if he rejects
  // the term. If a rewrite let the term leak into that version, strip it
  // here so a rejection can never leave an invented term on the page.
  {
    const summaryTerms = (draft.additions_to_review || [])
      .filter((a) => a.kind === "summary" && !a.blocking)
      .map((a) => String(a.text || "").trim())
      .filter(Boolean);
    if (summaryTerms.length) {
      let without = typeof draft.resume.professional_summary_without_fills === "string"
        ? draft.resume.professional_summary_without_fills
        : draft.resume.professional_summary || "";
      for (const term of summaryTerms) {
        if (!matchTerm(term, without)) continue;
        without = stripTerm(without, term);
        scrubbed.push(`removed "${term}" from the without-fills summary — it is a gap-fill term, kept only in the full summary`);
      }
      draft.resume.professional_summary_without_fills = without;
    }
  }

  // Gap-fill placements and reframed bullets are on the page unless
  // rejected. applyReview and the coverage index derive that from the
  // "Gap fill:" / "Reframed:" reason prefix (so older documents follow the
  // same rule); the stamp makes the stored JSON say so too. The revise
  // schema drops `gate` on the way through the model, which is why this
  // runs on every finish, revisions included.
  for (const a of draft.additions_to_review || []) {
    if (!a.blocking && isInventedReason(a)) a.gate = "open";
  }

  // Composed bullets (no story behind them, not inferred) are allowed by
  // design; list them for review with an open gate so they export unless
  // rejected. Recomputed from the final draft so the listed text is current
  // and a bullet that ended up inferred or blocked above is not repeated.
  draft.additions_to_review = dedupeById([
    ...(draft.additions_to_review || []).filter((a) => !String(a.id).startsWith("composed-")),
    ...composedAdditions(draft, profile),
  ]);

  // Reviewer notes are informational: kind "note" so applyReview (which
  // resolves by kind) can never treat one as a bullet's gate, and gate
  // "open" so they never count as pending. Added last so no rewrite ever
  // saw them and the writer's schema is untouched.
  const roleIds = new Set((draft.resume.experience || []).map((r) => r.role_id));
  const noteAdditions = reviewNotes
    .filter((n) => n.location === "summary" || n.location === "skills" || roleIds.has(n.location) || bulletText(draft, n.location) !== undefined)
    .map((n, i) => ({
      id: `reviewer-note-${n.kind}-${slug(n.location)}-${i}`,
      kind: "note",
      location: n.location,
      text: bulletText(draft, n.location) ?? n.excerpt,
      reason: `Reviewer: ${REVIEW_LABEL[n.kind]}. ${n.fix_hint}`,
      confidence: "medium",
      gate: "open",
    }));
  draft.additions_to_review = dedupeById([...(draft.additions_to_review || []), ...noteAdditions]);

  // Last resort for length, once the rewrite budget is spent: the 9.5pt
  // layout step (shared/resumeLayout.js). Taken only when it actually
  // brings the résumé inside the budget; the preview and the .docx both
  // render at the step recorded on the document.
  if (isOverBudget(measured, maxPages)) {
    const tighter = await measurePages(draft, maxPages, 1);
    if (tighter.pages > 0 && !isOverBudget(tighter, maxPages)) measured = tighter;
  }

  draft.keyword_coverage = coverage;
  draft.jd_coverage = selection?.jd_coverage || [];
  draft.rewrite_notes = [
    ...(draft.rewrite_notes || []),
    ...scrubbed.map((n) => `do-not-claim: ${n}`),
    ...issues
      .filter((i) => i.kind === "missing_keyword" || i.kind === "missing_gap_fill")
      .map((i) => `coverage: ${i.fix_hint}`),
    ...issues
      .filter((i) => i.source === "reviewer" && i.severity !== "note")
      .map((i) => `reviewer: ${i.location}: ${i.fix_hint}`),
    ...issues
      .filter((i) => i.kind === "too_many_estimates" || i.kind === "reframe")
      .map((i) => `truth: ${i.location}: ${i.fix_hint}`),
    ...issues
      .filter((i) => !["untraceable_claim", "unverified_metric", "too_many_estimates", "reframe", "overflow", "missing_keyword", "missing_gap_fill", "do_not_claim", ...REVIEW_KINDS].includes(i.kind))
      .map((i) => `style: ${i.fix_hint}`),
    // Surfaced rather than silently accepted: the rewrite budget can run
    // out with the résumé still over length, and the reviewer should see
    // that rather than discover it in the PDF.
    ...(isOverBudget(measured, maxPages) ? [`length: still ${measured.pages} pages against a ${maxPages}-page budget — trim it by hand or reject some bullets.`] : []),
  ];
  draft.layout = { pages: measured.pages || null, max_pages: maxPages, measured_by: measured.method, step: measured.step || 0 };
  // ai_calls keeps no output, so the last review is kept on the document
  // for inspection: is the reviewer staying on truth and fit?
  draft.reviewer_report = lastReview
    ? { model: config.resume.reviewer.model, calls: config.resume.reviewer.maxCalls - reviewsLeft, issues: lastReview.issues }
    : null;

  return { draft, costUsd: totalCost };
}
