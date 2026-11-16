import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import ErrorBox from "../components/ErrorBox.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import InterviewPrepPanel, { defaultRoundId } from "../components/interviews/InterviewPrepPanel.jsx";
import SentResumeCard from "../components/interviews/SentResumeCard.jsx";
import { useJobDetail } from "../hooks/useJobDetail.js";
import { useTasks } from "../hooks/useTasks.jsx";
import { useIsActiveView } from "../hooks/useIsActiveView.jsx";
import { readStored, writeStored } from "../hooks/useLocalStorage.js";
import { parseInterviewsHash, toInterviewsHash, isInterviewsHash } from "../lib/interviewsHash.js";
import { ROUND_LABELS, whenLabel } from "../lib/interviews.js";
import { STAGE_LABELS } from "../lib/stages.js";

// Every interview across jobs, upcoming first, and the prep workspace for
// the one picked. Where you are is in the URL hash (src/lib/interviewsHash.js)
// so a round can be linked to and a reload comes back to it.

const SEL_KEY = "interviews.sel";
const PREP_STAGES = new Set(["applied", "interviewing", "offer"]);

// The remembered selection, if it is still an object.
const readSel = () => {
  const v = readStored(SEL_KEY, null);
  return v && typeof v === "object" ? v : null;
};

function nextRoundLine(entry) {
  const upcoming = entry.rounds.filter((r) => r.status === "upcoming").sort((a, b) => String(a.scheduled_at || "~").localeCompare(String(b.scheduled_at || "~")));
  if (upcoming[0]) {
    const r = upcoming[0];
    return `${ROUND_LABELS[r.kind] || r.kind}${r.scheduled_at ? ` · ${whenLabel(r.scheduled_at)}` : ""}`;
  }
  if (entry.rounds.length) return `${entry.rounds.length} round${entry.rounds.length === 1 ? "" : "s"} · all debriefed`;
  return entry.preps.length ? "general prep" : "practised";
}

