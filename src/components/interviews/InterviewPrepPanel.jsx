import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useTasksSelector } from "../../hooks/useTasks.jsx";
import RunProgress from "../RunProgress.jsx";
import ErrorBox from "../ErrorBox.jsx";
import {
  Section, StoryMapSection, PitchSection, QuestionCard, GapDefensesSection, ResumeClaimsSection,
  WatchOutsSection, TopStoriesSection, StudyListSection,
} from "../job/InterviewSections.jsx";
import RoundsBar from "./RoundsBar.jsx";
import RoundModal from "./RoundModal.jsx";
import DebriefModal from "./DebriefModal.jsx";
import CheatSheet from "./CheatSheet.jsx";
import MockInterviewView from "./mock/MockInterviewView.jsx";
import { roundTitle, prepStaleForRound } from "../../lib/interviews.js";

/** The round to open first: the next upcoming one, else General. */
export function defaultRoundId(rounds = []) {
  return rounds.find((r) => r.status === "upcoming")?.id ?? null;
}

/**
 * The prep workspace for one job: rounds, the prep for the selected round,
 * the cheat sheet, the mock interview and the debrief. Lives on the
 * Interviews page; the job drawer only links here.
 *
 * @param {object} props
 * @param {string} props.jobId
 * @param {object} props.job
 * @param {Array} props.rounds - interview_rounds rows for the job
 * @param {Array} props.interviewPreps - newest prep per round plus the general one
 * @param {object|null} props.sentResume - { documentId, version, explicit } the interviewer read, or null
 * @param {object|null} props.storyMap - built from the sent résumé's plan (server/ai/storyMap.js)
 * @param {Array} props.tasks - the job's recent tasks (for per-question rewrites in flight)
 * @param {Array} props.mockTurns - the job's mock-interview answers
 * @param {() => void} props.onUpdated - reload the job's detail
 * @param {number|null} [props.selectedRoundId] - controlled selection (null = General); omit to let the panel keep its own
 * @param {(id: number|null) => void} [props.onSelectRound]
 * @param {boolean} [props.initialMock] - open the mock interview on first render
 */
