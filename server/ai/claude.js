// Spawns the `claude` CLI in headless mode to get structured JSON output,
// riding on the Claude Code subscription instead of a separate API key.
// Ported from an earlier project.
//
// Verified shape (claude 2.1.268):
//   claude -p "<prompt>" --output-format json --json-schema '<schema>'
//     --system-prompt "<system>" --tools "" --no-session-persistence
//     --model <model> --effort <low|medium|high>
// returns a JSON object whose `structured_output` field is already the
// parsed, schema-validated result.
//
// Two modes. The default is tool-less and passes --strict-mcp-config so no
// MCP server (and none of the account's claude.ai connectors) loads. The
// `mcpTools` mode is for a call that must use one claude.ai connector tool
// (the routine log reads a Claude Doc this way): it drops the strict flag
// so the connectors are reachable, keeps only the built-in ToolSearch so
// the model can load that one tool's schema on demand, pre-approves just
// the named tools, and denies everything else (--permission-mode dontAsk).
// Measured on claude 2.1.301: ~20k input tokens and about half a cent on
// haiku per call, because connector tool schemas are deferred.

import { execFile } from "node:child_process";
import { z } from "zod";
import { config } from "../config.js";
import { claudeSemaphore } from "./semaphore.js";
import { insertAiCall } from "../db/repo/aiCalls.js";
import { currentTask, TaskCancelledError, throwIfCancelled } from "../tasks/context.js";

export class ClaudeCallError extends Error {}

// Start with the configured/PATH-resolved binary name; execClaude() falls
// back to the well-known absolute install path on ENOENT (npm scripts
// launched from GUI apps can have a thin PATH that doesn't see it).
let resolvedBin = config.claude.bin;

