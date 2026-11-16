// "Find people": who at the company is worth contacting for this job, and
// a draft note for each. A multi-round web-search agent loop that only
// sees the job (plus the applicant's hints), then a plain structured call
// that writes the drafts from the compact profile. Zero people is a stored
// result, not a failure, so the search notes reach the UI.
//
// Depth (2026-10-18): one agent call used to stop after a handful of
// searches. Now each round gets a minimum amount of work, a budget and the
// log of what earlier rounds tried; the loop runs again while any role
// target is short, the model does not call the record exhausted, and the
// spend cap allows. Results build on the job's previous search unless the
// caller starts fresh, so nothing found earlier is lost. When a signed-in
// LinkedIn Chrome profile exists, each round also gets the linkedin_*
// tools served by server/people/linkedinMcp.js.

import path from "node:path";
import { runClaude } from "../claude.js";
import { config, ROOT } from "../../config.js";
import { peopleFoundSchema, peopleOutreachSchema } from "../schemas.js";
import {
  peopleSearchSystem, peopleSearchPrompt, PEOPLE_OUTREACH_SYSTEM, peopleOutreachPrompt, ROLE_WORDS,
} from "../prompts/peopleSearch.js";
import { profileFull, signOffName } from "../../profile/render.js";
import { getProfile } from "../../profile/loader.js";
import { getJob } from "../../db/repo/jobs.js";
import { getApplication } from "../../db/repo/applications.js";
import { insertPeopleSearch, latestPeopleSearchForJob, updatePeopleSearch } from "../../db/repo/peopleSearches.js";
import { setSetting } from "../../db/repo/settings.js";
import { detectAtsBoard } from "../../sources/extract.js";
import { checkSignedIn } from "../../people/linkedin.js";
import { openRun, closeRun } from "../../people/linkedinReader.js";
import { NOOP_CTX } from "../../tasks/ctx.js";
import { isCancelled } from "../../tasks/context.js";

export const PEOPLE_STAGES = ["linkedin_check", "people_search", "people_outreach"];

/** The stages a run will report, given the current config. */
export function peopleStages() {
  return config.people.linkedin.enabled ? [...PEOPLE_STAGES] : PEOPLE_STAGES.filter((s) => s !== "linkedin_check");
}

const WEB_TOOLS = ["WebSearch", "WebFetch"];
const LINKEDIN_TOOLS = ["linkedin_people_search", "linkedin_company_people", "linkedin_read"];
const JD_SUMMARY_CHARS = 1500;
// Kept back from the search rounds so the drafting call can always run.
const OUTREACH_RESERVE_USD = 0.6;
// Below this a search call cannot do real work; stop rather than start it.
const MIN_CALL_BUDGET_USD = 0.5;
// "exhausted" from a call that barely searched is not believed.
const MIN_LOG_FOR_EXHAUSTED = 4;
// A round is one call per role still short, run in parallel; this is the
// order their results are folded in (and the order a stage reports).
const ROLE_ORDER = ["hiring_manager", "recruiter", "peer"];
const MAX_NOTES = 40;
// Outreach drafting runs in small parallel batches: one call for fifteen
// people on top of the full profile overran its timeout and lost the lot.
const OUTREACH_BATCH = 5;
const OUTREACH_TIMEOUT_MS = 420_000;

// Hosts that carry postings for many employers; a job URL on one of these
// says nothing about the employer's own domain.
const AGGREGATOR_HOSTS = [
  "linkedin.com", "indeed.com", "glassdoor.", "adzuna.", "jackandjill", "workday", "myworkdayjobs.com",
  "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "jobvite.com", "icims.com",
  "bamboohr.com", "workable.com", "recruitee.com", "ziprecruiter.com", "wellfound.com", "google.com",
  "eightfold.ai",
];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Best local guess at the employer's domain; null means stage 1 must find it. */
export function guessCompanyDomain(job) {
  const fromRaw = job.raw?.company_domain;
  if (typeof fromRaw === "string" && fromRaw.includes(".")) return fromRaw.replace(/^www\./, "").toLowerCase();
  for (const url of [job.apply_url, job.url]) {
    if (!url || /^manual:/.test(url)) continue;
    if (detectAtsBoard(url)) continue;
    const host = hostOf(url);
    if (!host || AGGREGATOR_HOSTS.some((a) => host.includes(a))) continue;
    // careers.acme.com and jobs.acme.com are still acme.com.
    const parts = host.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : host;
  }
  return null;
}

function jdSummaryFor(job) {
  if (job.jd_analysis) return JSON.stringify(job.jd_analysis, null, 2);
  return (job.description_text || "").slice(0, JD_SUMMARY_CHARS);
}

