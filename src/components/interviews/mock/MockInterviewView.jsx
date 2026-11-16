import { useEffect, useMemo, useRef, useState } from "react";
import CopyButton from "../../ui/CopyButton.jsx";
import { api } from "../../../api/client.js";
import { isActive } from "../../../../shared/tasks.js";
import { useTasks, useTasksSelector } from "../../../hooks/useTasks.jsx";
import { useSpeechRecognition } from "../../../hooks/useSpeechRecognition.js";
import RunProgress from "../../RunProgress.jsx";
import ErrorBox from "../../ErrorBox.jsx";
import StoryChip from "../../job/StoryChip.jsx";
import { QUESTION_KINDS, QUESTION_KIND_LABELS, ROUND_LABELS, wordCount } from "../../../lib/interviews.js";

// A mock interview over a prep's questions: one at a time, answered out
// loud (browser speech recognition) or typed, then judged by a small
// background task. Each answer is a mock_turns row; the critique lands
// on it and the drawer's reload brings it here through `turns`.

const newSessionId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}`);

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The clock on the card ticks in here, not in the view: re-rendering the
// whole mock every second was the single biggest render cost in the app.
function ElapsedTimer({ startedAt, running }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <span className={`${elapsed > 120 ? "inferred-note" : ""} ml-auto`}>
      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
    </span>
  );
}

const SCORE_CLASS = { 5: "fit-strong", 4: "fit-good", 3: "fit-stretch", 2: "fit-weak", 1: "fit-weak" };

export default function MockInterviewView({ jobId, job, prep, turns = [], onClose, onChanged }) {
  const { start, retry } = useTasks();
  const questions = useMemo(() => prep?.result_json?.questions || [], [prep]);
  const roundKind = prep?.result_json?.round_kind || null;

  const [sessionId] = useState(newSessionId);
  const [kindFilter, setKindFilter] = useState("all");
  const [unpractisedOnly, setUnpractisedOnly] = useState(false);
  const [order, setOrder] = useState(null); // indexes into questions, or null = prep order
  const [pos, setPos] = useState(0);
  const [showPoints, setShowPoints] = useState(false);
  const [answer, setAnswer] = useState("");
  const [turnId, setTurnId] = useState(null); // the turn being judged / shown
  const [followUp, setFollowUp] = useState(null); // { question, parentTurnId }
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [error, setError] = useState(null);
  const [banked, setBanked] = useState(null);
  const [summary, setSummary] = useState(false);
  const textRef = useRef(null);
  // Whether the mic was used on the current card: decides via and whether the measured seconds are sent.
  const usedVoice = useRef(false);

  const speech = useSpeechRecognition({
    onFinal: (text) => { if (text) setAnswer((a) => (a ? `${a} ${text}` : text)); },
  });

  const sessionTurns = useMemo(() => turns.filter((t) => t.session_id === sessionId), [turns, sessionId]);
  const practisedQuestions = useMemo(() => new Set(turns.filter((t) => !t.parent_turn_id).map((t) => t.question)), [turns]);

  const deck = useMemo(() => {
    const base = order || questions.map((_, i) => i);
    return base.filter((i) => {
      const q = questions[i];
      if (!q) return false;
      if (kindFilter !== "all" && q.kind !== kindFilter) return false;
      if (unpractisedOnly && practisedQuestions.has(q.question)) return false;
      return true;
    });
  }, [order, questions, kindFilter, unpractisedOnly, practisedQuestions]);

  const safePos = deck.length ? Math.min(pos, deck.length - 1) : 0;
  const currentIndex = deck[safePos];
  const card = followUp ? null : questions[currentIndex] || null;
  const questionText = followUp ? followUp.question : card?.question || "";
  const questionKind = followUp ? (questions[followUp.cardIndex]?.kind || null) : card?.kind || null;

  const currentTurn = turnId ? turns.find((t) => t.id === turnId) || null : null;
  const critique = currentTurn?.critique || null;
  const critiqueTask = useTasksSelector((ts) => (turnId ? ts.find((t) => t.kind === "mock_critique" && Number(t.payload?.turnId) === turnId) || null : null));
  const judging = !!turnId && !critique && (!critiqueTask || isActive(critiqueTask));
  const judgeFailed = !!turnId && !critique && critiqueTask && critiqueTask.status === "failed";


  const resetCard = () => {
    speech.stop();
    setAnswer("");
    setTurnId(null);
    setShowPoints(false);
    setBanked(null);
    setError(null);
    setStartedAt(Date.now());
  };
  const go = (delta) => {
    if (!deck.length) return;
    setFollowUp(null);
    setPos((((safePos + delta) % deck.length) + deck.length) % deck.length);
    resetCard();
  };
  const shuffle = () => {
    setOrder(shuffled(questions.map((_, i) => i)));
    setPos(0);
    setFollowUp(null);
    resetCard();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (judging && !window.confirm("A critique is still running; it will finish in the background. Leave the mock?")) return;
        speech.stop();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judging, onClose, speech]);

  const submit = async () => {
    const text = answer.trim();
    if (!text) return;
    speech.stop();
    setError(null);
    try {
      const via = speech.supported && usedVoice.current ? "voice" : "typed";
      const res = await start(() => api.createMockTurn(jobId, {
        sessionId,
        interviewPrepId: prep?.id ?? null,
        parentTurnId: followUp?.parentTurnId ?? null,
        questionIndex: followUp ? null : currentIndex,
        question: questionText,
        kind: questionKind,
        answer: text,
        via,
        // Time on the card, measured when the answer is sent rather than kept
        // in state: a ticking clock re-rendered the whole view every second.
        seconds: via === "voice" ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : null,
      }));
      setTurnId(res.turn.id);
      usedVoice.current = false;
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  };
  const toggleMic = () => {
    if (!speech.listening) usedVoice.current = true;
    speech.toggle();
  };

  const bank = async (which) => {
    if (!turnId) return;
    setError(null);
    try {
      await api.bankMockTurn(turnId, which);
      setBanked(which);
    } catch (e) {
      setError(e.message);
    }
  };
  const answerFollowUp = () => {
    if (!critique?.follow_up) return;
    setFollowUp({ question: critique.follow_up, parentTurnId: turnId, cardIndex: followUp?.cardIndex ?? currentIndex });
    resetCard();
  };
  const tryAgain = () => {
    const text = answer;
    resetCard();
    setAnswer(text);
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const avg = sessionTurns.filter((t) => t.critique).reduce((s, t, _, arr) => s + t.critique.score / arr.length, 0);

  if (!questions.length) {
    return (
      <div className="mock-overlay">
        <div className="mock-inner">
          <div className="card">
            <div className="spread"><b>Mock interview</b><button type="button" className="btn-sm btn-muted" onClick={onClose}>✕ Close</button></div>
            <p className="muted small">This prep has no questions to practise. Generate the prep first.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mock-overlay">
      <div className="mock-inner">
        <div className="card">
          <div className="spread gap-3 wrap">
            <div>
              <div className="strong">Mock interview — {job.company}{roundKind ? ` · ${ROUND_LABELS[roundKind] || roundKind}` : ""}</div>
              <div className="muted small">
                Answer as you would in the room. <span className="kbd">esc</span> leaves. Voice: {speech.supported ? "on (Chrome, Edge or Safari)" : "not available in this browser — type your answers"}.
              </div>
            </div>
            <div className="flex-row">
              <button type="button" className="btn-sm btn-muted" onClick={() => setSummary(!summary)}>{summary ? "Back to questions" : `Session (${sessionTurns.length})`}</button>
              <button type="button" className="btn-sm btn-muted" onClick={() => { speech.stop(); onClose(); }}>✕ Close</button>
            </div>
          </div>
          {!summary && (
            <div className="flex-row small mt-3 gap-3">
              <label className="flex-row gap-2">
                <span className="muted">Kind</span>
                <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setPos(0); setFollowUp(null); resetCard(); }} className="w-auto">
                  <option value="all">all</option>
                  {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}
                </select>
              </label>
              <label className="flex-row gap-1">
                <input type="checkbox" checked={unpractisedOnly} onChange={(e) => { setUnpractisedOnly(e.target.checked); setPos(0); setFollowUp(null); resetCard(); }} />
                not yet practised
              </label>
              <button type="button" className="btn-sm btn-muted" onClick={shuffle}>Shuffle</button>
              <span className="muted">{deck.length} question{deck.length === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>

        {summary ? (
          <div className="card">
            <div className="section-title">This session</div>
            {sessionTurns.length === 0 && <div className="muted small">No answers yet.</div>}
            {sessionTurns.length > 0 && (
              <div className="small mb-2">
                {sessionTurns.filter((t) => t.critique).length} judged · average score {avg ? avg.toFixed(1) : "—"} / 5
              </div>
            )}
            {[...sessionTurns].reverse().map((t) => (
              <div key={t.id} className="map-row">
                <div className="map-head">
                  {t.critique ? <span className={`badge ${SCORE_CLASS[t.critique.score] || "fit-none"}`}>{t.critique.score}/5</span> : <span className="badge fit-none">judging…</span>}
                  {t.kind && <span className="badge fit-none">{QUESTION_KIND_LABELS[t.kind] || t.kind}</span>}
                  {t.parent_turn_id && <span className="badge fit-none">follow-up</span>}
                  <span className="small bold">{t.question}</span>
                </div>
                {t.critique?.missed?.length > 0 && <div className="small muted mt-1">Missed: {t.critique.missed.join(" · ")}</div>}
              </div>
            ))}
          </div>
        ) : !deck.length ? (
          <div className="card muted small">Nothing matches — change the kind, or untick "not yet practised".</div>
        ) : (
          <div className="card flash-card">
            <div className="flex-row small muted items-center">
              <span>{followUp ? "Follow-up to" : ""} {safePos + 1} / {deck.length}</span>
              {questionKind && <span className="badge fit-none">{QUESTION_KIND_LABELS[questionKind] || questionKind}</span>}
              {card?.from_bank && <span className="badge fit-good">asked before</span>}
              {!followUp && practisedQuestions.has(questionText) && <span className="badge fit-none">practised</span>}
              <ElapsedTimer startedAt={startedAt} running={!turnId} />
            </div>
            <div className="flash-prompt">{questionText}</div>
            {card?.story_ids?.length > 0 && (
              <div className="flex-row small">
                <span className="muted">Draw on:</span>
                {card.story_ids.map((id) => <StoryChip key={id} id={id} />)}
              </div>
            )}
            {card?.talking_points?.length > 0 && (
              <div>
                <button type="button" className="btn-sm btn-muted" onClick={() => setShowPoints(!showPoints)}>{showPoints ? "Hide talking points" : "Peek at talking points"}</button>
                {showPoints && <ul className="small tight-list mt-2">{card.talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul>}
              </div>
            )}

            {!turnId && (
              <div>
                <textarea
                  ref={textRef}
                  rows={6}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={speech.supported ? "Press the mic and talk, or type. You can fix the transcript before you submit." : "Type your answer."}
                  autoFocus
                />
                {speech.interim && <div className="small muted italic">{speech.interim}…</div>}
                <ErrorBox>{speech.error}</ErrorBox>
                <div className="flash-actions">
                  {speech.supported && (
                    <button type="button" className={`mic-btn ${speech.listening ? "listening" : ""}`} onClick={toggleMic}>
                      {speech.listening ? "● Listening — stop" : "🎤 Speak"}
                    </button>
                  )}
                  <button type="button" onClick={submit} disabled={!answer.trim()}>Submit answer</button>
                  <span className="muted small">{wordCount(answer)} words</span>
                  <span className="flex-row ml-auto">
                    <button type="button" className="btn-muted" onClick={() => go(-1)}>← Prev</button>
                    <button type="button" className="btn-muted" onClick={() => go(1)}>Skip →</button>
                  </span>
                </div>
              </div>
            )}

            {turnId && (
              <div className="flash-answer">
                <div className="spoken small pre-wrap">
                  <span className="field-label">You said{currentTurn?.via === "voice" ? " (voice)" : ""}</span>
                  {currentTurn?.answer || answer}
                </div>
                {judging && (
                  <div className="mt-3">
                    {critiqueTask ? <RunProgress run={critiqueTask} /> : <div className="muted small">Queuing the critique…</div>}
                  </div>
                )}
                {judgeFailed && (
                  <div className="err-box small spread mt-3 gap-2">
                    <span>Critique failed: {critiqueTask.error}</span>
                    <button type="button" className="btn-sm btn-muted" onClick={() => retry(critiqueTask.id)}>Retry</button>
                  </div>
                )}
                {critique && (
                  <div className="critique mt-3">
                    <div className="flex-row items-center">
                      <span className={`badge ${SCORE_CLASS[critique.score] || "fit-none"} text-lg`}>{critique.score} / 5</span>
                      <span className="small muted">
                        {critique.timing.words} words · ~{critique.timing.est_seconds}s · {critique.timing.verdict === "good" ? "good length" : critique.timing.verdict === "short" ? "too short" : "too long"}
                      </span>
                    </div>
                    {critique.landed.length > 0 && (
                      <div className="small mt-2">
                        <b>Landed</b>
                        <ul className="tight-list">{critique.landed.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      </div>
                    )}
                    {critique.missed.length > 0 && (
                      <div className="small mt-2">
                        <b>Missed</b>
                        <ul className="tight-list">{critique.missed.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      </div>
                    )}
                    {critique.risky.length > 0 && (
                      <div className="small inferred-note mt-2">
                        <b>Risky — not backed by the profile</b>
                        <ul className="tight-list">{critique.risky.map((r, i) => <li key={i}>“{r.said}” — {r.why}</li>)}</ul>
                      </div>
                    )}
                    <div className="small mt-3">
                      <div className="spread"><b>Tightened, in your words</b>
                        <CopyButton text={critique.tightened} />
                      </div>
                      <div className="spoken pre-wrap mt-1">{critique.tightened}</div>
                    </div>
                    {critique.follow_up && (
                      <div className="small mt-3">
                        <b>They would probe:</b> {critique.follow_up}
                      </div>
                    )}
                    <div className="flash-actions mt-3">
                      {critique.follow_up && <button type="button" onClick={answerFollowUp}>Answer the follow-up</button>}
                      <button type="button" className="btn-muted" onClick={tryAgain}>Try again</button>
                      {banked ? (
                        <span className="chip-ok small">Saved to the question bank ({banked === "tightened" ? "tightened" : "your words"})</span>
                      ) : (
                        <>
                          <button type="button" className="btn-muted" onClick={() => bank("mine")}>Keep my answer</button>
                          <button type="button" className="btn-muted" onClick={() => bank("tightened")}>Keep the tightened one</button>
                        </>
                      )}
                      <button type="button" className="btn-muted ml-auto" onClick={() => go(1)}>Next →</button>
                    </div>
                  </div>
                )}
                {!critique && !judging && !judgeFailed && (
                  <div className="flash-actions mt-3">
                    <button type="button" className="btn-muted" onClick={() => go(1)}>Next →</button>
                  </div>
                )}
              </div>
            )}
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}
      </div>
    </div>
  );
}