function execClaude(args, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TaskCancelledError());
      return;
    }
    const bin = resolvedBin;
    const child = execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10_000_000,
        // Close stdin immediately — otherwise the CLI waits ~3s per call
        // for input that will never arrive.
        stdio: ["ignore", "pipe", "pipe"],
        // Cancelling the task aborts this signal, which SIGTERMs the CLI.
        signal,
        killSignal: "SIGTERM",
      },
      (error, stdoutRaw, stderrRaw) => {
        const stdout = stdoutRaw?.toString() ?? "";
        const stderr = stderrRaw?.toString() ?? "";
        if (error) {
          if (error.name === "AbortError" || signal?.aborted) {
            reject(new TaskCancelledError());
            return;
          }
          if (error.code === "ENOENT" && bin !== config.claude.fallbackBin) {
            // Retry once with the fallback absolute path.
            resolvedBin = config.claude.fallbackBin;
            execClaude(args, timeoutMs, signal).then(resolve, reject);
            return;
          }
          // execFile's timeout sends SIGTERM; the CLI catches it and exits
          // with code 143, so error.signal is null and only `killed` says
          // the timeout fired.
          if (error.killed) {
            reject(new ClaudeCallError(`claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
            return;
          }
          // A non-zero exit with a JSON body on stdout is the CLI reporting
          // a failure (rate limit, overload, refusal) in the normal shape;
          // hand it up so the caller surfaces the CLI's own message.
          if (typeof error.code === "number" && /^\s*\{/.test(stdout)) {
            resolve(stdout);
            return;
          }
          // error.message would repeat the whole argv, prompt included.
          const noise = /Warning: no stdin data received[^\n]*\n?/g;
          const detail = stderr.replace(noise, "").trim().slice(0, 500);
          reject(
            new ClaudeCallError(
              `claude CLI exited with ${typeof error.code === "number" ? `code ${error.code}` : error.code || "an error"}${detail ? `: ${detail}` : ""}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
    child.on("error", () => {}); // handled via callback above
    // Belt and braces: if the CLI ignores SIGTERM, put it down for good.
    signal?.addEventListener(
      "abort",
      () => {
        const t = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, 5000);
        t.unref();
        child.once("exit", () => clearTimeout(t));
      },
      { once: true },
    );
  });
}

/**
 * @param {object} opts
 * @param {string} opts.purpose - short label for logging, e.g. "resume_write:job123"
 * @param {string} opts.system - system prompt
 * @param {string} opts.prompt - user prompt
 * @param {import("zod").ZodType} opts.schema - zod schema the structured output must satisfy
 * @param {"low"|"medium"|"high"} [opts.effort]
 * @param {string} [opts.model] - defaults to config.claude.model
 * @param {number} [opts.timeoutMs]
 * @param {string|null} [opts.jobId] - for ai_calls logging only
 * @param {AbortSignal} [opts.signal] - defaults to the running task's signal
 * @param {string[]} [opts.allowedTools] - built-in CLI tools to enable, e.g.
 *   ["WebSearch", "WebFetch"]. Empty (the default) disables every tool.
 *   Enabled tools are also pre-approved, since a permission prompt in
 *   headless mode would be auto-denied.
 * @param {number} [opts.maxBudgetUsd] - hard spend cap for one call; worth
 *   setting whenever tools are on, because an agent loop can run many turns.
 * @param {string[]} [opts.mcpTools] - full MCP tool names the call may use,
 *   e.g. ["mcp__claude_ai_Claude_Docs__read"]. Switches the CLI into the
 *   connector mode described in the header; `allowedTools` is ignored then.
 * @param {number} [opts.maxTurns] - agent-loop cap; defaults to 8 when
 *   `mcpTools` is set, otherwise the CLI's own default.
 * @param {object} [opts.mcpServers] - MCP servers of our own to start for
 *   this call, in the CLI's `mcpServers` config shape (the people search
 *   runs its LinkedIn reader this way). Passed inline through --mcp-config
 *   with --strict-mcp-config kept on, so the account's connectors still
 *   stay out. Combine with `allowedTools` naming the built-ins to enable
 *   and `mcpAllowedTools` naming the server tools to pre-approve.
 * @param {string[]} [opts.mcpAllowedTools] - full names of the tools on
 *   `mcpServers` the model may call, e.g. ["mcp__linkedin__linkedin_read"].
 */
export async function runClaude(opts) {
  const {
    purpose,
    system,
    prompt,
    schema,
    effort = "medium",
    model,
    timeoutMs = 180_000,
    jobId = null,
    signal = currentTask()?.signal,
    allowedTools = [],
    maxBudgetUsd,
    mcpTools = [],
    maxTurns = mcpTools.length ? 8 : undefined,
    mcpServers = null,
    mcpAllowedTools = [],
  } = opts;

  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new ClaudeCallError("runClaude: prompt must be a non-empty string");
  }
  if (prompt.length > 400_000) {
    throw new ClaudeCallError("runClaude: prompt too large for a single CLI argv element");
  }

  const resolvedModel = model || config.claude.model;

  const fullSchema = z.toJSONSchema(schema);
  const jsonSchema = { ...fullSchema };
  delete jsonSchema.$schema;

  const started = Date.now();
  let ok = false;
  let costUsd = null;
  let errorMessage = null;
  // Summed over both attempts when the schema retry fires, so the row
  // describes the whole call. queue_ms is the wait for a semaphore slot,
  // which duration_ms includes and the CLI's own duration_api_ms does not.
  let queueMs = 0;
  let apiMs = null;
  const usage = { input: null, output: null, cacheRead: null, cacheCreate: null };
  const addUsage = (u) => {
    if (!u || typeof u !== "object") return;
    const add = (key, v) => { if (typeof v === "number") usage[key] = (usage[key] ?? 0) + v; };
    add("input", u.input_tokens);
    add("output", u.output_tokens);
    add("cacheRead", u.cache_read_input_tokens);
    add("cacheCreate", u.cache_creation_input_tokens);
  };

  async function attempt(promptText) {
    throwIfCancelled(signal);
    // Connector mode: the model reaches the named MCP tools through
    // ToolSearch (their schemas load on demand), nothing else is approved.
    const toolArgs = mcpTools.length
      ? [
          "--tools", "ToolSearch",
          "--allowedTools", [...mcpTools, "ToolSearch"].join(","),
          "--permission-mode", "dontAsk",
        ]
      : mcpServers
        ? [
            // Own MCP server(s) plus the named built-ins. ToolSearch rides
            // along in case the CLI defers the server's tool schemas the
            // way it does the connectors'; it costs nothing otherwise.
            "--tools", [...allowedTools, "ToolSearch"].join(","),
            "--allowedTools", [...allowedTools, ...mcpAllowedTools, "ToolSearch"].join(","),
            "--mcp-config", JSON.stringify({ mcpServers }),
            "--strict-mcp-config",
            "--permission-mode", "dontAsk",
          ]
        : [
          "--tools", allowedTools.join(","),
          ...(allowedTools.length ? ["--allowedTools", allowedTools.join(",")] : []),
          // Without this, the CLI loads every MCP server configured for the
          // user (the IDE server, plugins, claude.ai connectors) into context
          // as tool names and schemas even though --tools "" prevents them
          // from being invoked. Measured impact: ~30-100k input tokens per
          // call vs. ~2k with this flag set (and no --mcp-config passed, so
          // nothing loads at all). Connector mode needs those servers, so it
          // is the one caller that leaves the flag off.
          "--strict-mcp-config",
        ];
    const args = [
      "-p", promptText,
      "--output-format", "json",
      "--json-schema", JSON.stringify(jsonSchema),
      "--system-prompt", system,
      ...toolArgs,
      ...(maxTurns ? ["--max-turns", String(maxTurns)] : []),
      ...(maxBudgetUsd ? ["--max-budget-usd", String(maxBudgetUsd)] : []),
      "--no-session-persistence",
      "--model", resolvedModel,
      "--effort", effort,
    ];
    const queuedAt = Date.now();
    const stdout = await claudeSemaphore.withSlot(() => {
      queueMs += Date.now() - queuedAt;
      return execClaude(args, timeoutMs, signal);
    }, { signal });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new ClaudeCallError(`claude CLI returned non-JSON stdout: ${stdout.slice(0, 300)}`);
    }
    addUsage(parsed.usage);
    if (typeof parsed.duration_api_ms === "number") apiMs = (apiMs ?? 0) + parsed.duration_api_ms;
    if (parsed.is_error || parsed.subtype !== "success") {
      throw new ClaudeCallError(
        `claude CLI reported failure (${parsed.subtype ?? "unknown"}): ${parsed.result ?? "no detail"}`,
      );
    }
    return parsed;
  }

  try {
    let parsed = await attempt(prompt);
    let result = schema.safeParse(parsed.structured_output);

    if (!result.success) {
      // One automatic retry: tell the model exactly what failed validation.
      const issues = result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      const retryPrompt = `${prompt}\n\nYour previous output failed schema validation: ${issues}. Return the full object again, fixing these issues.`;
      parsed = await attempt(retryPrompt);
      result = schema.safeParse(parsed.structured_output);
      if (!result.success) {
        throw new ClaudeCallError(`structured output failed validation twice: ${result.error.message}`);
      }
    }

    costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null;
    ok = true;
    return { data: result.data, costUsd, durationMs: Date.now() - started };
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    // A cancellation is not an AI failure; let it unwind untouched so the
    // worker can tell it apart from a real error.
    if (err instanceof TaskCancelledError) throw err;
    throw err instanceof ClaudeCallError ? err : new ClaudeCallError(`AI call failed: ${errorMessage}`);
  } finally {
    try {
      insertAiCall({
        purpose,
        jobId,
        model: resolvedModel,
        effort,
        durationMs: Date.now() - started,
        costUsd,
        ok,
        error: errorMessage,
        inputChars: prompt.length,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheCreateTokens: usage.cacheCreate,
        apiMs,
        queueMs,
      });
    } catch (logErr) {
      console.warn("[ai] failed to log ai_calls row:", logErr.message);
    }
  }
}
