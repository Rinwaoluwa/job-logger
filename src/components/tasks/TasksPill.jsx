import { useState } from "react";
import { useTasksSelector, shallowEqualObject } from "../../hooks/useTasks.jsx";
import TasksPanel from "./TasksPanel.jsx";

// Four numbers, compared field by field: the pill re-renders when a count
// changes, not on every poll.
function selectCounts(tasks) {
  let running = 0;
  let queued = 0;
  let failed = 0;
  for (const t of tasks) {
    if (t.status === "running") running++;
    else if (t.status === "queued") queued++;
    else if (t.status === "failed") failed++;
  }
  return { total: tasks.length, running, queued, failed };
}

/** Top-bar summary of background work — "2 running · 1 queued" — that
 * opens the activity panel. Hidden until there has been something to show. */
export default function TasksPill() {
  const { total, running, queued, failed } = useTasksSelector(selectCounts, shallowEqualObject);
  const [open, setOpen] = useState(false);
  // Stays mounted while the panel is open, so removing the last row does
  // not yank the panel shut.
  if (total === 0 && !open) return null;

  const active = running + queued > 0;
  const label = active
    ? [`${running} running`, queued ? `${queued} queued` : null].filter(Boolean).join(" · ")
    : failed ? `${failed} failed` : "activity";

  return (
    <>
      <button
        type="button"
        className={`tasks-pill ${active ? "active" : ""} ${!active && failed ? "failed" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Background tasks"
      >
        <span className="dot" />
        {label}
      </button>
      {open && <TasksPanel onClose={() => setOpen(false)} />}
    </>
  );
}
