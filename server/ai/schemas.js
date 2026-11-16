import { z } from "zod";

// zod v4: use z.toJSONSchema() (see ai/claude.js). Fields that might be
// absent are .nullable() rather than .optional() — the CLI's structured
// output is more reliable when every key is always present.

// Every role on the résumé carries at least MIN bullets, however minor the
// role or however little the posting overlaps with it. MIN is the floor the
// page-fit trim may fall back to; TARGET is what the plan asks for on every
// role (4 bullets of real work, one-liners on the older roles, about 20 on
// the page). Gap-fill bullets come on top of TARGET, capped per role and in
// total so the one-page budget (config.resume.maxPages) stays reachable.
// Enforced on the plan (pipelines/shared.js normalizePlan) and on the
// draft's bullets, so the writer, the rewrite pass and the trim inherit it.
export const MIN_BULLETS_PER_ROLE = 3;
export const TARGET_BULLETS_PER_ROLE = 4;
export const MAX_BULLET_FILLS_PER_ROLE = 2;
export const MAX_BULLET_FILLS_TOTAL = 8;
export const MAX_STRONG_FILLS = 2;
// Estimated figures per role: real-work "Estimate:" bullets plus gap-fill
// bullets carrying a figure. Stated in the prompts and enforced in
// verify.js (too_many_estimates), which sends the extra figure back for a
// rewrite in words.
export const MAX_ESTIMATES_PER_ROLE = 2;

export const jdAnalysisSchema = z.object({
  role_title: z.string(),
  company: z.string().nullable(),
  seniority: z.enum(["junior", "mid", "senior", "staff", "lead", "unknown"]),
  work_mode: z.enum(["onsite", "hybrid", "remote", "unknown"]),
  location: z.string().nullable(),
  location_constraints: z.array(z.string()),
  domain: z.string(),
  product_summary: z.string(),
  must_haves: z.array(
    z.object({
      text: z.string(),
      category: z.enum(["language", "framework", "infra", "database", "practice", "domain", "soft", "other"]),
      critical: z.boolean(),
    }),
  ).min(3).max(15),
  nice_to_haves: z.array(
    z.object({
      text: z.string(),
      category: z.enum(["language", "framework", "infra", "database", "practice", "domain", "soft", "other"]),
    }),
  ).max(15),
  responsibilities: z.array(z.string()).min(3).max(10),
  keywords: z.array(z.string()).min(8).max(25),
  tone: z.enum(["formal", "enterprise", "startup", "casual"]),
  red_flags: z.array(z.string()),
});

export const storySelectionSchema = z.object({
  summary_angle: z.string(),
  role_plan: z.array(
    z.object({
      role_id: z.string(),
      bullet_count: z.number().int().min(MIN_BULLETS_PER_ROLE).max(5),
      story_ids: z.array(z.string()),
      // Technologies the posting asks for that this role genuinely used;
      // the writer builds bullets that show each one doing real work.
      technologies_to_show: z.array(z.string()),
      angle: z.string(),
    }),
  ).min(1),
  jd_coverage: z.array(
    z.object({
      jd_item: z.string(),
      story_ids: z.array(z.string()),
      strength: z.enum(["strong", "partial", "none"]),
    }),
  ),
  skills_to_feature: z.array(z.string()),
  gaps: z.array(z.string()),
  // Requirements the profile does not cover, with a proposal for where a
  // plausible claim could sit. The writer turns each into an inferred
  // bullet or a flagged skill that is on the page unless the user rejects
  // it in the review panel.
  gap_fills: z.array(
    z.object({
      requirement: z.string(),
      // The posting's own terms (exact spelling) the fill must contain.
      // The coverage report matches by token, so a fill that paraphrases
      // the keyword ("runbooks" for "documentation") covers nothing.
      keywords: z.array(z.string()).min(1),
      // One or two roles where the claim is plausible, the more plausible
      // first. A "strong" fill (a critical must-have the profile lacks) is
      // placed like a real skill: a bullet on each listed role, a skills
      // entry and the summary, every placement gated. normalizePlan trims
      // the list to the roles that still have room under the fill caps.
      role_ids: z.array(z.string()).min(1).max(2),
      emphasis: z.enum(["standard", "strong"]),
      kind: z.enum(["bullet", "skill"]),
      // One or two sentences of concrete work for the writer to build the
      // bullet from: the artifact, the mechanism and the outcome for the
      // role's real users, in the planner's own words, never the posting's.
      idea: z.string(),
    }),
  ),
  // A technology on a role's "Technologies actually used" list that the
  // profile marks as secondary (a limiting note such as "legacy apps, not
  // the main build"), presented as that role's main build because the
  // posting leads with it. The writer rewrites the role's frontend bullets
  // in `technology`, never names the `replaces` entries on that role, and
  // gates every such bullet with a "Reframed:" review entry whose fallback
  // is the real-stack wording. Never a technology absent from the list
  // (that is a gap fill). normalizePlan validates each entry against the
  // profile and drops the rest. Empty in the normal case.
  reframes: z.array(
    z.object({
      role_id: z.string(),
      technology: z.string(),
      replaces: z.array(z.string()).min(1),
      note: z.string(),
    }),
  ),
});

