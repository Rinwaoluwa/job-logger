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
 * The Jobs page's source card: a link to the Claude Doc the daily routine
 * writes, what the last read found there, and a button that runs only this
 * source. The read is the ordinary `sources_refresh` task restricted to the
 * routine adapter, so progress, cancel and the fit scoring it queues all
 * show in the activity pill as usual.
 */
export default function RoutineLogImport({ onRead }) {
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
    onRead?.();
  });

  const runRead = async () => {
    setError(null);
    try {
      await start(() => api.refreshSources(["routine"]));
    } catch (e) {
      setError(e.message);
    }
  };

  const info = status?.routine || null;
  const lastRun = status?.lastRuns?.find((r) => r.source === "routine") || null;
  const read = info?.lastRead || null;
  const maxFit = status?.fitMaxPerRefresh;

  return (
    <div>
      <div className="flex-row mb-2">
        <button type="button" onClick={runRead} disabled={refreshing || info?.enabled === false}>
          {refreshing ? (refreshTask.status === "queued" ? "Queued…" : "Reading…") : "Read log"}
        </button>
        {refreshing && (
          <button type="button" className="btn-sm btn-muted" onClick={() => cancel(refreshTask.id)}>Cancel</button>
        )}
        {info?.docUrl && (
          <a className="small" href={info.docUrl} target="_blank" rel="noreferrer">Open the Job Search Log doc ↗</a>
        )}
        <span className="muted small">
          {lastRun?.finished_at
            ? `last read ${when(lastRun.finished_at)}: ${lastRun.inserted} new, ${lastRun.updated} merged`
            : "never read"}
          {read ? ` · ${read.lines} line${read.lines === 1 ? "" : "s"} from ${read.sections} day${read.sections === 1 ? "" : "s"}${read.since ? ` since ${read.since}` : ""}` : ""}
          {read?.annotated > 0 ? ` · ${read.annotated} Jack & Jill job${read.annotated === 1 ? "" : "s"} annotated` : ""}
          {read?.deleted > 0 ? ` · ${read.deleted} left out (deleted earlier)` : ""}
          {read?.unparsed > 0 ? ` · ${read.unparsed} line${read.unparsed === 1 ? "" : "s"} not understood` : ""}
          {typeof read?.costUsd === "number" ? ` · $${read.costUsd.toFixed(3)}` : ""}
          {fitActive > 0 ? ` · scoring fit for ${fitActive}` : ""}
        </span>
        {info?.enabled === false && <span className="small text-danger">Disabled in config/sources.json</span>}
        {error && <span className="small text-danger">{error}</span>}
        {lastRun?.ok === 0 && lastRun.error && <span className="small text-danger">Last read failed: {lastRun.error}</span>}
      </div>
      <div className="small muted">
        The daily routine on claude.ai logs its picks to the Job Search Log doc; reading it asks the <code>claude</code> CLI to
        open the doc through the Claude Docs connector (about half a cent a read) and brings in every line since the last day
        already here. Picks that came from Jack &amp; Jill link to a sign-in-only Jack &amp; Jill page; paste the employer's
        posting into the job if you need the full description.
        {maxFit ? ` Fit scoring is queued for up to ${maxFit} new jobs per read; score the rest from a job's Fit tab.` : ""}
      </div>
    </div>
  );
}
