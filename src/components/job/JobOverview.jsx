import { useState } from "react";
import { api } from "../../api/client.js";
import { dateOnly } from "../../lib/format.js";
import { ROUND_LABELS, whenLabel } from "../../lib/interviews.js";
import ErrorBox from "../ErrorBox.jsx";
import JobDetailsForm from "./JobDetailsForm.jsx";

/**
 * @param {object} props
 * @param {object} props.job
 * @param {(job?: object) => void} [props.onUpdated]
 * @param {{rounds: Array, interviewPreps: Array, mockTurns: Array, onOpen: () => void}} [props.interview]
 *   what the Interviews page holds for this job, summarised in a card
 */
export default function JobOverview({ job, onUpdated, interview }) {
  const [hydrating, setHydrating] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const hydrate = async () => {
    setHydrating(true);
    setError(null);
    try {
      const updated = await api.hydrateJob(job.id);
      onUpdated?.(updated.job || updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setHydrating(false);
    }
  };

  // Manual fallback for postings the fetcher cannot read (login walls,
  // bot checks, JS-only pages): paste the text in and it replaces the
  // stored description the same way "Fetch full description" does.
  const savePasted = async (e) => {
    e.preventDefault();
    const text = pasteText.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patchJob(job.id, { descriptionText: text });
      setPasting(false);
      setPasteText("");
      onUpdated?.(updated.job || updated);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const cancelPaste = () => {
    setPasting(false);
    setPasteText("");
    setError(null);
  };

  const jackAndJillPage = isJackAndJillPage(job.url);
  const openUrl = job.apply_url || job.url;
  // A routine pick taken from Jack's email links to a Jack & Jill page that
  // needs a sign-in; once the Jack & Jill import matches it, "Open posting"
  // is the employer's page and the Jack & Jill page stays a second link.
  const employerLinkPending = jackAndJillPage && isJackAndJillPage(openUrl);

  return (
    <div>
      {editing && (
        <JobDetailsForm
          job={job}
          onSaved={(updated) => { setEditing(false); onUpdated?.(updated); }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className="small muted mb-2">
        {job.location_raw || job.remote_scope || "—"} · {job.work_mode} · posted {dateOnly(job.posted_at) || "unknown"} · source: {job.source}
        {job.also_seen_on?.length > 0 && ` (also seen on ${job.also_seen_on.map((s) => s.source).join(", ")})`}
      </div>
      {job.salary_text && <div className="small mb-2">{job.salary_text}</div>}
      <div className="flex-row mb-3">
        <a href={openUrl} target="_blank" rel="noreferrer">Open posting ↗</a>
        {jackAndJillPage && !employerLinkPending && (
          <a className="small" href={job.url} target="_blank" rel="noreferrer">Jack &amp; Jill page ↗</a>
        )}
        {job.description_truncated && !employerLinkPending && (
          <button type="button" className="btn-sm btn-muted" onClick={hydrate} disabled={hydrating || pasting}>
            {hydrating ? "Fetching…" : "Fetch full description"}
          </button>
        )}
        {!pasting && (
          <button type="button" className="btn-sm btn-muted" onClick={() => setPasting(true)} disabled={hydrating}>
            {job.description_text ? "Replace description" : "Paste description"}
          </button>
        )}
        {!editing && (
          <button type="button" className="btn-sm btn-muted" onClick={() => setEditing(true)}>Edit details</button>
        )}
      </div>
      {employerLinkPending && (
        <div className="small muted mb-3">
          This link is a Jack &amp; Jill page that needs a sign-in. The employer's posting link arrives when you import the
          Jack &amp; Jill export on the Jack &amp; Jill tab.
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
      {interview && <InterviewCard {...interview} />}
      {job.raw?.routine && <RoutineNotes info={job.raw.routine} />}
      {job.raw?.jackandjill && <JackAndJillNotes info={job.raw.jackandjill} />}
      {pasting ? (
        <form onSubmit={savePasted}>
          <textarea
            rows={14}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste the full job description here…"
            autoFocus
          />
          <div className="small muted mt-1 mb-2">
            {job.description_text
              ? "Replaces the stored description. Existing fit scores and tailored documents were built from the old text; re-run them to use this one."
              : "Fit scoring, tailoring and answers will use this text."}
          </div>
          <div className="flex-row">
            <button type="submit" disabled={saving || !pasteText.trim()}>{saving ? "Saving…" : "Save description"}</button>
            <button type="button" className="btn-muted" onClick={cancelPaste} disabled={saving}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="job-description">
          {job.description_text || "(no description)"}
        </div>
      )}
    </div>
  );
}

function isJackAndJillPage(link) {
  return /(^|\.)jackandjill\.ai\//i.test(link || "");
}

// Where this job stands on the Interviews page: rounds, the next one,
// preps and mock answers, with the way there. The detail itself lives on
// that page; this is the pointer.
function InterviewCard({ rounds = [], interviewPreps = [], mockTurns = [], onOpen }) {
  const nextRound = rounds
    .filter((r) => r.status === "upcoming")
    .sort((a, b) => String(a.scheduled_at || "~").localeCompare(String(b.scheduled_at || "~")))[0] || null;
  const parts = [];
  if (rounds.length) parts.push(`${rounds.length} round${rounds.length === 1 ? "" : "s"}`);
  if (nextRound) parts.push(`next: ${ROUND_LABELS[nextRound.kind] || nextRound.kind}${nextRound.scheduled_at ? ` on ${whenLabel(nextRound.scheduled_at)}` : ""}`);
  if (interviewPreps.length) parts.push(`${interviewPreps.length} prep${interviewPreps.length === 1 ? "" : "s"}`);
  if (mockTurns.length) parts.push(`${mockTurns.length} mock answer${mockTurns.length === 1 ? "" : "s"}`);
  return (
    <div className="card card-sunken card-tight mb-3 spread gap-3">
      <div className="small">
        <span className="strong">Interviews</span>
        <span className="muted"> · {parts.length ? parts.join(" · ") : "no rounds or prep yet"}</span>
      </div>
      <button type="button" className="btn-sm btn-muted" onClick={onOpen}>Open on the Interviews page</button>
    </div>
  );
}

// What the daily routine wrote in the Job Search Log for this posting:
// its fit call and one-line note, and the day it logged it.
function RoutineNotes({ info }) {
  if (!info.fit && !info.note) return null;
  const label = info.fit ? (info.fit === "stretch" ? "Stretch" : "Strong fit") : null;
  return (
    <div className="card card-sunken card-tight mb-3">
      <div className="small strong mb-1">
        Job Search Log
        {label && <span className="muted normal"> · {label}</span>}
        {info.logged_on && <span className="muted normal"> · logged {info.logged_on}</span>}
      </div>
      {info.note && <div className="note-text">{info.note}</div>}
    </div>
  );
}

// What Jack & Jill added on top of the posting: Jack's one-line take, its
// summary of the role, and the salary estimate's reasoning. Shown above
// the description so it reads before the full text.
function JackAndJillNotes({ info }) {
  if (!info.jacks_take && !info.description_summary && info.match_score == null) return null;
  return (
    <div className="card card-sunken card-tight mb-3">
      <div className="small strong mb-1">
        Jack &amp; Jill
        {info.match_score != null && <span className="muted normal"> · match {info.match_score}</span>}
      </div>
      {info.jacks_take && <div className={`note-text ${info.description_summary ? "mb-2" : ""}`}>{info.jacks_take}</div>}
      {info.description_summary && (
        <div className="small muted note-text pre-wrap">{info.description_summary}</div>
      )}
      {info.salary_estimated && info.salary_estimated_reasoning && (
        <div className="small muted mt-2" title={info.salary_estimated_reasoning}>
          Salary is Jack &amp; Jill's estimate, not from the posting.
        </div>
      )}
    </div>
  );
}
