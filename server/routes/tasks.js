import { Router } from "express";
import { config } from "../config.js";
import { getTask, listTasks, counts, deleteTask, deleteFailedTasks } from "../db/repo/tasks.js";
import { isActive } from "../../shared/tasks.js";
import { cancel, cancelGroup } from "../tasks/worker.js";
import { startTask } from "../tasks/start.js";

export const router = Router();

router.get("/tasks", (req, res) => {
  const recentLimit = Math.min(200, Number(req.query.limit) || config.tasks.recentLimit);
  const sinceHours = Number(req.query.hours) || config.tasks.recentHours;
  res.json({ tasks: listTasks({ recentLimit, sinceHours }), counts: counts() });
});

router.get("/tasks/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "task not found" });
  res.json(task);
});

router.post("/tasks/:id/cancel", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "task not found" });
  if (!isActive(task)) return res.status(409).json({ error: `task is already ${task.status}` });
  res.json({ task: cancel(task.id) });
});

router.post("/tasks/:id/retry", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "task not found" });
  if (isActive(task)) return res.status(409).json({ error: "task is still running" });
  try {
    res.json(startTask({
      kind: task.kind, jobId: task.jobId, payload: task.payload, priority: task.priority, groupId: task.groupId,
      dedupeKey: task.kind === "answer" ? null : undefined,
    }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Registered ahead of /tasks/:id so "failed" is not read as an id.
router.delete("/tasks/failed", (req, res) => {
  res.json({ removed: deleteFailedTasks() });
});

// Removing a row that is already gone (pruned, or removed from another
// tab) is not an error.
router.delete("/tasks/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (isActive(task)) return res.status(409).json({ error: "task is still running; cancel it first" });
  if (task) deleteTask(task.id);
  res.json({ ok: true });
});

router.post("/tasks/group/:groupId/cancel", (req, res) => {
  res.json({ cancelled: cancelGroup(req.params.groupId) });
});
