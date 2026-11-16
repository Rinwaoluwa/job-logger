import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useTask } from "../../hooks/useTasks.jsx";
import ErrorBox from "../ErrorBox.jsx";

export default function AddJobByLink({ onAdded }) {
  const { start } = useTasks();
  const [url, setUrl] = useState("");
  const [taskId, setTaskId] = useState(null);
  const task = useTask(taskId);
  const [error, setError] = useState(null);

  // Ingestion is a background task; watch the one we started.
  useEffect(() => {
    if (!task) return;
    if (task.status === "done") {
      setUrl("");
      setTaskId(null);
      onAdded?.(task.job);
    } else if (task.status === "failed" || task.status === "cancelled") {
      setError(task.error || "Cancelled.");
      setTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    try {
      const res = await start(() => api.addJobFromLink(url.trim()));
      setTaskId(res.taskId);
    } catch (e2) {
      setError(e2.message);
    }
  };

  const loading = isActive(task);
  return (
    <form onSubmit={submit} className="flex-row">
      <input
        type="url"
        placeholder="Paste a job posting URL…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ minWidth: 280 }}
        required
      />
      <button type="submit" disabled={loading}>{loading ? "Adding…" : "Add by link"}</button>
      {error && <ErrorBox>{error}</ErrorBox>}
    </form>
  );
}