export default function InterviewPrepPanel({
  jobId, job, rounds = [], interviewPreps = [], sentResume = null, storyMap, tasks = [], mockTurns = [], onUpdated,
  selectedRoundId, onSelectRound, initialMock = false,
}) {
  const { start, cancel, retry } = useTasks();
  const controlled = selectedRoundId !== undefined;
  const [ownRoundId, setOwnRoundId] = useState(() => defaultRoundId(rounds));
  const roundId = controlled ? selectedRoundId : ownRoundId;
  const selectRound = (id) => { if (controlled) onSelectRound?.(id); else setOwnRoundId(id); };

  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(() => new Set());
  const [roundModal, setRoundModal] = useState(null); // null closed | false new | round editing
  const [debriefRound, setDebriefRound] = useState(null);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [mockOpen, setMockOpen] = useState(!!initialMock);

  // A round deleted elsewhere: fall back to General.
  useEffect(() => {
    if (roundId != null && !rounds.some((r) => r.id === roundId)) selectRound(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, roundId]);

  const round = rounds.find((r) => r.id === roundId) || null;
  const interviewPrep = interviewPreps.find((p) => (p.round_id || null) === roundId) || null;
  const data = interviewPrep?.result_json;
  useEffect(() => { setPending(new Set()); }, [data]);
  useEffect(() => { setExpanded(null); }, [roundId]);

  // Only this job and round's prep task: the panel does not re-render for
  // anything else finishing.
  const task = useTasksSelector(
    (ts) => ts.find((t) => t.jobId === jobId && t.kind === "interview_prep" && (t.payload?.roundId || null) === roundId) || null,
  );
  const active = isActive(task);

  const generate = async () => {
    setError(null);
    try {
      await start(() => api.runInterviewPrep(jobId, roundId));
    } catch (e) {
      setError(e.message);
    }
  };

  const rewrite = async (index, note) => {
    setError(null);
    setPending((prev) => new Set(prev).add(index));
    try {
      await start(() => api.regenerateInterviewQuestion(jobId, index, note, interviewPrep?.id));
    } catch (e) {
      setError(e.message);
      setPending((prev) => { const next = new Set(prev); next.delete(index); return next; });
    }
  };

  const rewriteTasks = tasks.filter((t) => t.kind === "interview_prep_question" && t.payload?.interviewPrepId === interviewPrep?.id);
  const rewritingIndexes = new Set([
    ...pending,
    ...rewriteTasks.filter(isActive).map((t) => t.payload?.index),
  ]);
  const failedRewriteFor = (index) => {
    const latest = rewriteTasks.find((t) => t.payload?.index === index);
    return latest && latest.status === "failed" ? latest : null;
  };

  const deleteRound = async (r) => {
    if (!window.confirm(`Delete the ${roundTitle(r)} round? Its prep stays in the history but is no longer shown.`)) return;
    setError(null);
    try {
      await api.deleteRound(r.id);
      if (roundId === r.id) selectRound(null);
      onUpdated?.();
    } catch (e) {
      setError(e.message);
    }
  };

  const failed = task?.status === "failed" && (
    <ErrorBox>
      Interview prep failed: {task.error}{" "}
      <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
    </ErrorBox>
  );

  // Written from a different résumé than the one now marked as sent.
  const staleResume = !!(data?.resume_document_id && sentResume?.documentId && data.resume_document_id !== sentResume.documentId);
  const staleRound = prepStaleForRound(interviewPrep, round);
  const oldFormat = data && !data.story_map;
  const fullFormat = data && data.format >= 3;
  const mapItems = data?.story_map || storyMap?.items || null;
  const roundNoun = round ? roundTitle(round).split(" · ")[0].toLowerCase() : "";
  const generateLabel = data ? "Regenerate" : round ? `Generate prep for this ${roundNoun}` : "Generate interview prep";

  return (
    <div>
      <RoundsBar
        rounds={rounds}
        selectedRoundId={roundId}
        preps={interviewPreps}
        onSelect={(id) => { selectRound(id); setError(null); }}
        onAdd={() => setRoundModal(false)}
        onEdit={(r) => setRoundModal(r)}
        onDebrief={(r) => setDebriefRound(r)}
        onDelete={deleteRound}
      />

      <div className="flex-row mb-3 gap-3 items-center">
        {active ? (
          <button type="button" className="btn-sm btn-muted" onClick={() => cancel(task.id)}>Cancel</button>
        ) : (
          <button type="button" className={data ? "btn-sm btn-muted" : ""} onClick={generate}>{generateLabel}</button>
        )}
        {data && (
          <>
            <button type="button" className="btn-sm" onClick={() => setMockOpen(true)}>Start mock interview</button>
            <button type="button" className="btn-sm btn-muted" onClick={() => setCheatOpen(true)}>Cheat sheet</button>
          </>
        )}
        {data?.resume_version && (
          <span className="muted small">
            Prepared from résumé v{data.resume_version}{data.resume_sent_explicit === false ? " (newest at the time, not marked as sent)" : ""}
          </span>
        )}
        {data && !data.resume_version && <span className="muted small">Prepared from the profile only (no résumé at the time)</span>}
        {data?.bank_entries > 0 && <span className="muted small">· {data.bank_entries} bank question{data.bank_entries === 1 ? "" : "s"} considered</span>}
        {mockTurns.length > 0 && <span className="muted small">· {mockTurns.length} mock answer{mockTurns.length === 1 ? "" : "s"} so far</span>}
      </div>
      {staleResume && (
        <div className="small inferred-note mb-2">
          The résumé marked as sent is now v{sentResume.version}; this prep was written from v{data.resume_version} — regenerate so the answers match it.
        </div>
      )}
      {staleRound && (
        <div className="small inferred-note mb-2">
          The round's details changed after this prep was written — regenerate so the focus and the room are reflected.
        </div>
      )}
      {active && <RunProgress run={task} />}
      {failed}
      <ErrorBox>{error}</ErrorBox>

      {!data && !active && (
        <p className="muted small">
          {round
            ? `No prep for this round yet. Generate builds questions for a ${roundNoun} with the focus you set, watch-outs, a study list, the pitch and the story map.`
            : "No interview prep generated yet. Add a round above to prepare for a specific interview, or Generate a general prep: a story map for every requirement, likely questions with draft answers, your opening pitch, gap defenses and the résumé claims to be ready for."}
        </p>
      )}
      {oldFormat && (
        <p className="muted small">
          This prep is in the old format (questions only). Regenerate to get the story map, pitch, gap defenses
          and résumé claims.
        </p>
      )}
      {data && !oldFormat && !fullFormat && (
        <p className="muted small">This prep predates watch-outs, the study list and top stories. Regenerate to get them.</p>
      )}

      {data && <WatchOutsSection items={data.watch_outs} />}
      {data && <TopStoriesSection items={data.top_stories} />}
      {data && <PitchSection pitch={data.pitch} />}

      {mapItems ? (
        <StoryMapSection items={mapItems} fromPlan={!data?.story_map} resumeVersion={storyMap?.resumeVersion} open={!data} />
      ) : !data && (
        <div className="card muted small">
          No résumé yet, so there is no story map to show — run Prepare application, or Generate to build one from the profile.
        </div>
      )}

      {data && (
        <>
          <Section title="Likely questions" hint={`${data.questions.length} questions — each links to the story behind it`}>
            {data.questions.map((q, i) => (
              <QuestionCard
                key={i}
                q={q}
                index={i}
                expanded={expanded === i}
                onToggle={() => setExpanded(expanded === i ? null : i)}
                rewriting={rewritingIndexes.has(i)}
                onRewrite={rewrite}
                failed={rewritingIndexes.has(i) ? null : failedRewriteFor(i)}
                onRetry={retry}
              />
            ))}
          </Section>

          <StudyListSection items={data.study_list} />
          <GapDefensesSection items={data.gap_defenses} />
          <ResumeClaimsSection items={data.resume_claims} />

          {data.questions_to_ask_them?.length > 0 && (
            <Section title="Questions to ask them" open={false}>
              <ul className="small tight-list">{data.questions_to_ask_them.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </Section>
          )}
          {data.prep_notes?.length > 0 && (
            <Section title="Prep notes" open={false}>
              <ul className="small tight-list">{data.prep_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </Section>
          )}
        </>
      )}

      {roundModal !== null && (
        <RoundModal
          jobId={jobId}
          round={roundModal || null}
          onClose={() => setRoundModal(null)}
          onSaved={(saved) => { setRoundModal(null); selectRound(saved.id); onUpdated?.(); }}
        />
      )}
      {debriefRound && (
        <DebriefModal
          round={debriefRound}
          prep={interviewPreps.find((p) => p.round_id === debriefRound.id) || null}
          onClose={() => setDebriefRound(null)}
          onSaved={() => { setDebriefRound(null); onUpdated?.(); }}
        />
      )}
      {cheatOpen && interviewPrep && (
        <CheatSheet prep={interviewPrep} job={job} round={round} onClose={() => setCheatOpen(false)} />
      )}
      {mockOpen && (
        <MockInterviewView
          jobId={jobId}
          job={job}
          prep={interviewPrep}
          turns={mockTurns}
          onClose={() => setMockOpen(false)}
          onChanged={onUpdated}
        />
      )}
    </div>
  );
}
