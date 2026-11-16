import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { reconcileTasks, useJobTask, useTasksSelector, shallowEqualArray, _replaceTasksForTests } from "../useTasks.jsx";

const task = (id, status, extra = {}) => ({ id, kind: "fit", jobId: `job-${id}`, status, stages: [], ...extra });

describe("reconcileTasks", () => {
  it("returns the current array itself when nothing changed", () => {
    const cur = [task("a", "running"), task("b", "done")];
    const next = [task("a", "running"), task("b", "done")];
    expect(reconcileTasks(cur, next)).toBe(cur);
  });

  it("keeps the old object for an unchanged task and takes the new one for a changed task", () => {
    const cur = [task("a", "running"), task("b", "done")];
    const next = [task("a", "done"), task("b", "done")];
    const out = reconcileTasks(cur, next);
    expect(out).not.toBe(cur);
    expect(out[0]).toBe(next[0]);
    expect(out[1]).toBe(cur[1]);
  });

  it("sees a stage change inside an otherwise identical task", () => {
    const cur = [task("a", "running", { stages: [{ name: "plan", status: "running" }] })];
    const next = [task("a", "running", { stages: [{ name: "plan", status: "done" }] })];
    expect(reconcileTasks(cur, next)[0]).toBe(next[0]);
  });

  it("treats a new or removed task as a change", () => {
    const cur = [task("a", "running")];
    expect(reconcileTasks(cur, [task("a", "running"), task("b", "queued")])).toHaveLength(2);
    expect(reconcileTasks(cur, [])).toEqual([]);
  });
});

describe("useTasksSelector", () => {
  beforeEach(() => act(() => _replaceTasksForTests([])));

  it("re-renders only when its own slice changes", () => {
    act(() => _replaceTasksForTests([task("a", "running"), task("b", "queued")]));
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useJobTask("job-a", "fit");
    });
    expect(result.current.id).toBe("a");
    const before = renders;

    // Another job's task changes: nothing for this hook.
    act(() => _replaceTasksForTests([task("a", "running"), task("b", "running")]));
    expect(renders).toBe(before);

    // This job's task changes: one render, with the new object.
    act(() => _replaceTasksForTests([task("a", "done"), task("b", "running")]));
    expect(renders).toBe(before + 1);
    expect(result.current.status).toBe("done");
  });

  it("keeps a filtered array stable under shallow equality", () => {
    act(() => _replaceTasksForTests([task("a", "running", { kind: "answer" }), task("b", "queued")]));
    const selectAnswers = (tasks) => tasks.filter((t) => t.kind === "answer");
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useTasksSelector(selectAnswers, shallowEqualArray);
    });
    const first = result.current;
    const before = renders;
    act(() => _replaceTasksForTests([task("a", "running", { kind: "answer" }), task("b", "done")]));
    expect(renders).toBe(before);
    expect(result.current).toBe(first);
  });
});
