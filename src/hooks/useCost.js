import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useTaskTransition } from "./useTasks.jsx";

// The running AI spend. Cost only changes when a task finishes, so that
// is the trigger; the slow interval is a fallback for work done by the
// scheduler or a CLI script outside the task queue.
export function useCost() {
  const [cost, setCost] = useState(null);

  const reload = useCallback(() => {
    api.aiCost().then(setCost).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 300_000);
    return () => clearInterval(id);
  }, [reload]);

  useTaskTransition(() => true, reload);

  return { cost, reload };
}
