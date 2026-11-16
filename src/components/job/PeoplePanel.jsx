import { useEffect, useState } from "react";
import CopyButton from "../ui/CopyButton.jsx";
import { api } from "../../api/client.js";
import { isActive } from "../../../shared/tasks.js";
import { useTasks, useJobTask } from "../../hooks/useTasks.jsx";
import RunProgress from "../RunProgress.jsx";
import ErrorBox from "../ErrorBox.jsx";
import { dateOnly } from "../../lib/format.js";

const GROUPS = [
  ["hiring_manager", "Likely hiring manager"],
  ["recruiter", "Recruiters & talent"],
  ["peer", "Peers on the team"],
  ["other", "Others"],
];

const CONFIDENCE_CLASS = { high: "fit-strong", medium: "fit-good", low: "fit-stretch" };
const FOUND_VIA_LABELS = { linkedin: "via LinkedIn", company_site: "via company site", web_search: "via web search" };
const LINKEDIN_STATUS_LABELS = { connected: "LinkedIn used", signed_out: "LinkedIn not used", unavailable: "LinkedIn unavailable", disabled: "LinkedIn off" };
const HINTS_PLACEHOLDER = "Hints for the search (optional): team or product name, people you already know of, the company's website or LinkedIn page, the office or business unit…";
const STATUS_LABELS = { sent: "Sent", replied: "Replied", no_response: "No response" };
const CHANNEL_LABELS = { email: "Email", linkedin: "LinkedIn" };
const UNDO_WINDOW_MS = 8000;

const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

function linkLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

// Gmail's compose endpoint reads these as path-style percent-encoding: a
// "+" from URLSearchParams shows up literally in the body, %20 and %0A
// decode as a space and a line break.
function gmailComposeUrl({ to, subject, body }) {
  const enc = encodeURIComponent;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
}

