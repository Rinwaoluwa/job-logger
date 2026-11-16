// Small counting semaphore so at most N `claude` CLI processes (or N
// headless Chrome renders) run at once, however many background tasks
// are in flight. Tasks queue inside it in FIFO order.

import { config } from "../config.js";
import { TaskCancelledError } from "../tasks/context.js";

export function createSemaphore(maxConcurrent) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= maxConcurrent) return;
    const resolve = queue.shift();
    if (!resolve) return;
    active += 1;
    resolve();
  }

  return {
    /**
     * @param {() => Promise<any>} fn
     * @param {{signal?: AbortSignal}} [opts] - a task cancelled while it
     *   waited for a slot must not go on to spawn a process.
     */
    async withSlot(fn, { signal } = {}) {
      if (active >= maxConcurrent) {
        await new Promise((resolve) => queue.push(resolve));
      } else {
        active += 1;
      }
      try {
        if (signal?.aborted) throw new TaskCancelledError();
        return await fn();
      } finally {
        active -= 1;
        next();
      }
    },
  };
}

export const claudeSemaphore = createSemaphore(config.claude.concurrency);
