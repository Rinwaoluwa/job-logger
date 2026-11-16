// The one way a route (or the scheduler) queues work.

import { PRIORITY } from "../../shared/tasks.js";
import { createTask, defaultDedupeKey } from "../db/repo/tasks.js";
import { handlers } from "./handlers.js";
import { kickTasks } from "./worker.js";

/**
 * @returns {{ taskId: string, jobId: string|null, task: object, existing: boolean }}
 *   `existing` is true when the same work was already queued or running
 *   and that task was returned instead of a duplicate.
 */
export function startTask({ kind, jobId = null, payload = {}, priority = PRIORITY.user, groupId = null, dedupeKey }) {
  const handler = handlers[kind];
  if (!handler) throw new Error(`unknown task kind "${kind}"`);
  const stages = handler.stages(payload);
  const { task, existing } = createTask({
    kind, jobId, payload, priority, groupId, stages,
    dedupeKey: dedupeKey === undefined ? defaultDedupeKey(kind, jobId) : dedupeKey,
  });
  kickTasks();
  return { taskId: task.id, jobId: task.jobId, task, existing };
}
