import { run, all, get } from "../index.js";

export function insertAiCall({
  purpose, jobId = null, model, effort, durationMs, costUsd = null, ok, error = null, inputChars = null,
  inputTokens = null, outputTokens = null, cacheReadTokens = null, cacheCreateTokens = null, apiMs = null, queueMs = null,
}) {
  run(
    `INSERT INTO ai_calls (purpose, job_id, model, effort, duration_ms, cost_usd, ok, error, input_chars,
       input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, api_ms, queue_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [purpose, jobId, model, effort, durationMs, costUsd, ok ? 1 : 0, error, inputChars,
      inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, apiMs, queueMs],
  );
}

export function listAiCalls(limit = 100) {
  return all(`SELECT * FROM ai_calls ORDER BY id DESC LIMIT ?`, [limit]);
}

export function costSummary() {
  const totalUsd = get(`SELECT COALESCE(SUM(cost_usd), 0) AS v FROM ai_calls`)?.v ?? 0;
  const todayUsd = get(`SELECT COALESCE(SUM(cost_usd), 0) AS v FROM ai_calls WHERE date(created_at) = date('now')`)?.v ?? 0;
  const weekUsd = get(`SELECT COALESCE(SUM(cost_usd), 0) AS v FROM ai_calls WHERE created_at >= datetime('now', '-7 days')`)?.v ?? 0;
  const callsToday = get(`SELECT COUNT(*) AS v FROM ai_calls WHERE date(created_at) = date('now')`)?.v ?? 0;
  const lastCall = get(`SELECT * FROM ai_calls ORDER BY id DESC LIMIT 1`) ?? null;
  return { totalUsd, todayUsd, weekUsd, callsToday, lastCall };
}
