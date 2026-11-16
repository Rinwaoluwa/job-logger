import { useMemo } from "react";
import { isActive } from "../../../shared/tasks.js";
import { useAllTasks, useTasks } from "../../hooks/useTasks.jsx";
import Drawer from "../ui/Drawer.jsx";
import TaskRow, { TaskGroupRow } from "./TaskRow.jsx";

/** Folds the fit tasks a refresh queued into one row per refresh; every
 * other task is its own row. Order follows the list from the server:
 * running, then queued, then most recently finished. */
function toRows(tasks) {
  const rows = [];
  const groups = new Map();
  for (const t of tasks) {
    if (t.kind === "fit" && t.groupId) {
      let g = groups.get(t.groupId);
      if (!g) {
        g = { key: `group:${t.groupId}`, groupId: t.groupId, tasks: [] };
        groups.set(t.groupId, g);
        rows.push(g);
      }
      g.tasks.push(t);
    } else {
      rows.push({ key: t.id, task: t });
    }
  }
  return rows;
}

const rowActive = (row) => (row.task ? isActive(row.task) : row.tasks.some(isActive));

export default function TasksPanel({ onClose }) {
  const tasks = useAllTasks();
  const { clearFailed } = useTasks();

  const rows = useMemo(() => toRows(tasks), [tasks]);
  const active = rows.filter(rowActive);
  const recent = rows.filter((r) => !rowActive(r));
  // Counted over tasks, not rows, so failures folded into a group row count.
  const failed = tasks.filter((t) => t.status === "failed").length;

  const render = (row) => (row.task
    ? <TaskRow key={row.key} task={row.task} />
    : <TaskGroupRow key={row.key} groupId={row.groupId} tasks={row.tasks} />);

  return (
    <Drawer
      width="narrow"
      onClose={onClose}
      title="Activity"
      subtitle="Generation runs in the background; close this and keep working."
    >
      <div className="section-title">In progress</div>
      {active.length === 0
        ? <div className="muted small mb-3">Nothing running.</div>
        : <div className="task-list mb-3">{active.map(render)}</div>}
      <div className="spread mb-2">
        <div className="section-title mb-0">Recent</div>
        {failed > 0 && (
          <button type="button" className="btn-sm btn-muted" onClick={() => clearFailed()}>
            Clear failed ({failed})
          </button>
        )}
      </div>
      {recent.length === 0
        ? <div className="muted small">Nothing finished in the last day.</div>
        : <div className="task-list">{recent.map(render)}</div>}
    </Drawer>
  );
}