/** Older plans carried a single role_id; read both shapes. */
export const gapFillRoles = (fill) => (fill?.role_ids?.length ? fill.role_ids : fill?.role_id ? [fill.role_id] : []);

export const bulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  source_story_ids: z.array(z.string()),
  metric_ids: z.array(z.string()),
  jd_items: z.array(z.string()),
  inferred: z.boolean(),
  // On a reframed bullet (review entry "Reframed: <Technology>."), the same
  // bullet in the role's real stack: the fallback the page prints when the
  // user rejects the reframe. Null on every other bullet.
  text_without_reframe: z.string().nullable(),
});

export const additionSchema = z.object({
  id: z.string(),
  // "summary" (location "summary", text = the term) and "stack"
  // (location "stack/<role_id>/<term>") gate a strong gap-fill term.
  kind: z.enum(["bullet", "skill", "summary", "stack"]),
  location: z.string(),
  text: z.string(),
  reason: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});

const skillGroupsSchema = z.array(z.object({ title: z.string(), items: z.array(z.string()) })).min(3).max(7);

export const resumeTailorSchema = z.object({
  resume: z.object({
    // The headline under the candidate's name. Tailored per job so the
    // résumé opens by naming the role it is applying for.
    target_title: z.string(),
    professional_summary: z.string(),
    // The same summary with every strong gap-fill term removed: the
    // fallback the export uses when the user rejects a summary gap-fill
    // term. Null when no gap fill touches the summary.
    professional_summary_without_fills: z.string().nullable(),
    skill_groups: skillGroupsSchema,
    experience: z.array(
      z.object({
        role_id: z.string(),
        stack: z.string(),
        // The résumé no longer prints a stack line (it cost a row per role
        // on a one-page résumé); the pipeline blanks both fields. They stay
        // in the schema so older documents still load.
        stack_fills: z.array(z.string()),
        // The label printed after the title ("Full-time, 40 hrs/week",
        // "Contract, task-based"), for overlapping roles. null = use the
        // profile's engagement line, "" = none on this résumé, text = this
        // label. The pipeline resolves it into engagement_label for the
        // renderers; the model only ever sees and sets the override.
        engagement: z.string().nullable(),
        bullets: z.array(bulletSchema).min(MIN_BULLETS_PER_ROLE),
      }),
    ).min(1),
    certifications: z.array(z.string()),
    education: z.array(z.string()),
  }),
  additions_to_review: z.array(additionSchema),
  match_score: z.number().int().min(0).max(100),
  must_have_gaps: z.array(z.string()),
  nice_to_have_gaps: z.array(z.string()),
  ats_keywords: z.array(z.string()),
  rewrite_notes: z.array(z.string()),
});

// A rewrite pass as a patch: only what changes. A full rewrite returned the
// whole résumé (about 11k output tokens, 70 s) to change a few bullets it
// had been told to copy verbatim; the patch carries those bullets alone and
// the app (ai/resumePatch.js) merges it, so untouched text is untouched by
// construction. Whole sections (summary pair, skill groups) are sent whole
// because they are small and the issues that target them name the section.
export const resumePatchSchema = z.object({
  summary: z.object({
    professional_summary: z.string(),
    professional_summary_without_fills: z.string().nullable(),
  }).nullable(),
  bullets: z.array(
    z.object({
      op: z.enum(["replace", "add", "remove"]),
      role_id: z.string(),
      // The existing id for replace/remove; for add, the next unused
      // "<role_id>-b<n>" on that role.
      id: z.string(),
      // The complete bullet for replace/add; null for remove.
      bullet: bulletSchema.nullable(),
    }),
  ),
  skill_groups: skillGroupsSchema.nullable(),
  additions: z.array(
    z.object({
      op: z.enum(["upsert", "remove"]),
      id: z.string(),
      entry: additionSchema.nullable(),
    }),
  ),
  match_score: z.number().int().min(0).max(100).nullable(),
  must_have_gaps: z.array(z.string()).nullable(),
  nice_to_have_gaps: z.array(z.string()).nullable(),
  ats_keywords: z.array(z.string()).nullable(),
  rewrite_notes: z.array(z.string()),
});

