import "dotenv/config";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..");

function bool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  return String(v).toLowerCase() === "1" || String(v).toLowerCase() === "true";
}

function int(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveClaudeBin() {
  const fromEnv = process.env.CLAUDE_BIN;
  if (fromEnv) return fromEnv;
  // Default to relying on PATH; callers fall back to ~/.local/bin/claude
  // (see server/ai/claude.js) if spawning "claude" fails with ENOENT.
  return "claude";
}

function loadSourcesConfig() {
  const configPath = path.resolve(ROOT, process.env.SOURCES_CONFIG || "config/sources.json");
  if (!existsSync(configPath)) {
    console.warn(`[config] sources config not found at ${configPath}; job sources will be disabled until it exists`);
    return { configPath, sources: null };
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    return { configPath, sources: JSON.parse(raw) };
  } catch (e) {
    console.warn(`[config] failed to parse ${configPath}: ${e.message}`);
    return { configPath, sources: null };
  }
}

const { configPath: sourcesConfigPath, sources: sourcesConfig } = loadSourcesConfig();

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",
  allowRemote: bool(process.env.ALLOW_REMOTE, false),

  claude: {
    bin: resolveClaudeBin(),
    fallbackBin: path.join(os.homedir(), ".local", "bin", "claude"),
    model: process.env.CLAUDE_MODEL || "sonnet",
    modelWrite: process.env.CLAUDE_MODEL_WRITE || "opus",
    // --effort for the résumé draft and the rewrite passes (the calls whose
    // wording ends up on the page). Everything else (plan, reviewer, cover
    // letter, answers, fit) keeps its own per-call setting.
    effortWrite: process.env.CLAUDE_EFFORT_WRITE || "high",
    // How many `claude` CLI processes may be alive at once, across every
    // background task. The subscription rate-limits, so more parallelism
    // means more chance of a call failing mid-pipeline.
    concurrency: int(process.env.CLAUDE_CONCURRENCY, 3),
  },

  // Headless Chrome page measurements that may overlap. Each one is a
  // full browser (~300MB) for a few seconds.
  chrome: {
    concurrency: int(process.env.CHROME_CONCURRENCY, 2),
  },

  // Background tasks (prepare application, interview prep, answer, fit,
  // add job by link, sources refresh). `concurrency` is how many run at
  // once; the rest wait in the queue, visible in the activity panel.
  // A task the server restarts under is re-queued and re-run from scratch;
  // after `maxAttempts` claims it is marked failed instead.
  tasks: {
    concurrency: int(process.env.TASK_CONCURRENCY, 3),
    maxAttempts: 2,
    recentLimit: 50,
    recentHours: 24,
    pruneAfterDays: 14,
  },

  resume: {
    // Page budget the tailor pipeline holds the résumé to, measured
    // against the export typography. One page: the bullet budget (4
    // real-work bullets per role, about 20, plus gap-fill bullets capped at
    // 2 per role, on the page unless rejected), no stack lines and the 9.5pt fallback step are all tuned
    // for it, and the writer prompts assume it.
    maxPages: Math.max(1, Number(process.env.RESUME_MAX_PAGES || 1)),
    // How a rewrite pass returns its changes: "patch" (only the changed
    // bullets, merged by ai/resumePatch.js) or "full" (the whole résumé
    // again, the pre-patch behaviour). A patch the merge refuses falls
    // back to a full rewrite for that pass either way.
    rewriteMode: process.env.RESUME_REWRITE_MODE === "full" ? "full" : "patch",
    // Truth and JD-fit reviewer that reads each draft before the rewrite
    // loop decides whether to rewrite. Set RESUME_REVIEWER=0 to skip it.
    reviewer: {
      enabled: bool(process.env.RESUME_REVIEWER, true),
      model: process.env.CLAUDE_MODEL_REVIEW || process.env.CLAUDE_MODEL || "sonnet",
      effort: process.env.RESUME_REVIEWER_EFFORT || "medium",
      // Once on the first draft, once more after the first rewrite at most.
      maxCalls: 2,
    },
  },

  adzuna: {
    appId: process.env.ADZUNA_APP_ID || "",
    appKey: process.env.ADZUNA_APP_KEY || "",
  },

  // "Find people": a multi-round web-search agent. Each round is one
  // `claude` call with WebSearch/WebFetch (and the LinkedIn tools when a
  // signed-in Chrome profile exists); the loop runs until the role targets
  // are met, the model reports the public record exhausted, the round cap
  // or the spend cap is reached. Opus by default: in agent loops it keeps
  // searching where Sonnet gives up after a handful of queries (measured
  // 2026-10-18: Sonnet runs stopped at ~5 queries and $0.12 of a $1 cap).
  people: {
    model: process.env.PEOPLE_MODEL || "opus",
    effort: process.env.PEOPLE_EFFORT || "high",
    maxCostUsd: num(process.env.PEOPLE_MAX_COST_USD, 6),
    roundBudgetUsd: num(process.env.PEOPLE_ROUND_BUDGET_USD, 2.5),
    maxRounds: int(process.env.PEOPLE_MAX_ROUNDS, 3),
    roundTimeoutMs: int(process.env.PEOPLE_ROUND_TIMEOUT_S, 1500) * 1000,
    // How many of each kind a search aims for; a round that leaves any of
    // these short triggers another round.
    targets: { hiring_manager: 1, recruiter: 2, peer: 3 },
    maxPeople: 15,
    linkedin: {
      enabled: bool(process.env.PEOPLE_LINKEDIN, true),
      // A Chrome profile of its own, signed in to LinkedIn once by hand.
      // Never the user's everyday browser profile.
      profileDir: path.resolve(ROOT, process.env.LINKEDIN_PROFILE_DIR || "data/chrome-linkedin"),
      // Per search run (all rounds and all parallel calls together).
      maxPagesPerRound: int(process.env.LINKEDIN_MAX_PAGES, 20),
    },
  },

  dbPath: path.resolve(ROOT, process.env.DB_PATH || "data/app.db"),

  // Default folder browsed by the attachment picker (the "Log application"
  // modal and the drawer's Attachments section) — overridable via the
  // attachments.source_folder setting stored in the settings table.
  defaultSourceFolder: path.join(os.homedir(), "Documents", "Generate Resumes"),

  sourcesConfigPath,
  sources: sourcesConfig,

  distDir: path.resolve(ROOT, "dist"),
};

export default config;
