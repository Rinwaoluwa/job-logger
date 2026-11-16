// The running task's identity and cancellation signal, carried implicitly
// through every await beneath the handler by AsyncLocalStorage. This is
// how `runClaude` and `htmlToPdf` learn they should stop without every
// helper between the handler and the process spawn threading a `signal`
// argument through its signature.

import { AsyncLocalStorage } from "node:async_hooks";

export const taskStore = new AsyncLocalStorage();

/** `{ taskId, signal }` of the task this code is running inside, or null. */
export const currentTask = () => taskStore.getStore() || null;

export class TaskCancelledError extends Error {
  constructor(message = "cancelled") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

/** True for our own cancellation error and for the AbortError Node raises
 * when an aborted signal kills a child process. */
export const isCancelled = (e) => e?.name === "TaskCancelledError" || e?.name === "AbortError";

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new TaskCancelledError();
}
