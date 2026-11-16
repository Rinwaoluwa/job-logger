// A one-line pub/sub so the tasks repository can say "something was
// queued" without importing the worker (the worker imports the handlers,
// which import the pipelines, which import the repository — a cycle).

const listeners = new Set();

export function onTaskQueued(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyTaskQueued() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error("[tasks] queue listener failed:", e);
    }
  }
}
