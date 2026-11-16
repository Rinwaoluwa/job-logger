import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useJobTask } from "../../hooks/useTasks.jsx";
import { useJobDetail } from "../../hooks/useJobDetail.js";
import { toInterviewsHash } from "../../lib/interviewsHash.js";
import RunProgress from "../RunProgress.jsx";
import Drawer from "../ui/Drawer.jsx";
import Tabs from "../ui/Tabs.jsx";
import JobOverview from "./JobOverview.jsx";
import FitReport from "./FitReport.jsx";
import ApplicationPanel from "./ApplicationPanel.jsx";
import DocumentsPanel from "./DocumentsPanel.jsx";
import PeoplePanel from "./PeoplePanel.jsx";
import LogApplicationModal from "../applications/LogApplicationModal.jsx";
import DeleteApplicationModal from "../applications/DeleteApplicationModal.jsx";

// Interviews have their own page; the Overview carries a card pointing
// there, so the drawer does not spend a tab on a pointer.
const TABS = ["Overview", "Fit", "Application", "Documents", "People"].map((t) => ({ key: t, label: t }));

export default function JobDrawer({ jobId, onClose, onChanged, initialTab }) {
  const [tab, setTab] = useState(initialTab || "Overview");
  const [docsRefreshKey, setDocsRefreshKey] = useState(0);
  const [logApplyOpen, setLogApplyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [prepError, setPrepError] = useState(null);
  const [dismissedTaskId, setDismissedTaskId] = useState(null);

  // The prepare task lives in the shared tasks context, not in this
  // drawer, so closing and reopening the drawer (or opening it from a
  // toast after the run started) shows the same progress.
  const { start, cancel, retry } = useTasks();
  const prepTask = useJobTask(jobId, "prepare_application");
  const prepActive = isActive(prepTask);
  // A revision in flight is about to add a résumé version; a fresh run
  // on top of it would interleave two new versions (the server refuses
  // it too).
  const reviseActive = isActive(useJobTask(jobId, "revise_resume"));

  // Any task for this job finishing (prepare, fit, interview prep, answer)
  // means the detail is stale: the hook reloads it, and the documents
  // list and the parent table follow.
  const { detail, reload } = useJobDetail(jobId, {
    onTaskFinished: () => {
      setDocsRefreshKey((k) => k + 1);
      onChanged?.();
    },
  });

  useEffect(() => {
    setTab(initialTab || "Overview");
    setPrepError(null);
  }, [jobId, initialTab]);

  const prepare = async () => {
    setPrepError(null);
    try {
      await start(() => api.prepareApplication(jobId, { coverLetter: true, fit: true }));
    } catch (e) {
      setPrepError(e.message);
    }
  };

  const onLogged = () => {
    setLogApplyOpen(false);
    setDocsRefreshKey((k) => k + 1);
    reload();
    onChanged?.();
  };

  if (!detail) return null;
  const { job, application, events, fit, people, outreach, signature, documents, jdChanged, rounds = [], interviewPreps = [], mockTurns = [] } = detail;
  const openInterviews = () => {
    onClose();
    location.hash = toInterviewsHash({ jobId: job.id });
  };
  const latestFit = fit?.[0] || null;
  const showFailed = prepTask?.status === "failed" && prepTask.id !== dismissedTaskId;
  const documentsTab = tab === "Documents";

  const subhead = (prepActive || showFailed || prepError) ? (
    <>
      {prepError && <div className="err-box">{prepError}</div>}
      {prepActive && (
        <>
          <RunProgress run={prepTask} />
          <button type="button" className="btn-sm btn-muted" onClick={() => cancel(prepTask.id)}>Cancel</button>
        </>
      )}
      {showFailed && (
        <div className="err-box spread gap-3">
          <span>Prepare application failed: {prepTask.error}</span>
          <span className="flex-row">
            <button type="button" className="btn-sm btn-muted" onClick={() => retry(prepTask.id)}>Retry</button>
            <button type="button" className="btn-sm btn-muted" onClick={() => setDismissedTaskId(prepTask.id)} aria-label="Dismiss">✕</button>
          </span>
        </div>
      )}
    </>
  ) : null;

  return (
    <>
      <Drawer
        onClose={onClose}
        width={documentsTab ? "wide" : "md"}
        flush={documentsTab}
        title={job.title}
        subtitle={job.company}
        actions={(
          <button
            type="button"
            onClick={prepare}
            disabled={prepActive || reviseActive}
            title={reviseActive ? "A résumé revision is running; wait for it to finish." : undefined}
          >
            {prepActive ? (prepTask.status === "queued" ? "Queued…" : "Preparing…") : "Prepare application"}
          </button>
        )}
        subhead={subhead}
        tabs={<Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Job sections" />}
      >
        {tab === "Overview" && (
          <JobOverview
            job={job}
            onUpdated={() => { reload(); onChanged?.(); }}
            interview={{ rounds, interviewPreps, mockTurns, onOpen: openInterviews }}
          />
        )}
        {tab === "Fit" && <FitReport jobId={job.id} fit={latestFit} onUpdated={reload} />}
        {tab === "Application" && (
          <ApplicationPanel
            jobId={job.id}
            application={application}
            events={events}
            onUpdated={reload}
            jdChanged={jdChanged}
            documents={documents}
            attachmentsRefreshKey={docsRefreshKey}
            onRequestApplied={() => setLogApplyOpen(true)}
            onRequestDelete={application ? () => setDeleteOpen(true) : undefined}
          />
        )}
        {documentsTab && (
          <DocumentsPanel
            jobId={job.id}
            refreshKey={docsRefreshKey}
            sentResumeDocumentId={application?.sent_resume_document_id ?? null}
            onSentChanged={reload}
          />
        )}
        {tab === "People" && (
          <PeoplePanel jobId={job.id} job={job} people={people} outreach={outreach} signature={signature} onUpdated={reload} />
        )}
      </Drawer>
      {deleteOpen && (
        <DeleteApplicationModal
          row={{
            jobId: job.id,
            company: job.company,
            title: job.title,
            source: job.source,
            resumeDocs: (documents || []).filter((d) => d.kind === "resume").length,
            coverLetterDocs: (documents || []).filter((d) => d.kind === "cover_letter").length,
          }}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => { setDeleteOpen(false); onChanged?.(); onClose(); }}
        />
      )}
      {logApplyOpen && (
        <LogApplicationModal jobId={job.id} job={job} onClose={() => setLogApplyOpen(false)} onLogged={onLogged} />
      )}
    </>
  );
}
