import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useTaskTransition, useTasksSelector, selectSourcesRefreshTask, selectActiveFitTasks, shallowEqualArray } from "../../hooks/useTasks.jsx";

export default function SourcesStatus({ onRefreshed }) {
  const { start, cancel } = useTasks();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.sourcesStatus().then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  // A refresh is a background task; its fit scoring is more tasks. Both
  // come from the shared context, so no polling of our own.
  const refreshTask = useTasksSelector(selectSourcesRefreshTask);
  const refreshing = isActive(refreshTask);
  const fitActive = useTasksSelector(selectActiveFitTasks, shallowEqualArray);
  const fitRunning = fitActive.filter((t) => t.status === "running").length;
  const fitQueued = fitActive.length - fitRunning;

  useTaskTransition((t) => t.kind === "sources_refresh", () => {
    load();
    onRefreshed?.();
  });

  const refresh = async () => {
    setError(null);
    try {
      await start(() => api.refreshSources());
    } catch (e) {
      setError(e.message);
    }
  };

  const enabledCount = status?.sources.filter((s) => s.enabled).length ?? 0;
  const failedSources = refreshTask?.status === "done"
    ? (refreshTask.result?.summaries || []).filter((s) => s.ok === false)
    : [];

  return (
    <div className="flex-row">
      <button onClick={refresh} disabled={refreshing} type="button">
        {refreshing ? (refreshTask.status === "queued" ? "Queued…" : "Refreshing…") : "Refresh sources"}
      </button>
      {refreshing && (
        <button type="button" className="btn-sm btn-muted" onClick={() => cancel(refreshTask.id)}>Cancel</button>
      )}
      <span className="muted small">
        {enabledCount} source{enabledCount === 1 ? "" : "s"} enabled
        {fitActive.length > 0 ? ` · scoring fit: ${fitRunning} running, ${fitQueued} queued` : ""}
        {status?.remoteOkAttribution ? ` · ${status.remoteOkAttribution}` : ""}
      </span>
      {error && <span className="small text-danger">{error}</span>}
      {refreshTask?.status === "failed" && (
        <span className="small text-danger">Refresh failed: {refreshTask.error}</span>
      )}
      {failedSources.length > 0 && (
        <span className="small text-danger" title={failedSources.map((s) => `${s.source}: ${s.error}`).join("\n")}>
          {failedSources.length} source{failedSources.length === 1 ? "" : "s"} failed
        </span>
      )}
    </div>
  );
}
