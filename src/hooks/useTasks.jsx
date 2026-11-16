// The one place the browser learns about background tasks. A provider at
// the top of the app polls GET /api/tasks (every 2s while anything is
// active, every 15s otherwise, never while the browser tab is hidden) and
// keeps the list in a small store outside React. Components subscribe to
// the slice they need — one job's prepare task, the count for the pill,
// the answer cards — and re-render only when that slice changes, not on
// every poll. Tasks that did not change between polls keep their object
// identity, so a slice can be compared element by element.
//
// It also spots each task's active -> finished transition, which is what
// drives the toasts and the browser notifications.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../api/client.js";
import { ACTIVE_STATUSES, KIND_LABELS, isActive } from "../../shared/tasks.js";

// ---------------------------------------------------------------------------
// Store

let tasksState = [];
const subscribers = new Set();
const signatures = new WeakMap();

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
function getSnapshot() {
  return tasksState;
}
function emit() {
  for (const fn of subscribers) fn();
}

/** A task's content as a string, cached per object (tasks are small). */
function signatureOf(task) {
  let s = signatures.get(task);
  if (s === undefined) {
    s = JSON.stringify(task);
    signatures.set(task, s);
  }
  return s;
}

/**
 * The next list with every unchanged task replaced by its previous object,
 * so identity means "same content". Returns `cur` itself when nothing
 * changed at all, which is what lets a poll with no news skip every
 * subscriber.
 */
export function reconcileTasks(cur, next) {
  const byId = new Map(cur.map((t) => [t.id, t]));
  let same = cur.length === next.length;
  const out = next.map((n, i) => {
    const c = byId.get(n.id);
    const keep = c && signatureOf(c) === signatureOf(n) ? c : n;
    if (same && keep !== cur[i]) same = false;
    return keep;
  });
  return same ? cur : out;
}

function replaceTasks(next) {
  const reconciled = reconcileTasks(tasksState, next);
  if (reconciled === tasksState) return;
  tasksState = reconciled;
  emit();
}

/** One task fresh from a start response, listed before the next poll. */
function upsertTask(task) {
  const exists = tasksState.some((t) => t.id === task.id);
  replaceTasks(exists ? tasksState.map((t) => (t.id === task.id ? task : t)) : [task, ...tasksState]);
}

/** Only for tests: feeds a list in the way a poll would. */
export function _replaceTasksForTests(tasks = []) {
  replaceTasks(tasks);
}

// ---------------------------------------------------------------------------
// Equality helpers for selectors

