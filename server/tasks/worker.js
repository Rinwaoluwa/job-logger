// The in-process worker that drives background tasks. It runs inside the
// Express server rather than as a separate process: the app is single-
// user and local, and node:sqlite is one synchronous connection, so a
// second process would only add write contention.
//
// It claims up to config.tasks.concurrency queued tasks at a time, in
// priority order, and keeps the last slot for user-initiated work so a
// "Prepare application" never waits behind forty background fit scores.
// Each running task has an AbortController; cancelling aborts it, which
// kills the `claude` and Chrome children through the signal carried in
// AsyncLocalStorage (see context.js).

import { config } from "../config.js";
import { PRIORITY } from "../../shared/tasks.js";
import {
  claimNext, finishTask, failTask, cancelTask, requeueStuckRunning, pruneOld, activeTaskIds,
} from "../db/repo/tasks.js";
import { taskStore, isCancelled } from "./context.js";
import { makeCtx } from "./ctx.js";
import { handlers } from "./handlers.js";
import { onTaskQueued } from "./kick.js";

const running = new Map(); // taskId -> { controller, task }
let kickPending = false;
let stopped = false;

/** Fire-and-forget nudge; safe to call from anywhere, any number of times. */
export function kickTasks() {
  if (kickPending || stopped) return;
  kickPending = true;
  setImmediate(() => {
    kickPending = false;
    try {
      fill();
    } catch (e) {
      console.error("[tasks] worker loop failed:", e);
    }
  });
}

function fill() {
  const max = config.tasks.concurrency;
  while (running.size < max) {
    const reserveLast = max > 1 && running.size >= max - 1;
    const task = claimNext({ minPriority: reserveLast ? PRIORITY.user : null });
    if (!task) return;
    const controller = new AbortController();
    running.set(task.id, { controller, task });
    runOne(task, controller).finally(() => {
      running.delete(task.id);
      kickTasks();
    });
  }
}

async function runOne(task, controller) {
  const { signal } = controller;
  const ctx = makeCtx(task.id, signal);
  const handler = handlers[task.kind];
  try {
    if (!handler) throw new Error(`no handler for task kind "${task.kind}"`);
    const result = await taskStore.run({ taskId: task.id, signal }, () => handler.run(task, ctx));
    if (signal.aborted) return; // cancelTask already wrote the terminal row
    finishTask(task.id, result ?? null);
  } catch (e) {
    if (signal.aborted || isCancelled(e)) {
      cancelTask(task.id);
      return;
    }
    console.error(`[tasks] ${task.kind} ${task.id} failed:`, e);
    failTask(task.id, e);
  }
}

/** Cancels one task: aborts it if running, marks it cancelled either way. */
export function cancel(taskId) {
  const r = running.get(taskId);
  if (r) r.controller.abort();
  return cancelTask(taskId);
}

export function cancelByJob(jobId) {
  const ids = activeTaskIds({ jobId });
  for (const id of ids) cancel(id);
  return ids;
}

export function cancelGroup(groupId) {
  const ids = activeTaskIds({ groupId });
  for (const id of ids) cancel(id);
  return ids;
}

export function startWorker() {
  requeueStuckRunning({ maxAttempts: config.tasks.maxAttempts });
  pruneOld({ days: config.tasks.pruneAfterDays });
  onTaskQueued(kickTasks);
  kickTasks();
}

/** Aborts everything in flight so no `claude` or Chrome process outlives
 * the server (a `node --watch` reload would otherwise leave them running
 * while the re-queued task starts a second copy). */
export function shutdownWorker() {
  stopped = true;
  for (const { controller } of running.values()) controller.abort();
}