function locationOf(job) {
  return job.location_raw || [job.city, job.region, job.country].filter(Boolean).join(", ") || null;
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
const nameKey = (p) => String(p.name || "").toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

/**
 * Folds one round's people into the running list. Matches by person_key,
 * else by name; a match keeps its key and drafts and takes the newer
 * entry's facts when the newer evidence is at least as confident (a round
 * that confirmed a title on LinkedIn should win over an old snippet).
 * `dropped` removes people the round found have left.
 */
export function mergePeople(existing, incoming, dropped = [], { maxPeople = config.people.maxPeople } = {}) {
  const out = existing.map((p) => ({ ...p }));
  for (const p of incoming) {
    const i = out.findIndex((q) => q.person_key === p.person_key || (nameKey(q) && nameKey(q) === nameKey(p)));
    if (i < 0) {
      out.push({ ...p, drafts: null });
      continue;
    }
    const q = out[i];
    const newer = (CONFIDENCE_RANK[p.confidence] || 0) >= (CONFIDENCE_RANK[q.confidence] || 0);
    const base = newer ? { ...q, ...p } : { ...q };
    out[i] = {
      ...base,
      person_key: q.person_key,
      linkedin_url: (newer ? p.linkedin_url : q.linkedin_url) || q.linkedin_url || p.linkedin_url || null,
      other_urls: uniq([...(q.other_urls || []), ...(p.other_urls || [])]),
      location: base.location ?? q.location ?? p.location ?? null,
      email_guess: base.email_guess ?? q.email_guess ?? p.email_guess ?? null,
      drafts: q.drafts ?? null,
    };
  }
  const drop = new Set(dropped.map((d) => d.person_key));
  return out.filter((p) => !drop.has(p.person_key)).slice(0, maxPeople);
}

/** Which role targets the list still falls short of, as {role: shortfall}. */
export function computeGaps(people, targets = config.people.targets) {
  const counts = {};
  for (const p of people) counts[p.role_type] = (counts[p.role_type] || 0) + 1;
  const gaps = {};
  for (const [role, n] of Object.entries(targets)) {
    const short = n - (counts[role] || 0);
    if (short > 0) gaps[role] = short;
  }
  return gaps;
}

/** The MCP server each search call gets: a proxy onto the server's shared
 * LinkedIn browser, keyed by the search run's token. */
function linkedinMcpServers(token) {
  return {
    linkedin: {
      command: process.execPath,
      args: [path.resolve(ROOT, "server/people/linkedinMcp.js")],
      env: { LINKEDIN_APP_URL: `http://127.0.0.1:${config.port}`, LINKEDIN_RUN_TOKEN: token },
    },
  };
}

/** Is the LinkedIn profile usable for this run? Records the answer in the
 * settings table so the People tab can show it without another check. */
async function linkedinAvailability(ctx) {
  if (!config.people.linkedin.enabled) return { status: "disabled", reason: "LinkedIn reading is turned off (PEOPLE_LINKEDIN=0)." };
  ctx.beginStage("linkedin_check");
  try {
    const r = await checkSignedIn(config.people.linkedin.profileDir);
    setSetting("linkedin.status", JSON.stringify(r));
    ctx.finishStage("linkedin_check");
    return r.connected ? { status: "connected", reason: null } : { status: "signed_out", reason: r.reason };
  } catch (e) {
    if (isCancelled(e)) throw e;
    ctx.failStage("linkedin_check", e);
    return { status: "unavailable", reason: e.message };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} [opts.hints] - the applicant's free-text hints (team, names, site)
 * @param {boolean} [opts.buildOn] - start from the job's latest search (default) or fresh
 */
export async function runPeopleSearch({ jobId, hints = "", buildOn = true, ctx = NOOP_CTX }) {
  const job = getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  const cfg = config.people;
  hints = String(hints || "").trim();

  const prior = buildOn ? latestPeopleSearchForJob(jobId) : null;
  const priorResult = prior?.result_json || {};
  let people = Array.isArray(priorResult.people) ? priorResult.people.map((p) => ({ ...p })) : [];
  let companyDomain = priorResult.company_domain || guessCompanyDomain(job);
  let linkedinCompanyUrl = priorResult.linkedin_company_url || null;
  let emailPattern = priorResult.email_pattern || null;
  let emailPatternSource = priorResult.email_pattern_source || null;

  const linkedin = await linkedinAvailability(ctx);
  const useLinkedIn = linkedin.status === "connected";

  let spent = 0;
  const searchLog = [];
  const notes = [];
  const nextStepsByRole = {};
  const exhaustedRoles = new Set();
  let rounds = 0;
  if (linkedin.status !== "connected") notes.push(`LinkedIn tools ${linkedin.status === "disabled" ? "off" : "not used"}: ${linkedin.reason}`);
  const flatNextSteps = () => ROLE_ORDER.flatMap((r) => (nextStepsByRole[r] || []).map((l) => `[${ROLE_WORDS[r]}] ${l}`));

  // One row per run, written after every round and again at the end, so a
  // round or the drafting stage failing later cannot throw away people
  // already found: the next "Search deeper" builds on the partial row.
  let savedId = null;
  const save = (partial) => {
    const row = {
      jobId,
      companyDomain,
      hints: hints || null,
      costUsd: spent,
      resultJson: {
        company_domain: companyDomain,
        linkedin_company_url: linkedinCompanyUrl,
        email_pattern: emailPattern,
        email_pattern_source: emailPatternSource,
        people,
        search_notes: uniq(notes).slice(-MAX_NOTES),
        search_log: searchLog,
        next_steps: flatNextSteps(),
        next_steps_by_role: nextStepsByRole,
        rounds,
        exhausted: ROLE_ORDER.every((r) => exhaustedRoles.has(r) || !computeGaps(people, cfg.targets)[r]),
        linkedin,
        built_on: prior?.id ?? null,
        cost_usd: spent,
        partial,
      },
    };
    if (savedId) return updatePeopleSearch(savedId, row);
    const saved = insertPeopleSearch(row);
    savedId = saved.id;
    return saved;
  };

  // One LinkedIn run for the whole search: every parallel call's MCP proxy
  // reads through the server's browser under this token, sharing one page
  // cap and one pause between pages.
  const liRun = useLinkedIn ? openRun({ maxPages: cfg.linkedin.maxPagesPerRound, profileDir: cfg.linkedin.profileDir }) : null;
  try {
    for (let round = 1; round <= cfg.maxRounds; round++) {
      const gaps = computeGaps(people, cfg.targets);
      // A round is one call per role still short and not yet given up on.
      const roles = ROLE_ORDER.filter((r) => gaps[r] && !exhaustedRoles.has(r));
      if (!roles.length) break;
      const remaining = cfg.maxCostUsd - spent - OUTREACH_RESERVE_USD;
      const perCall = Math.min(cfg.roundBudgetUsd, remaining) / roles.length;
      if (perCall < MIN_CALL_BUDGET_USD) {
        notes.push(`Stopped before round ${round}: the $${cfg.maxCostUsd} spend cap for one search was reached.`);
        break;
      }

      ctx.checkpoint();
      ctx.beginStage("people_search");
      const results = await Promise.allSettled(
        roles.map((role) =>
          runClaude({
            purpose: `people_search[web]:${jobId}:r${round}:${role}`,
            system: peopleSearchSystem({ linkedin: useLinkedIn }),
            prompt: peopleSearchPrompt({
              jobTitle: job.title,
              jobCompany: job.company,
              location: locationOf(job),
              domainHint: companyDomain,
              linkedinCompanyUrl,
              jdSummary: jdSummaryFor(job),
              hints,
              round,
              maxRounds: cfg.maxRounds,
              budgetUsd: perCall,
              timeoutMin: Math.round(cfg.roundTimeoutMs / 60_000),
              linkedin: { available: useLinkedIn, reason: linkedin.reason },
              targets: cfg.targets,
              gaps,
              known: people,
              searchLog,
              nextSteps: nextStepsByRole[role] || [],
              role,
              roleTarget: cfg.targets[role],
            }),
            schema: peopleFoundSchema,
            effort: cfg.effort,
            model: cfg.model,
            timeoutMs: cfg.roundTimeoutMs,
            allowedTools: WEB_TOOLS,
            ...(liRun
              ? { mcpServers: linkedinMcpServers(liRun.token), mcpAllowedTools: LINKEDIN_TOOLS.map((t) => `mcp__linkedin__${t}`) }
              : {}),
            maxBudgetUsd: perCall,
            jobId,
          }),
        ),
      );
      const cancelled = results.find((r) => r.status === "rejected" && isCancelled(r.reason));
      if (cancelled) throw cancelled.reason;

      let roundCost = 0;
      const failures = [];
      results.forEach((r, i) => {
        const role = roles[i];
        if (r.status === "rejected") {
          failures.push(`${ROLE_WORDS[role]}: ${r.reason?.message || r.reason}`);
          return;
        }
        const { data, costUsd } = r.value;
        roundCost += costUsd || 0;
        people = mergePeople(people, data.people, data.dropped, { maxPeople: cfg.maxPeople });
        companyDomain = data.company_domain || companyDomain;
        linkedinCompanyUrl = data.linkedin_company_url || linkedinCompanyUrl;
        if (data.email_pattern && !emailPattern) {
          emailPattern = data.email_pattern;
          emailPatternSource = data.email_pattern_source || emailPatternSource;
        }
        searchLog.push(...data.search_log.map((l) => `round ${round} [${ROLE_WORDS[role]}]: ${l}`));
        notes.push(...data.search_notes);
        for (const d of data.dropped) notes.push(`Dropped ${d.person_key}: ${d.reason}`);
        nextStepsByRole[role] = data.next_steps;
        if (data.exhausted && data.search_log.length >= MIN_LOG_FOR_EXHAUSTED) exhaustedRoles.add(role);
      });
      spent += roundCost;

      if (failures.length === results.length) {
        const err = new Error(`every search call failed: ${failures.join("; ")}`);
        ctx.failStage("people_search", err);
        // A later round failing (budget cut-off, timeout) must not throw
        // away what earlier rounds found.
        if (round > 1 && people.length) {
          notes.push(`Round ${round} failed and was skipped: ${failures.join("; ")}`);
          break;
        }
        throw err;
      }
      if (failures.length) notes.push(`Round ${round}: a call failed and its role is retried next round if budget allows (${failures.join("; ")}).`);
      ctx.finishStage("people_search", { costUsd: roundCost });
      rounds = round;
      save(true);

      for (const r of ROLE_ORDER) {
        if (exhaustedRoles.has(r) && computeGaps(people, cfg.targets)[r]) notes.push(`${ROLE_WORDS[r]}: the search reported the public record exhausted after round ${round}.`);
      }
    }
  } finally {
    if (liRun) closeRun(liRun.token);
  }

  // Drafts only for people who have none yet: an earlier run's drafts stay.
  const undrafted = people.filter((p) => !p.drafts?.message);
  if (undrafted.length) {
    ctx.checkpoint();
    ctx.beginStage("people_outreach");
    const profile = getProfile();
    // The profile is the only source of facts here, on purpose: the
    // résumé carries gap fills by the user's choice, and an invented
    // claim must never reach a real person's inbox.
    const whyLookingText = profile.facts.whyLooking && !profile.facts.whyLooking.includes("<ask") ? profile.facts.whyLooking : "";
    const shared = {
      jobTitle: job.title,
      jobCompany: job.company,
      jdAnalysis: job.jd_analysis || { note: "no analysis; see posting excerpt", excerpt: jdSummaryFor(job) },
      profileFullText: profileFull(profile),
      whyLookingText,
      header: profile.facts.header || {},
      signOff: signOffName(profile),
      years: profile.facts.years ?? null,
      applied: getApplication(jobId) || null,
    };
    const batches = [];
    for (let i = 0; i < undrafted.length; i += OUTREACH_BATCH) batches.push(undrafted.slice(i, i + OUTREACH_BATCH));
    const results = await Promise.allSettled(
      batches.map((batch, i) =>
        runClaude({
          purpose: `people_outreach:${jobId}:b${i + 1}`,
          system: PEOPLE_OUTREACH_SYSTEM,
          prompt: peopleOutreachPrompt({ ...shared, people: batch }),
          schema: peopleOutreachSchema,
          effort: "medium",
          model: config.claude.model,
          timeoutMs: OUTREACH_TIMEOUT_MS,
          jobId,
        }),
      ),
    );
    const cancelled = results.find((r) => r.status === "rejected" && isCancelled(r.reason));
    if (cancelled) throw cancelled.reason;
    const byKey = new Map();
    let outreachCost = 0;
    const failures = [];
    for (const r of results) {
      if (r.status === "rejected") {
        failures.push(r.reason?.message || String(r.reason));
        continue;
      }
      outreachCost += r.value.costUsd || 0;
      for (const d of r.value.data.drafts) byKey.set(d.person_key, d);
    }
    spent += outreachCost;
    people = people.map((p) => {
      if (p.drafts?.message) return p;
      const d = byKey.get(p.person_key);
      return { ...p, drafts: d ? { linkedin_note: d.linkedin_note, message: d.message, email_subject: d.email_subject } : null };
    });
    if (failures.length) {
      // The people are kept; "Search deeper" drafts whoever is still
      // without a message.
      const left = people.filter((p) => !p.drafts?.message).length;
      notes.push(`Outreach drafting failed for ${left} ${left === 1 ? "person" : "people"} (${uniq(failures).join("; ")}). Search deeper to draft them.`);
      if (failures.length === results.length) ctx.failStage("people_outreach", new Error(uniq(failures).join("; ")));
      else ctx.finishStage("people_outreach", { costUsd: outreachCost });
    } else {
      ctx.finishStage("people_outreach", { costUsd: outreachCost });
    }
  }

  return save(false);
}