// A revision returns the same résumé shape plus the model's reply: one
// line per change it made and one per part of the instruction it could
// not honour (a do-not-claim term, a number with no verified metric).
export const resumeReviseSchema = resumeTailorSchema.extend({
  revision_notes: z.array(z.string()).min(1),
  // A one-shot call cannot pause to ask. Anything the instruction told
  // the model to ask about, or a value it needed and did not have, comes
  // back here and is shown as "Questions for you"; the user answers in
  // the next instruction.
  open_questions: z.array(z.string()),
});

// The reviewer's vocabulary is fixed and small on purpose: truth failures
// and undelivered plan items only. Style is not a kind, so the reviewer
// has nowhere to put an opinion about the writing.
export const REVIEW_KINDS = ["unsupported_claim", "unflagged_number", "technology_not_shown", "missing_impact", "summary_not_skills_profile"];

export const resumeReviewSchema = z.object({
  issues: z.array(
    z.object({
      kind: z.enum(REVIEW_KINDS),
      // Advisory; tailorResume.js caps severity by kind and by pass.
      severity: z.enum(["block", "fix", "note"]),
      role_id: z.string().nullable(),
      // A bullet id ("northwind-b2"), a role_id (technology_not_shown), "summary" or "skills".
      location: z.string(),
      // The exact words being judged.
      text: z.string(),
      // What the profile says instead, with story/metric ids.
      reason: z.string(),
      evidence: z.string().nullable(),
      // A fact to use (a metric id, a story outcome, a claim to narrow),
      // never a sentence to paste.
      suggested_fix: z.string().nullable(),
    }),
  ).max(20),
});

export const coverLetterSchema = z.object({
  paragraphs: z.array(z.string()).min(3).max(5),
  story_ids_used: z.array(z.string()),
  inferred_claims: z.array(z.object({ text: z.string(), reason: z.string() })),
  word_count: z.number().int(),
});

export const applicationAnswerSchema = z.object({
  answer: z.string(),
  story_ids_used: z.array(z.string()),
  inferred_claims: z.array(z.object({ text: z.string(), reason: z.string() })),
});

export const fitAnalysisSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.enum(["strong", "good", "stretch", "weak", "no"]),
  apply_recommendation: z.enum(["apply", "maybe", "skip"]),
  summary: z.string(),
  reasons_for: z.array(z.string()).max(6),
  reasons_against: z.array(z.string()).max(6),
  must_have_gaps: z.array(
    z.object({ requirement: z.string(), severity: z.enum(["blocker", "major", "minor"]), note: z.string() }),
  ),
  nice_to_have_gaps: z.array(z.string()),
  red_flags: z.array(
    z.object({
      kind: z.enum(["seniority", "visa", "location", "onsite", "salary", "domain", "stack", "other"]),
      detail: z.string(),
    }),
  ),
  suggested_angle: z.string().nullable(),
});

export const interviewQuestionSchema = z.object({
  question: z.string(),
  kind: z.enum(["behavioral", "technical", "system_design", "role_specific", "culture"]),
  why_asked: z.string(),
  story_ids: z.array(z.string()),
  talking_points: z.array(z.string()).min(2).max(5),
  draft_answer: z.string(),
  inferred: z.boolean(),
  // True when the question (or a close variant) is in the question bank:
  // he has been asked it before and the draft follows his own answer.
  from_bank: z.boolean(),
});

// One spoken answer with the beats to hit however the question is phrased.
const interviewPitchSchema = z.object({
  spoken: z.string(),
  beats: z.array(z.string()).min(3).max(6),
  story_ids: z.array(z.string()),
  inferred_claims: z.array(z.object({ text: z.string(), reason: z.string() })),
});

// The item shape is shared with server/ai/storyMap.js, which builds the
// same map deterministically from a résumé's plan before any AI runs.
export const storyMapItemSchema = z.object({
  jd_item: z.string(),
  kind: z.enum(["must_have", "responsibility", "nice_to_have"]),
  critical: z.boolean(),
  strength: z.enum(["strong", "partial", "none"]),
  stories: z.array(z.object({ story_id: z.string(), angle: z.string().nullable() })).max(3),
  // For partial/none: the honest one-liner to open with if it comes up.
  if_asked: z.string().nullable(),
});

