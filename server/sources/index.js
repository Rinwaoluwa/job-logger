import { adapters } from "./adapters/index.js";
import { toJob, withinMaxAge } from "./normalize.js";
import { upsertJob } from "./dedup.js";
import { startSourceRun, finishSourceRun, latestRunsPerSource } from "../db/repo/sourceRuns.js";
import { enqueueFit } from "../db/repo/tasks.js";
import { PRIORITY } from "../../shared/tasks.js";
import { NOOP_CTX } from "../tasks/ctx.js";
import { isCancelled } from "../tasks/context.js";
import { config } from "../config.js";

function passesTitleFilter(title, filters) {
  const t = (title || "").toLowerCase();
  if (filters?.title_must_match?.length && !filters.title_must_match.some((w) => t.includes(w.toLowerCase()))) return false;
  if (filters?.title_exclude?.length && filters.title_exclude.some((w) => t.includes(w.toLowerCase()))) return false;
  return true;
}

/** The adapters a refresh will actually hit, in order — one task stage each. */
export function refreshTargets({ only } = {}) {
  const cfg = config.sources;
  if (!cfg) return [];
  const targets = only?.length ? adapters.filter((a) => only.includes(a.name)) : adapters;
  return targets.filter((a) => a.enabled(cfg));
}

/**
 * @param {object} opts
 * @param {string[]} [opts.only] - restrict to these adapter names
 * @param {string|null} [opts.groupId] - task id the queued fit scoring is
 *   grouped under, so the activity panel can show it as one row
 * @param {object} [opts.ctx] - task context for per-source progress
 */
export async function refreshAll({ only, groupId = null, ctx = NOOP_CTX } = {}) {
  const cfg = config.sources;
  if (!cfg) {
    throw new Error(`Sources config not found at ${config.sourcesConfigPath}. Create it from config/sources.example.json.`);
  }

  const targets = only?.length ? adapters.filter((a) => only.includes(a.name)) : adapters;
  const runSummaries = [];

  for (const adapter of targets) {
    if (!adapter.enabled(cfg)) {
      runSummaries.push({ source: adapter.name, skipped: true });
      continue;
    }
    // A board fetch cannot be interrupted, but a cancel lands between them.
    ctx.checkpoint();
    ctx.beginStage(adapter.name);

    const runId = startSourceRun(adapter.name);
    let fetched = 0, inserted = 0, updated = 0, skipped = 0;
    try {
      const rawJobs = await adapter.fetch_(cfg);
      fetched = rawJobs.length;

      let enqueuedThisRun = 0;
      const maxFitPerRefresh = cfg.fit?.max_per_refresh ?? 40;

      for (const raw of rawJobs) {
        // A trusted adapter (the daily routine's log) has already judged
        // each job against the candidate's brief; the generic title and
        // age filters are for broad board queries and would drop its picks.
        if (!adapter.trusted) {
          if (!passesTitleFilter(raw.title, cfg.filters)) { skipped++; continue; }
          if (!withinMaxAge(raw.posted_at, cfg.filters?.max_age_days)) { skipped++; continue; }
        }

        const normalized = toJob(raw);
        const { job: savedJob, created } = upsertJob(normalized);
        if (created) {
          inserted++;
          if (cfg.fit?.auto_run !== false && enqueuedThisRun < maxFitPerRefresh) {
            enqueueFit(savedJob.id, { priority: PRIORITY.background, groupId });
            enqueuedThisRun++;
          }
        } else {
          updated++;
        }
      }

      finishSourceRun(runId, { ok: true, fetched, inserted, updated, skipped });
      runSummaries.push({ source: adapter.name, ok: true, fetched, inserted, updated, skipped });
      ctx.finishStage(adapter.name);
    } catch (e) {
      finishSourceRun(runId, { ok: false, fetched, inserted, updated, skipped, error: e.message });
      if (isCancelled(e)) throw e;
      // One board being down is not a failed refresh; the others still run.
      runSummaries.push({ source: adapter.name, ok: false, error: e.message });
      ctx.failStage(adapter.name, e);
    }
  }

  return runSummaries;
}

export function sourcesStatus() {
  return {
    sources: adapters.map((a) => ({ name: a.name, enabled: config.sources ? a.enabled(config.sources) : false })),
    lastRuns: latestRunsPerSource(),
  };
}
