import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useTaskTransition, useTasksSelector, selectSourcesRefreshTask, selectActiveFitTasks, shallowEqualArray } from "../../hooks/useTasks.jsx";

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * The Jack & Jill tab's import card: where to drop a scrape, which files
 * are there, what the last import did with each, and a button that runs
 * only this source. The import is the ordinary `sources_refresh` task
 * restricted to the jackandjill adapter, so progress, cancel and the
 * fit scoring it queues all show in the activity pill as usual.
 */
export default function JackAndJillImport({ onImported }) {
  const { start, cancel } = useTasks();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.sourcesStatus().then(setStatus).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const refreshTask = useTasksSelector(selectSourcesRefreshTask);
  const refreshing = isActive(refreshTask);
  const fitActive = useTasksSelector(selectActiveFitTasks, shallowEqualArray).length;

  useTaskTransition((t) => t.kind === "sources_refresh", () => {
    load();
    onImported?.();
  });

  const runImport = async () => {
    setError(null);
    try {
      await start(() => api.refreshSources(["jackandjill"]));
    } catch (e) {
      setError(e.message);
    }
  };

  const info = status?.jackandjill || null;
  const lastRun = status?.lastRuns?.find((r) => r.source === "jackandjill") || null;
  const files = info?.files || [];
  const results = info?.lastImport?.files || [];
  const resultFor = (name) => results.find((r) => r.name === name) || null;
  const maxFit = status?.fitMaxPerRefresh;
  const maxAge = info?.maxAgeDays || 0;
  const removed = info?.lastImport?.removed || 0;

  return (
    <div>
      <div className="flex-row mb-2">
        <button type="button" onClick={runImport} disabled={refreshing || info?.enabled === false}>
          {refreshing ? (refreshTask.status === "queued" ? "Queued…" : "Importing…") : "Import from file"}
        </button>
        {refreshing && (
          <button type="button" className="btn-sm btn-muted" onClick={() => cancel(refreshTask.id)}>Cancel</button>
        )}
        <span className="muted small">
          {files.length} file{files.length === 1 ? "" : "s"} in folder
          {lastRun?.finished_at ? ` · last import ${when(lastRun.finished_at)}: ${lastRun.inserted} new, ${lastRun.updated} merged` : " · never imported"}
          {removed > 0 ? ` · removed ${removed} old` : ""}
          {fitActive > 0 ? ` · scoring fit for ${fitActive}` : ""}
        </span>
        {info?.enabled === false && <span className="small text-danger">Disabled in config/sources.json</span>}
        {error && <span className="small text-danger">{error}</span>}
        {lastRun?.ok === 0 && lastRun.error && <span className="small text-danger">Last import failed: {lastRun.error}</span>}
      </div>
      <div className="small muted mb-2">
        Save each Jack &amp; Jill scrape as a <code>.json</code> file (an array of jobs) in{" "}
        <code className="select-all">{info?.path || "data/jackandjill"}</code>. Only company, title, location,
        description, link, posted date, salary and Jack's take are read; Jack &amp; Jill's own stage is ignored, and a
        job you delete here is not re-imported.
        {maxAge ? ` Jobs posted more than ${maxAge} days ago are skipped, and ones already here are removed unless you saved or applied to them.` : ""}
        {maxFit ? ` Fit scoring is queued for up to ${maxFit} new jobs per import; score the rest from a job's Fit tab.` : ""}
      </div>
      {files.length > 0 && (
        <ul className="small m-0 pl-5">
          {files.map((f) => {
            const r = resultFor(f.name);
            return (
              <li key={f.name}>
                <span className="mono">{f.name}</span>
                <span className="muted"> · {(f.size / 1024).toFixed(0)} KB · saved {when(f.mtime)}</span>
                {r?.error && <span className="text-danger"> · could not read: {r.error}</span>}
                {r && !r.error && (
                  <span className="muted">
                    {" "}· {r.records} records: {r.emitted} new, {r.enriched} merged, {r.skipped} already known
                    {r.stale ? `, ${r.stale} too old` : ""}
                    {r.invalid ? `, ${r.invalid} unreadable` : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