function OutreachRow({ row, undoable, onChanged }) {
  const [busy, setBusy] = useState(false);
  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.patchOutreach(row.id, { status });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteOutreach(row.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex-row small mt-1">
      <span className="badge fit-none">{CHANNEL_LABELS[row.channel] || row.channel}</span>
      <span className="muted">{dateOnly(row.sent_at)}</span>
      {row.subject && <span className="muted" title={row.subject}>· {row.subject.length > 48 ? `${row.subject.slice(0, 48)}…` : row.subject}</span>}
      <select value={row.status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
        {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button type="button" className="btn-sm btn-muted" disabled={busy} onClick={remove} title={undoable ? "Remove this entry" : "Delete this entry"}>
        {undoable ? "Undo" : "✕"}
      </button>
    </div>
  );
}

function PersonCard({ person, job, jobId, peopleSearchId, signature, rows, onUpdated }) {
  const [open, setOpen] = useState(null); // "note" | "message" | null
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [undoId, setUndoId] = useState(null);

  // The freshly logged row shows "Undo" for a few seconds, since the row
  // is written when Gmail opens, not when the mail is actually sent.
  useEffect(() => {
    if (undoId == null) return undefined;
    const t = setTimeout(() => setUndoId(null), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [undoId]);

  const drafts = person.drafts;
  const subject = drafts?.email_subject || `${job.title} at ${job.company}`;
  const canEmail = !!person.email_guess && !!drafts?.message;

  const log = async (data) => {
    const { outreach } = await api.logOutreach(jobId, {
      personKey: person.person_key,
      personName: person.name,
      peopleSearchId: peopleSearchId ?? undefined,
      ...data,
    });
    setUndoId(outreach.id);
    onUpdated?.();
  };

  const email = async () => {
    setError(null);
    const body = signature ? `${drafts.message}\n\n${signature}` : drafts.message;
    // window.open must run synchronously inside the click, or the browser
    // treats it as a popup. Don't pass "noopener" in the features string:
    // the spec makes window.open return null in that case even when the
    // window opened, which made every click look popup-blocked. Sever the
    // opener link by hand instead so the return value stays meaningful.
    const win = window.open(gmailComposeUrl({ to: person.email_guess, subject, body }), "_blank");
    if (!win) {
      setError("The browser blocked the Gmail window. Allow popups for this site and try again. Nothing was logged.");
      return;
    }
    try {
      win.opener = null;
    } catch {
      // cross-origin; nothing to do
    }
    try {
      await log({ channel: "email", toAddress: person.email_guess, subject, body });
    } catch (e) {
      setError(`Gmail opened but the send was not logged: ${e.message}`);
    }
  };

  const sentOnLinkedIn = async () => {
    setError(null);
    try {
      await log({ channel: "linkedin", body: drafts?.linkedin_note || undefined });
    } catch (e) {
      setError(e.message);
    }
  };

  const useAsContact = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patchApplication(jobId, {
        contactName: person.name,
        contactEmail: person.email_guess || "",
        contactLinkedin: person.linkedin_url || "",
      });
      onUpdated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-2">
      <div className="spread">
        <div>
          <b className="small">{person.name}</b>
          <span className="small muted"> · {person.title}</span>
          {person.location && <span className="small muted"> · {person.location}</span>}
        </div>
        <span className="flex-row">
          {FOUND_VIA_LABELS[person.found_via] && <span className="badge fit-none">{FOUND_VIA_LABELS[person.found_via]}</span>}
          <span className={`badge ${CONFIDENCE_CLASS[person.confidence] || "fit-none"}`}>{person.confidence} confidence</span>
        </span>
      </div>
      <div className="small mt-1">{person.why_relevant}</div>
      <div className="flex-row small mt-2">
        {isHttpUrl(person.linkedin_url) && (
          <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a>
        )}
        {person.other_urls?.filter(isHttpUrl).map((u, i) => (
          <a key={i} href={u} target="_blank" rel="noopener noreferrer">{linkLabel(u)}</a>
        ))}
        {person.email_guess && (
          <span>
            {person.email_guess} <span className="badge fit-none" title="Pattern-based guess, not verified">unverified guess</span>
          </span>
        )}
      </div>
      <div className="small muted mt-2">
        {person.evidence}{" "}
        {isHttpUrl(person.source_url) && (
          <a href={person.source_url} target="_blank" rel="noopener noreferrer">source</a>
        )}
      </div>
      <div className="flex-row mt-2">
        <button
          type="button"
          className="btn-sm"
          onClick={email}
          disabled={!canEmail}
          title={!person.email_guess ? "No email guess for this person" : !drafts?.message ? "No draft message for this person" : "Open a prefilled Gmail compose window"}
        >
          Email
        </button>
        {drafts?.linkedin_note && (
          <button type="button" className="btn-sm btn-muted" onClick={() => setOpen(open === "note" ? null : "note")}>
            {open === "note" ? "Hide connection note" : "Connection note"}
          </button>
        )}
        {drafts?.message && (
          <button type="button" className="btn-sm btn-muted" onClick={() => setOpen(open === "message" ? null : "message")}>
            {open === "message" ? "Hide message" : "Message"}
          </button>
        )}
        <button type="button" className="btn-sm btn-muted" onClick={sentOnLinkedIn}>Sent on LinkedIn</button>
        <button type="button" className="btn-sm btn-muted" onClick={useAsContact} disabled={saving}>
          {saving ? "Saving…" : "Use as contact"}
        </button>
      </div>
      {open === "note" && (
        <div className="mt-2">
          <div className="small pre-wrap">{drafts.linkedin_note}</div>
          <div className="flex-row mt-2">
            <CopyButton text={drafts.linkedin_note} label="Copy note" />
            <span className="small muted">{drafts.linkedin_note.length}/300 characters</span>
          </div>
        </div>
      )}
      {open === "message" && (
        <div className="mt-2">
          <div className="small muted mb-1">Subject: {subject}</div>
          <div className="small pre-wrap">{drafts.message}</div>
          <div className="mt-2"><CopyButton text={drafts.message} label="Copy message" /></div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="mt-2">
          {rows.map((r) => <OutreachRow key={r.id} row={r} undoable={r.id === undoId} onChanged={() => onUpdated?.()} />)}
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

// The signed-in Chrome profile the search reads LinkedIn through. Connect
// opens it on the login page; Check loads the feed headless to confirm.
function LinkedInRow() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null); // "check" | "connect" | null
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.linkedInStatus().then(setStatus).catch((e) => setError(e.message));
  }, []);

  const check = async () => {
    setBusy("check");
    setError(null);
    try {
      const next = await api.checkLinkedIn();
      setStatus(next);
      setNote(next.connected && next.closedWindow ? "Signed in. The sign-in window was closed; searches now read LinkedIn through that profile." : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      await api.connectLinkedIn();
      setNote("A Chrome window opened on LinkedIn's login page. Sign in there, then click Check here; the check closes that window once it sees you signed in.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (status && !status.enabled) return null;
  const state = !status ? "…" : status.connected ? `connected${status.checkedAt ? ` (checked ${dateOnly(status.checkedAt)})` : ""}` : "not connected";
  return (
    <div className="small mb-3">
      <div className="flex-row">
        <span>
          <b>LinkedIn:</b> {state}
          {status && !status.connected && status.reason && <span className="muted"> · {status.reason}</span>}
        </span>
        <button type="button" className="btn-sm btn-muted" onClick={check} disabled={!!busy}>{busy === "check" ? "Checking…" : "Check"}</button>
        <button type="button" className="btn-sm btn-muted" onClick={connect} disabled={!!busy}>
          {busy === "connect" ? "Opening…" : status?.connected ? "Sign in again" : "Connect LinkedIn"}
        </button>
      </div>
      {note && <div className="muted mt-1">{note}</div>}
      {status && !status.connected && !note && (
        <div className="muted mt-1">
          Signed in, the search reads company People pages and profiles directly instead of relying on search snippets. It uses a
          Chrome profile of its own, not your everyday browser.
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

function SearchControls({ hints, setHints, hasResult, onSearch }) {
  return (
    <div className="mb-3">
      <textarea rows={2} value={hints} placeholder={HINTS_PLACEHOLDER} onChange={(e) => setHints(e.target.value)} />
      <div className="flex-row mt-2">
        <button type="button" onClick={() => onSearch({ buildOn: true })}>{hasResult ? "Search deeper" : "Find people"}</button>
        {hasResult && (
          <button
            type="button"
            className="btn-sm btn-muted"
            onClick={() => onSearch({ buildOn: false })}
            title="Ignore the people found so far and search from scratch"
          >
            Start fresh
          </button>
        )}
      </div>
    </div>
  );
}

export default function PeoplePanel({ jobId, job, people, outreach = [], signature = "", onUpdated }) {
  const { start, cancel, retry } = useTasks();
  const task = useJobTask(jobId, "people");
  const active = isActive(task);
  const [error, setError] = useState(null);
  // Prefilled from the latest run so a hint survives "Search deeper".
  const [hints, setHints] = useState(people?.hints || "");
  useEffect(() => {
    if (people?.hints) setHints((h) => h || people.hints);
  }, [people?.id, people?.hints]);

  // The drawer reloads its detail (and so the `people` prop) when the task
  // finishes, through the tasks context; nothing to poll here.
  const search = async ({ buildOn = true } = {}) => {
    setError(null);
    try {
      await start(() => api.runPeopleSearch(jobId, { hints: hints.trim(), buildOn }));
    } catch (e) {
      setError(e.message);
    }
  };

  const failed = task?.status === "failed" && (
    <ErrorBox>
      Finding people failed: {task.error}{" "}
      <button type="button" className="btn-sm btn-muted" onClick={() => retry(task.id)}>Retry</button>
    </ErrorBox>
  );

  if (active) {
    return (
      <div>
        <RunProgress run={task} />
        <button type="button" className="btn-sm btn-muted" onClick={() => cancel(task.id)}>Cancel</button>
      </div>
    );
  }

  const data = people?.result_json;
  if (!data) {
    return (
      <div>
        <p className="muted small">
          Nobody found yet. The search runs up to several rounds over the company site, blog bylines, GitHub, press and
          conference pages, web search and (when connected) LinkedIn, looking for the likely hiring manager, in-house
          recruiters and peers. Then it drafts a note for each.
        </p>
        <LinkedInRow />
        {failed}
        <ErrorBox>{error}</ErrorBox>
        <SearchControls hints={hints} setHints={setHints} hasResult={false} onSearch={search} />
      </div>
    );
  }

  const byType = new Map();
  for (const p of data.people) {
    const list = byType.get(p.role_type) || [];
    list.push(p);
    byType.set(p.role_type, list);
  }
  const rowsByPerson = new Map();
  for (const r of outreach) {
    const list = rowsByPerson.get(r.person_key) || [];
    list.push(r);
    rowsByPerson.set(r.person_key, list);
  }

  return (
    <div>
      {failed}
      <ErrorBox>{error}</ErrorBox>
      <LinkedInRow />
      <SearchControls hints={hints} setHints={setHints} hasResult onSearch={search} />
      <div className="small muted mb-3">
        {data.people.length} {data.people.length === 1 ? "person" : "people"}
        {data.rounds ? ` · ${data.rounds} ${data.rounds === 1 ? "round" : "rounds"}` : ""}
        {LINKEDIN_STATUS_LABELS[data.linkedin?.status] ? ` · ${LINKEDIN_STATUS_LABELS[data.linkedin.status]}` : ""}
        {data.company_domain ? ` · ${data.company_domain}` : ""}
        {people.created_at ? ` · ${dateOnly(people.created_at)}` : ""}
        {people.cost_usd > 0 ? ` · $${Number(people.cost_usd).toFixed(2)}` : ""}
        {outreach.length ? ` · ${outreach.length} sent` : ""}
        {data.partial ? " · partial: the run stopped before it finished; Search deeper continues from here" : ""}
      </div>
      {data.people.length === 0 && (
        <p className="small muted">
          The search found nobody it could stand behind. The notes below say what it tried; add a hint and search deeper, or
          connect LinkedIn.
        </p>
      )}
      {GROUPS.map(([type, label]) => {
        const list = byType.get(type);
        if (!list?.length) return null;
        return (
          <div key={type} className="mb-4">
            <div className="section-title">{label}</div>
            {list.map((p) => (
              <PersonCard
                key={p.person_key}
                person={p}
                job={job}
                jobId={jobId}
                peopleSearchId={people.id}
                signature={signature}
                rows={rowsByPerson.get(p.person_key) || []}
                onUpdated={onUpdated}
              />
            ))}
          </div>
        );
      })}
      {(data.email_pattern || data.search_notes?.length > 0 || data.next_steps?.length > 0 || data.search_log?.length > 0) && (
        <div className="card">
          <div className="section-title">Search notes</div>
          {data.email_pattern && (
            <div className="small mb-2">
              Email pattern seen: <code>{data.email_pattern}</code>
              {isHttpUrl(data.email_pattern_source) && (
                <>
                  {" "}(<a href={data.email_pattern_source} target="_blank" rel="noopener noreferrer">source</a>)
                </>
              )}
            </div>
          )}
          {data.search_notes?.length > 0 && (
            <ul className="small">{data.search_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {data.next_steps?.length > 0 && (
            <details className="small mt-2">
              <summary>What the next round would try ({data.next_steps.length})</summary>
              <ul>{data.next_steps.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
          {data.search_log?.length > 0 && (
            <details className="small mt-2">
              <summary>Search log ({data.search_log.length} searches and page reads)</summary>
              <ul className="muted">{data.search_log.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