export const interviewPrepSchema = z.object({
  story_map: z.array(storyMapItemSchema).min(1).max(25),
  // A coding round gets a short list; the others 10-14.
  questions: z.array(interviewQuestionSchema).min(6).max(14),
  pitch: z.object({
    about_me: interviewPitchSchema,
    why_this_role: interviewPitchSchema,
    why_leaving_current: interviewPitchSchema,
  }),
  // A must-have the profile does not cover: what to say, and the nearest
  // real experience to bridge from. Never a new claim.
  gap_defenses: z.array(
    z.object({
      requirement: z.string(),
      severity: z.enum(["blocker", "major", "minor"]).nullable(),
      honest_line: z.string(),
      bridge_story_id: z.string().nullable(),
      bridge: z.string(),
    }),
  ),
  // The résumé's gap-fill claims (invented, kept on the page by the
  // candidate's choice): how to speak to each one truthfully if probed.
  resume_claims: z.array(
    z.object({
      claim: z.string(),
      reason: z.string(),
      depth: z.enum(["did_it", "set_it_up", "know_the_approach"]),
      honest_line: z.string(),
      nearest_real_story_id: z.string().nullable(),
      probe_questions: z.array(z.string()).max(3),
    }),
  ),
  questions_to_ask_them: z.array(z.string()).min(4).max(6),
  prep_notes: z.array(z.string()),
  // The do-not-say list, pulled out of prep_notes so it is the first
  // thing on the page and on the day-of cheat sheet.
  watch_outs: z.array(z.object({ text: z.string(), why: z.string() })).max(12),
  // What to brush up before this round. Empty is fine (a recruiter screen).
  study_list: z.array(
    z.object({
      topic: z.string(),
      why: z.string(),
      what_to_review: z.string(),
      depth: z.enum(["refresh", "learn"]),
    }),
  ).max(10),
  // The handful of stories to have ready, and the sentence to open each with.
  top_stories: z.array(z.object({ story_id: z.string(), lead_with: z.string() })).max(6),
});

// One mock-interview answer judged against the prep's question card and
// the stories behind it (server/ai/pipelines/mockCritique.js).
export const mockCritiqueSchema = z.object({
  score: z.number().int().min(1).max(5),
  landed: z.array(z.string()),
  missed: z.array(z.string()),
  // Things said that the profile does not support, a watch-out forbids,
  // or that assert a résumé gap fill as done work.
  risky: z.array(z.object({ said: z.string(), why: z.string() })),
  timing: z.object({
    words: z.number().int(),
    est_seconds: z.number().int(),
    verdict: z.enum(["short", "good", "long"]),
  }),
  tightened: z.string(),
  follow_up: z.string().nullable(),
});

export const jobExtractSchema = z.object({
  is_job_posting: z.boolean(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  work_mode: z.enum(["onsite", "hybrid", "remote", "unknown"]),
  employment_type: z.string().nullable(),
  salary: z.string().nullable(),
  posted_at: z.string().nullable(),
  apply_url: z.string().nullable(),
  description_markdown: z.string(),
});

// "Find people" results. Stage 1 (web search) fills peopleFoundSchema;
// stage 2 (no tools) returns drafts keyed by person_key, which the
// pipeline merges onto each person before storing.
export const PERSON_ROLE_TYPES = ["hiring_manager", "recruiter", "peer", "other"];

export const PERSON_FOUND_VIA = ["linkedin", "company_site", "web_search", "other"];
export const PEOPLE_MAX = 15;

const personSchema = z.object({
  person_key: z.string(),
  name: z.string(),
  title: z.string(),
  role_type: z.enum(PERSON_ROLE_TYPES),
  location: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  other_urls: z.array(z.string()),
  source_url: z.string(),
  found_via: z.enum(PERSON_FOUND_VIA),
  evidence: z.string(),
  why_relevant: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  email_guess: z.string().nullable(),
  email_verified: z.literal(false),
});

// One round of the search. The pipeline merges rounds: people accumulate,
// `dropped` removes an earlier person the round found has left, and
// search_log / next_steps feed the following round's prompt.
export const peopleFoundSchema = z.object({
  company_domain: z.string().nullable(),
  linkedin_company_url: z.string().nullable(),
  email_pattern: z.string().nullable(),
  email_pattern_source: z.string().url().nullable(),
  people: z.array(personSchema).max(PEOPLE_MAX),
  dropped: z.array(z.object({ person_key: z.string(), reason: z.string() })),
  search_log: z.array(z.string()),
  next_steps: z.array(z.string()),
  exhausted: z.boolean(),
  search_notes: z.array(z.string()),
});

export const peopleOutreachSchema = z.object({
  drafts: z.array(
    z.object({
      person_key: z.string(),
      linkedin_note: z.string().max(300),
      message: z.string(),
      email_subject: z.string().max(80),
    }),
  ),
});
