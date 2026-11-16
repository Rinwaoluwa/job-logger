// What a task handler (and the pipelines it calls) gets to report progress
// with. Pipelines take `ctx = NOOP_CTX` so they still run from a script or
// a test with nothing listening.

import { beginStage, finishStage, failStage } from "../db/repo/tasks.js";
import { throwIfCancelled } from "./context.js";

export function makeCtx(taskId, signal) {
  return {
    taskId,
    signal,
    beginStage: (name) => beginStage(taskId, name),
    finishStage: (name, opts) => finishStage(taskId, name, opts),
    failStage: (name, err) => failStage(taskId, name, err),
    /** Throws if the task was cancelled; call between stages that cannot
     * themselves be interrupted (an HTTP fetch, a DB write loop). */
    checkpoint: () => throwIfCancelled(signal),
  };
}

export const NOOP_CTX = Object.freeze({
  taskId: null,
  signal: undefined,
  beginStage() {},
  finishStage() {},
  failStage() {},
  checkpoint() {},
});
