import { useState } from "react";
import { useApplications } from "../hooks/useApplications.js";
import StageCounts from "../components/applications/StageCounts.jsx";
import ApplicationsTable from "../components/applications/ApplicationsTable.jsx";
import PipelineBoard from "../components/applications/PipelineBoard.jsx";
import LogApplicationModal from "../components/applications/LogApplicationModal.jsx";
import AddExternalApplicationModal from "../components/applications/AddExternalApplicationModal.jsx";
import DeleteApplicationModal from "../components/applications/DeleteApplicationModal.jsx";
import JobDrawer from "../components/job/JobDrawer.jsx";
import ErrorBox from "../components/ErrorBox.jsx";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import Toolbar from "../components/ui/Toolbar.jsx";
import Tabs from "../components/ui/Tabs.jsx";
import Field from "../components/ui/Field.jsx";

const VIEW_MODES = ["table", "board"];

export default function ApplicationsView() {
  const { rows, counts, filters, setFilters, loading, fetching, error, reload } = useApplications({ sort: "applied" });
  const [viewMode, changeViewMode] = useLocalStorage("applications.viewMode", "table", { validate: (v) => VIEW_MODES.includes(v) });
  const [openJobId, setOpenJobId] = useState(null);
  const [logApplyJobId, setLogApplyJobId] = useState(null);
  const [addExternalOpen, setAddExternalOpen] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState(null);

  const activeStage = filters.stage?.[0] || null;
  const setActiveStage = (stage) => setFilters({ ...filters, stage: stage ? [stage] : undefined });

  const logApplyJob = rows.find((r) => r.jobId === logApplyJobId) || null;
  const deleteRow = rows.find((r) => r.jobId === deleteJobId) || null;

  return (
    <div className="container container-wide">
      <StageCounts counts={counts} activeStage={activeStage} onChangeStage={setActiveStage} />

      <Toolbar end={<button type="button" className="btn-muted" onClick={() => setAddExternalOpen(true)}>+ Log application</button>}>
        <input
          type="search"
          placeholder="Search company, title…"
          aria-label="Search applications"
          value={filters.q || ""}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <Tabs
          variant="segmented"
          ariaLabel="View"
          items={[{ key: "table", label: "Table" }, { key: "board", label: "Board" }]}
          value={viewMode}
          onChange={changeViewMode}
        />
        <Field inline label="Show archived">
          <input
            type="checkbox"
            checked={!!filters.includeArchived}
            onChange={(e) => setFilters({ ...filters, includeArchived: e.target.checked })}
          />
        </Field>
      </Toolbar>

      <ErrorBox>{error}</ErrorBox>
      {fetching && !loading && <div className="muted small" aria-live="polite">Updating…</div>}

      {loading ? <div className="muted small">Loading…</div> : (
        viewMode === "table" ? (
          <div className="card">
            <ApplicationsTable
              rows={rows}
              onOpen={setOpenJobId}
              onStageChanged={reload}
              onRequestApplied={setLogApplyJobId}
              onRequestDelete={setDeleteJobId}
            />
          </div>
        ) : (
          <PipelineBoard
            rows={rows}
            onOpen={setOpenJobId}
            onRequestApplied={setLogApplyJobId}
            onChanged={reload}
            onRequestDelete={setDeleteJobId}
          />
        )
      )}

      {openJobId && (
        <JobDrawer jobId={openJobId} initialTab="Application" onClose={() => setOpenJobId(null)} onChanged={reload} />
      )}
      {logApplyJobId && (
        <LogApplicationModal
          jobId={logApplyJobId}
          job={logApplyJob}
          onClose={() => setLogApplyJobId(null)}
          onLogged={() => { setLogApplyJobId(null); reload(); }}
        />
      )}
      {deleteRow && (
        <DeleteApplicationModal
          row={deleteRow}
          onClose={() => setDeleteJobId(null)}
          onDeleted={() => {
            setDeleteJobId(null);
            if (openJobId === deleteRow.jobId) setOpenJobId(null);
            reload();
          }}
        />
      )}
      {addExternalOpen && (
        <AddExternalApplicationModal
          onClose={() => setAddExternalOpen(false)}
          onLogged={() => { setAddExternalOpen(false); reload(); }}
        />
      )}
    </div>
  );
}