export function shallowEqualArray(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function shallowEqualObject(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Hooks over the store

/** The whole list. Reference-stable while no task changes. */
export function useAllTasks() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * A slice of the tasks list. The component re-renders only when the
 * selected value changes by `isEqual` (default: identity). Pass a selector
 * from useCallback when it closes over props; an inline one is recomputed
 * each render (cheap) and still only triggers a render when its result
 * differs.
 */
export function useTasksSelector(selector, isEqual = Object.is) {
  const cache = useRef(null);
  const read = () => {
    const input = tasksState;
    const c = cache.current;
    if (c && c.input === input && c.selector === selector) return c.output;
    const output = selector(input);
    if (c && isEqual(c.output, output)) {
      cache.current = { input, selector, output: c.output };
      return c.output;
    }
    cache.current = { input, selector, output };
    return output;
  };
  return useSyncExternalStore(subscribe, read, read);
}

const selectAnyActive = (tasks) => tasks.some(isActive);

// Shared selectors (module-level so their identity is stable).
export const selectSourcesRefreshTask = (tasks) => tasks.find((t) => t.kind === "sources_refresh") || null;
export const selectActiveFitTasks = (tasks) => tasks.filter((t) => t.kind === "fit" && isActive(t));
export const selectAnswerTasks = (tasks) => tasks.filter((t) => t.kind === "answer");

export function useTask(taskId) {
  const selector = useCallback((tasks) => (taskId ? tasks.find((t) => t.id === taskId) || null : null), [taskId]);
  return useTasksSelector(selector);
}

/** The task that matters for a job (and kind): the active one if there is
 * one, otherwise the most recently finished. Null when there is neither. */
export function useJobTask(jobId, kind) {
  const selector = useCallback(
    (tasks) => tasks.find((t) => t.jobId === jobId && (!kind || t.kind === kind)) || null,
    [jobId, kind],
  );
  return useTasksSelector(selector);
}

/** Calls onFinished(task) when a task matching filterFn goes from active
 * to finished. Seeded on mount, so a component opened mid-run still hears
 * about the completion, and one opened afterwards does not. Subscribes to
 * the store directly: it never re-renders the component. */
export function useTaskTransition(filterFn, onFinished) {
  const filterRef = useRef(filterFn);
  filterRef.current = filterFn;
  const cbRef = useRef(onFinished);
  cbRef.current = onFinished;
  useEffect(() => {
    let prev = new Map();
    const check = () => {
      const next = new Map();
      for (const t of tasksState) {
        if (!filterRef.current(t)) continue;
        next.set(t.id, t.status);
        const was = prev.get(t.id);
        if (was && ACTIVE_STATUSES.includes(was) && !isActive(t)) cbRef.current?.(t);
      }
      prev = next;
    };
    check();
    return subscribe(check);
  }, []);
}

// ---------------------------------------------------------------------------
// Provider: polling, toasts, actions

const ActionsContext = createContext(null);
const ToastsContext = createContext(null);
let toastSeq = 0;

/** The thing a task is about, for a row or a toast. */
export function taskSubject(t) {
  // A brief (Résumés tab) has a title but usually no company.
  if (t.job) return [t.job.company, t.job.title].filter(Boolean).join(" — ");
  if (t.kind === "add_job_link") return t.payload?.url || "";
  if (t.kind === "sources_refresh") return t.payload?.only?.length ? t.payload.only.join(", ") : "all enabled sources";
  if (t.kind === "answer") return (t.payload?.question || "").slice(0, 80);
  if (t.kind === "interview_prep_question" && Number.isInteger(t.payload?.index)) return `question ${t.payload.index + 1}`;
  if (t.kind === "mock_critique") return "mock answer";
  return "";
}

// Bulk fit scoring from a refresh would fire forty toasts; the activity
// panel's group row is its only surface. A scheduled refresh and a task
// the user cancelled themselves are not news either.
const worthAToast = (t) => !(t.kind === "fit" && t.groupId) && !t.payload?.scheduled && t.status !== "cancelled";

export function TasksProvider({ children, onOpenJob }) {
  const [toasts, setToasts] = useState([]);
  // taskId -> status as of the previous poll; null until the first poll
  // has seeded it, so a page reload never replays old completions.
  const prevStatus = useRef(null);
  const anyActive = useTasksSelector(selectAnyActive);

  const dismissToast = useCallback((id) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((toast) => {
    const id = ++toastSeq;
    setToasts((cur) => [...cur, { id, ...toast }]);
    setTimeout(() => dismissToast(id), 7000);
  }, [dismissToast]);

  const notifyFinished = useCallback((t) => {
    const ok = t.status === "done";
    const label = KIND_LABELS[t.kind] || t.kind;
    const subject = taskSubject(t);
    const text = ok
      ? `${label} finished${subject ? `: ${subject}` : ""}`
      : `${label} failed${subject ? `: ${subject}` : ""}${t.error ? ` — ${t.error}` : ""}`;
    pushToast({ kind: ok ? "success" : "error", text, jobId: t.jobId, job: t.job });
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(ok ? `${label} finished` : `${label} failed`, { body: subject || t.error || "", tag: t.id });
        n.onclick = () => {
          window.focus();
          if (t.jobId) onOpenJob?.(t.jobId, t.job);
          n.close();
        };
      } catch {
        /* notifications unavailable in this context */
      }
    }
  }, [pushToast, onOpenJob]);

  const refresh = useCallback(async () => {
    const { tasks: next } = await api.listTasks();
    const prev = prevStatus.current;
    if (prev) {
      for (const t of next) {
        const was = prev.get(t.id);
        if (was && ACTIVE_STATUSES.includes(was) && !isActive(t) && worthAToast(t)) notifyFinished(t);
      }
    }
    prevStatus.current = new Map(next.map((t) => [t.id, t.status]));
    replaceTasks(next);
  }, [notifyFinished]);

  useEffect(() => {
    // A hidden tab skips its ticks; the visibilitychange below catches up.
    const tick = () => { if (!document.hidden) refresh().catch(() => {}); };
    tick();
    const id = setInterval(tick, anyActive ? 2000 : 15000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [anyActive, refresh]);

  /** Runs a starter that resolves to { taskId, task, existing } and lists
   * the task straight away, so the pill flips before the next poll. */
  const start = useCallback(async (starter) => {
    if ("Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch { /* ignored */ }
    }
    const res = await starter();
    const task = res?.task;
    if (task) {
      if (!prevStatus.current) prevStatus.current = new Map();
      if (!prevStatus.current.has(task.id)) prevStatus.current.set(task.id, task.status);
      upsertTask(task);
    }
    return res;
  }, []);

  const cancel = useCallback((id) => api.cancelTask(id).then(refresh), [refresh]);
  const retry = useCallback((id) => api.retryTask(id).then((res) => refresh().then(() => res)), [refresh]);
  const cancelGroup = useCallback((groupId) => api.cancelTaskGroup(groupId).then(refresh), [refresh]);
  const remove = useCallback((id) => api.deleteTask(id).then(refresh), [refresh]);
  const clearFailed = useCallback(() => api.deleteFailedTasks().then(refresh), [refresh]);

  const actions = useMemo(
    () => ({ start, cancel, retry, cancelGroup, remove, clearFailed, refresh, openJob: onOpenJob }),
    [start, cancel, retry, cancelGroup, remove, clearFailed, refresh, onOpenJob],
  );
  const toastsValue = useMemo(() => ({ toasts, dismissToast }), [toasts, dismissToast]);

  return (
    <ActionsContext.Provider value={actions}>
      <ToastsContext.Provider value={toastsValue}>{children}</ToastsContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The actions: start, cancel, retry, cancelGroup, remove, clearFailed,
 * refresh, openJob. Never changes, so it never causes a render. For the
 * list itself use useAllTasks, useTasksSelector, useTask or useJobTask. */
export function useTasks() {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useTasks must be used inside TasksProvider");
  return value;
}

export function useToasts() {
  const value = useContext(ToastsContext);
  if (!value) throw new Error("useToasts must be used inside TasksProvider");
  return value;
}