export default function InterviewsView() {
  const { openJob } = useTasks();
  const active = useIsActiveView();
  const [list, setList] = useState(null);
  const [apps, setApps] = useState([]);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(() => parseInterviewsHash(location.hash) || readSel() || {});

  const reloadList = useCallback(() => api.listInterviews().then((r) => setList(r.jobs)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    reloadList();
    api.listApplications({}).then((r) => setApps(r.rows || [])).catch(() => {});
  }, [reloadList]);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseInterviewsHash(location.hash);
      if (parsed) setSel(parsed);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Remembered without the mock flag: a reload should not reopen the mock.
  useEffect(() => {
    const { mock: _mock, ...rest } = sel;
    writeStored(SEL_KEY, rest);
  }, [sel]);

  // Coming back to the tab: put the hash back (App clears it when leaving).
  useEffect(() => {
    if (active && !isInterviewsHash(location.hash)) history.replaceState(null, "", toInterviewsHash(sel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const select = useCallback((next) => {
    const h = toInterviewsHash(next);
    if (location.hash === h) setSel(next);
    else location.hash = h;
  }, []);

  const { detail, error: detailError, reload } = useJobDetail(sel.jobId || null, { onTaskFinished: reloadList });
  const onUpdated = useCallback(() => { reload(); reloadList(); }, [reload, reloadList]);

  const roundId = useMemo(() => {
    if (!detail) return null;
    if (sel.roundId === "general") return null;
    if (Number.isInteger(sel.roundId) && detail.rounds?.some((r) => r.id === sel.roundId)) return sel.roundId;
    return defaultRoundId(detail.rounds);
  }, [detail, sel.roundId]);

  const candidates = useMemo(() => {
    const listed = new Set((list || []).map((e) => e.job.id));
    return apps.filter((a) => PREP_STAGES.has(a.stage) && !listed.has(a.jobId));
  }, [apps, list]);

  const upcoming = useMemo(() => (list || [])
    .flatMap((e) => e.rounds.filter((r) => r.status === "upcoming").map((r) => ({ ...r, job: e.job })))
    .sort((a, b) => String(a.scheduled_at || "~").localeCompare(String(b.scheduled_at || "~"))), [list]);

  const job = detail?.job;

  return (
    <div className="container container-wide">
      <ErrorBox>{error}</ErrorBox>
      <div className="rail-layout">
        <div className="rail">
          <div className="rail-heading">Prepare</div>
          <select
            value=""
            onChange={(e) => { if (e.target.value) select({ jobId: e.target.value }); }}
            className="mb-2"
            title="Applications you have not started preparing for"
          >
            <option value="">Start prep for a job…</option>
            {candidates.map((a) => <option key={a.jobId} value={a.jobId}>{a.company} — {a.title}</option>)}
          </select>
          {list === null && <div className="muted small p-3">Loading…</div>}
          {list?.length === 0 && (
            <EmptyState compact title="Nothing yet" body="Pick an application above to add a round or generate a prep." />
          )}
          {(list || []).map((entry) => (
            <button
              type="button"
              key={entry.job.id}
              className={`rail-item ${sel.jobId === entry.job.id ? "active" : ""}`}
              onClick={() => select({ jobId: entry.job.id })}
            >
              <div className="bold">{entry.job.company}</div>
              <div className="rail-meta">{entry.job.title}</div>
              <div className="rail-meta">
                {nextRoundLine(entry)}
                {entry.rounds.length > 0 && entry.preps.length > 0 ? ` · ${entry.preps.length} prep${entry.preps.length === 1 ? "" : "s"}` : ""}
              </div>
            </button>
          ))}
        </div>

        <div className="rail-main">
          {!sel.jobId && (
            <>
              <div className="card">
                <div className="section-title">Interviews</div>
                <div className="muted small">
                  Pick a job on the left, or an application above, to prepare: rounds, the prep for each, a cheat sheet, a mock interview and the debrief.
                </div>
              </div>
              {upcoming.length > 0 && (
                <div className="card">
                  <div className="section-title">Coming up</div>
                  {upcoming.map((r) => (
                    <div key={r.id} className="map-row">
                      <div className="map-head">
                        <span className="badge fit-good">{ROUND_LABELS[r.kind] || r.kind}</span>
                        {r.scheduled_at && <span className="small">{whenLabel(r.scheduled_at)}</span>}
                        <button type="button" className="chip-neutral chip-btn" onClick={() => select({ jobId: r.job.id, roundId: r.id })}>
                          {r.job.company} — {r.job.title}
                        </button>
                      </div>
                      {r.interviewers?.length > 0 && <div className="small muted mt-1">With {r.interviewers.map((p) => p.name).join(", ")}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {sel.jobId && !detail && <div className="card muted small">{detailError || "Loading…"}</div>}

          {sel.jobId && detail && job && (
            <>
              <div className="card">
                <div className="spread gap-3 wrap items-center">
                  <div>
                    <div className="strong text-lg">{job.company} — {job.title}</div>
                    <div className="muted small">
                      {detail.application?.stage ? (STAGE_LABELS?.[detail.application.stage] || detail.application.stage) : "not in the pipeline"}
                      {job.location_raw ? ` · ${job.location_raw}` : ""}
                    </div>
                  </div>
                  <button type="button" className="btn-sm btn-muted" onClick={() => openJob(job.id, job)}>Open job</button>
                </div>
              </div>

              <SentResumeCard jobId={job.id} sentResume={detail.sentResume} documents={detail.documents} onChanged={onUpdated} />

              <InterviewPrepPanel
                key={job.id}
                jobId={job.id}
                job={job}
                rounds={detail.rounds || []}
                interviewPreps={detail.interviewPreps || []}
                sentResume={detail.sentResume}
                storyMap={detail.storyMap}
                tasks={detail.tasks || []}
                mockTurns={detail.mockTurns || []}
                onUpdated={onUpdated}
                selectedRoundId={roundId}
                onSelectRound={(id) => select({ jobId: job.id, roundId: id ?? "general" })}
                initialMock={!!sel.mock}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
