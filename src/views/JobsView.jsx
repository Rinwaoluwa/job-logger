import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Pagination, { pageSlice, PAGE_SIZES } from "../components/Pagination.jsx";
import { useJobs } from "../hooks/useJobs.js";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { useTasksSelector } from "../hooks/useTasks.jsx";
import { useIsActiveView } from "../hooks/useIsActiveView.jsx";
import JobFilters from "../components/jobs/JobFilters.jsx";
import JobsTable from "../components/jobs/JobsTable.jsx";
import AddJobByLink from "../components/jobs/AddJobByLink.jsx";
import RoutineLogImport from "../components/jobs/RoutineLogImport.jsx";
import JobDrawer from "../components/job/JobDrawer.jsx";
import LogApplicationModal from "../components/applications/LogApplicationModal.jsx";
import ErrorBox from "../components/ErrorBox.jsx";

const TABLE_KINDS = new Set(["fit", "add_job_link", "sources_refresh"]);

// One string for the state of every task the table reflects (fit badges,
// ingestion, refreshes). A poll that changes none of them changes nothing
// in this view.
const selectTableSignature = (tasks) =>
  tasks.filter((t) => TABLE_KINDS.has(t.kind)).map((t) => `${t.id}:${t.status}`).join("|");

// The Job Search Log doc is the one job source, so every job lists here
// together; the card on top reads the log or adds a job by link.
export default function JobsView({ openRequest }) {
  const { jobs, filters, setFilters, loading, fetching, error, reload } = useJobs({ sort: "posted" });
  const signature = useTasksSelector(selectTableSignature);
  const active = useIsActiveView();
  const [openJobId, setOpenJobId] = useState(null);
  const [openTab, setOpenTab] = useState(null);
  const [logApplyJobId, setLogApplyJobId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage("jobs.pageSize", 25, { validate: (n) => PAGE_SIZES.includes(n) });

  // A new filter starts from the first page; a reload after a stage change
  // or a finished task keeps the page the user is on.
  useEffect(() => { setPage(1); }, [filters]);

  useEffect(() => {
    if (openRequest?.id) {
      setOpenJobId(openRequest.id);
      setOpenTab(openRequest.tab || null);
    }
  }, [openRequest]);

  // The table shows each job's fit badge (queued / scoring… / score) and
  // gains rows from ingestion and refreshes, so reload it whenever one of
  // those tasks changes state — debounced, because a refresh finishes
  // forty fit scores in bursts. While the tab is hidden the reload waits
  // until it is shown again, once, however many tasks finished meanwhile.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const activeRef = useRef(active);
  activeRef.current = active;
  const first = useRef(true);
  const pendingReload = useRef(false);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!activeRef.current) { pendingReload.current = true; return undefined; }
    const id = setTimeout(() => reloadRef.current(), 800);
    return () => clearTimeout(id);
  }, [signature]);
  useEffect(() => {
    if (active && pendingReload.current) {
      pendingReload.current = false;
      reloadRef.current();
    }
  }, [active]);

  const closeDrawer = useCallback(() => setOpenJobId(null), []);
  const closeLogApply = useCallback(() => setLogApplyJobId(null), []);
  const onLogged = useCallback(() => { setLogApplyJobId(null); reload(); }, [reload]);

  const logApplyJob = jobs.find((j) => j.id === logApplyJobId) || null;
  const pageJobs = useMemo(() => pageSlice(jobs, page, pageSize), [jobs, page, pageSize]);
  const pager = (
    <Pagination
      total={jobs.length}
      page={page}
      pageSize={pageSize}
      onPage={setPage}
      onPageSize={setPageSize}
      noun="jobs"
    />
  );

  return (
    <div className="container container-wide">
      <div className="card mb-4">
        <RoutineLogImport onRead={reload} />
        <div className="mt-3">
          <AddJobByLink onAdded={reload} />
        </div>
      </div>
      <JobFilters filters={filters} onChange={setFilters} />
      <ErrorBox>{error}</ErrorBox>
      <div className="card">
        {loading ? <div className="muted small">Loading…</div> : (
          <>
            {pager}
            {fetching && <div className="muted small" aria-live="polite">Updating…</div>}
            <JobsTable
              jobs={pageJobs}
              onOpen={setOpenJobId}
              onStageChanged={reload}
              onRequestApplied={setLogApplyJobId}
            />
            {jobs.length > pageSize && pager}
          </>
        )}
      </div>
      {openJobId && (
        <JobDrawer jobId={openJobId} initialTab={openTab || undefined} onClose={closeDrawer} onChanged={reload} />
      )}
      {logApplyJobId && (
        <LogApplicationModal
          jobId={logApplyJobId}
          job={logApplyJob}
          onClose={closeLogApply}
          onLogged={onLogged}
        />
      )}
    </div>
  );
}
