import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useJobTask } from "../../hooks/useTasks.jsx";
import RunProgress from "../RunProgress.jsx";
import ErrorBox from "../ErrorBox.jsx";

// The Revise pane of the Documents tab: a conversation with the AI about
// the résumé on screen. The thread that led to this version scrolls above
// (each instruction, what the AI said it changed, and any question it left
// open, oldest first) and the composer stays pinned below. Sending queues
// a revise_resume task for the version on screen; the result lands as the
// next version and DocumentsPanel moves to it, so the thread grows by one.

const PLACEHOLDER = "Tell the AI what to change — e.g. “Shorten the summary to about 50 words”, “Add a bullet on the Northwind role about the Azure DevOps pipeline”, “Drop the Paystack bullet”. Numbered, multi-part instructions are fine.";
const PLACEHOLDER_ANSWER = "Answer the questions above, or give the next change.";

const EXAMPLES = [
  "Shorten the summary to about 50 words.",
  "Lead with the most recent role's impact; cut anything older than 2018 to one line.",
  "Don't reuse the posting's exact wording anywhere.",
  "Drop the tooling line and spread those skills into the bullets where they were actually used.",
];

function VersionChip({ version, current, onJump }) {
  const label = `v${version}`;
  if (current) return <span className="revise-chip current" title="The version on screen">{label} · on screen</span>;
  if (!onJump) return <span className="revise-chip">{label}</span>;
  return (
    <button type="button" className="revise-chip link" onClick={onJump} title={`Show v${version}`}>
      {label}
    </button>
  );
}

function Message({ entry, current, onJump }) {
  return (
    <div className={`revise-entry ${current ? "current" : ""}`}>
      <div className="revise-row you">
        <div className="revise-bubble you">
          <div className="revise-meta">
            <span>You</span>
            <VersionChip version={entry.version} current={current} onJump={onJump} />
          </div>
          <div className="revise-body">{entry.instruction}</div>
        </div>
      </div>
      <div className="revise-row ai">
        <div className="revise-avatar" aria-hidden="true">AI</div>
        <div className="revise-bubble ai">
          {entry.notes?.length ? (
            <ul className="revise-notes">{entry.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          ) : (
            <div className="revise-body muted">No notes were recorded for this change.</div>
          )}
          {entry.questions?.length > 0 && (
            <div className="revise-questions">
              <div className="revise-questions-title">
                {entry.questions.length === 1 ? "A question for you" : `${entry.questions.length} questions for you`}
              </div>
              <ol className="revise-notes">{entry.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Pending({ task, onCancel }) {
  return (
    <div className="revise-entry pending">
      <div className="revise-row you">
        <div className="revise-bubble you">
          <div className="revise-meta"><span>You</span><span className="revise-chip">next version</span></div>
          <div className="revise-body">{task.payload?.instruction}</div>
        </div>
      </div>
      <div className="revise-row ai">
        <div className="revise-avatar" aria-hidden="true">AI</div>
        <div className="revise-bubble ai working">
          <RunProgress run={task} compact />
          <button type="button" className="btn-sm btn-muted" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Empty({ onPick }) {
  return (
    <div className="revise-empty">
      <div className="revise-empty-title">Nothing has been revised yet</div>
      <p className="muted small">
        Tell the AI what to change about this résumé. Each message makes a new version with that change applied
        and everything else kept, and you can switch back to any earlier version from the rail.
      </p>
      <div className="revise-examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="revise-example" onClick={() => onPick(ex)}>{ex}</button>
        ))}
      </div>
    </div>
  );
}

export default function ReviseThread({ jobId, document, nextVersion, onSelectVersion }) {
  const { start, cancel, retry } = useTasks();
  const reviseTask = useJobTask(jobId, "revise_resume");
  const prepTask = useJobTask(jobId, "prepare_application");
  const reviseActive = isActive(reviseTask);
  const prepActive = isActive(prepTask);
  const busy = reviseActive || prepActive;

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [thread, setThread] = useState(null); // null until loaded
  const [dismissedTaskId, setDismissedTaskId] = useState(null);
  const scrollRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    let live = true;
    api.getDocumentThread(document.id)
      .then((t) => { if (live) setThread(Array.isArray(t) ? t : []); })
      .catch(() => { if (live) setThread([]); });
    return () => { live = false; };
  }, [document.id]);

  // A conversation reads bottom-up: the newest exchange sits just above
  // the composer, so land there whenever the thread grows or a run starts.
  const showFailed = reviseTask?.status === "failed" && reviseTask.id !== dismissedTaskId;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, reviseActive, showFailed]);

  const submit = async (e) => {
    e?.preventDefault();
    const instruction = text.trim();
    if (!instruction || busy || submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await start(() => api.reviseDocument(document.id, instruction));
      if (res?.existing) setNotice("A revision is already running for this job; this one was not queued.");
      else setText("");
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
  };

  const pick = (ex) => {
    setText(ex);
    textRef.current?.focus();
  };

  const openQuestions = document.content_json?.open_questions || [];
  // Grows with a pasted multi-part brief, within reason.
  const rows = Math.min(10, Math.max(2, text.split("\n").length + 1));
  const status = prepActive
    ? "Wait for Prepare application to finish; it is replacing this résumé."
    : reviseActive
      ? "Working on your last instruction…"
      : "Applies this change and keeps everything else. ⌘/Ctrl+Enter to send.";

  return (
    <div className="revise-ws">
      <div className="revise-scroll" ref={scrollRef}>
        <div className="revise-column">
          {thread === null && <div className="muted small">Loading…</div>}
          {thread?.length === 0 && !reviseActive && !showFailed && <Empty onPick={pick} />}
          {thread?.length > 0 && (
            <div className="revise-thread-head muted small">
              {thread.length === 1 ? "1 instruction" : `${thread.length} instructions`} led to v{document.version}
            </div>
          )}
          {thread?.map((entry) => (
            <Message
              key={entry.id}
              entry={entry}
              current={entry.id === document.id}
              onJump={onSelectVersion && entry.id !== document.id ? () => onSelectVersion(entry.version) : undefined}
            />
          ))}
          {reviseActive && <Pending task={reviseTask} onCancel={() => cancel(reviseTask.id)} />}
          {showFailed && (
            <div className="err-box spread revise-failed gap-3">
              <span>Revision failed: {reviseTask.error}</span>
              <span className="flex-row">
                <button type="button" className="btn-sm btn-muted" onClick={() => retry(reviseTask.id)}>Retry</button>
                <button type="button" className="btn-sm btn-muted" onClick={() => setDismissedTaskId(reviseTask.id)}>✕</button>
              </span>
            </div>
          )}
        </div>
      </div>

      <form className="revise-composer" onSubmit={submit}>
        <div className="revise-column">
          {openQuestions.length > 0 && !reviseActive && (
            <div className="revise-composer-hint">
              The AI left {openQuestions.length === 1 ? "a question" : `${openQuestions.length} questions`} open on this
              version. Answer in your next message, or just give the next change.
            </div>
          )}
          <textarea
            ref={textRef}
            rows={rows}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={openQuestions.length > 0 ? PLACEHOLDER_ANSWER : PLACEHOLDER}
            disabled={busy}
          />
          <div className="revise-composer-foot">
            <span className="muted small">{status}</span>
            <button type="submit" disabled={busy || submitting || !text.trim()}>
              {submitting ? "Queuing…" : nextVersion ? `Send · makes v${nextVersion}` : "Send"}
            </button>
          </div>
          <ErrorBox>{error}</ErrorBox>
          {notice && <div className="muted small mt-2">{notice}</div>}
        </div>
      </form>
    </div>
  );
}
