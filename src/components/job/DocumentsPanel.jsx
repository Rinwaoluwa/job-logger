import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.js";
import { dateOnly } from "../../lib/format.js";
import { useTaskTransition } from "../../hooks/useTasks.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import ResumePreview from "../resume/ResumePreview.jsx";
import ReviseThread from "../resume/ReviseThread.jsx";
import ReviewPanel from "../resume/ReviewPanel.jsx";
import KeywordPanel from "../resume/KeywordPanel.jsx";
import ResumeExportBar from "../resume/ResumeExportBar.jsx";
import BulletList from "../resume/BulletList.jsx";
import { pendingCount } from "../../../shared/applyReview.js";
import CoverLetterPanel, { CoverLetterActions } from "../CoverLetterPanel.jsx";

const KIND_LABELS = { resume: "Résumé", cover_letter: "Cover letter", answer: "Answer", fit_report: "Fit report" };
const KIND_ORDER = ["resume", "cover_letter", "answer", "fit_report"];

const byVersionDesc = (a, b) => b.version - a.version;

// A version made from an instruction shows it in the rail, so the list of
// versions reads as the conversation that produced them.
const quote = (text, max = 48) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `“${t.slice(0, max - 1).trimEnd()}…”` : `“${t}”`;
};

// Selection is held as { kind, version } rather than a document id, with
// version null meaning "whichever is newest". That way regenerating moves
// you onto the new v3 instead of leaving you staring at v2, and switching
// documents doesn't need the list to have loaded first.
function resolveSelection(docs, sel) {
  if (docs.length === 0) return null;
  const kinds = KIND_ORDER.filter((k) => docs.some((d) => d.kind === k));
  const kind = sel?.kind && kinds.includes(sel.kind) ? sel.kind : kinds[0];
  const ofKind = docs.filter((d) => d.kind === kind).sort(byVersionDesc);
  if (sel?.version == null) return ofKind[0];
  return ofKind.find((d) => d.version === sel.version) || ofKind[0];
}

function DocumentRail({ docs, selected, sel, onSelect, sentId }) {
  const [expanded, setExpanded] = useState({});

  const groups = useMemo(() => {
    const kinds = KIND_ORDER.filter((k) => docs.some((d) => d.kind === k));
    return kinds.map((kind) => ({ kind, versions: docs.filter((d) => d.kind === kind).sort(byVersionDesc) }));
  }, [docs]);

  return (
    <div className="docws-rail">
      {groups.map(({ kind, versions }) => {
        const latest = versions[0];
        const older = versions.slice(1);
        const isOpen = !!expanded[kind];
        const onOlder = selected?.kind === kind && selected.id !== latest.id;
        return (
          <div className="rail-group" key={kind}>
            <button
              type="button"
              className={`rail-item ${selected?.kind === kind && !onOlder ? "active" : ""}`}
              onClick={() => onSelect({ kind, version: null })}
            >
              <div className="bold">{KIND_LABELS[kind] || kind}</div>
              <div className="rail-meta">
                v{latest.version} · {dateOnly(latest.created_at)}
                {versions.length > 1 ? " · latest" : ""}
                {latest.resume_version != null ? ` · from résumé v${latest.resume_version}` : ""}
                {latest.id === sentId && <span className="chip-ok sent-chip">sent</span>}
              </div>
              {latest.instruction && <div className="rail-meta rail-quote">{quote(latest.instruction)}</div>}
            </button>
            {older.length > 0 && (
              <>
                <button type="button" className="rail-toggle" onClick={() => setExpanded((e) => ({ ...e, [kind]: !isOpen }))}>
                  {isOpen ? "▾" : "▸"} {older.length} earlier version{older.length === 1 ? "" : "s"}
                </button>
                {isOpen &&
                  older.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`rail-version ${selected?.id === d.id ? "active" : ""}`}
                      onClick={() => onSelect({ kind, version: d.version })}
                    >
                      v{d.version} · {dateOnly(d.created_at)}
                      {d.resume_version != null ? ` · from résumé v${d.resume_version}` : ""}
                      {d.id === sentId && <span className="chip-ok sent-chip">sent</span>}
                      {d.instruction && <div className="rail-quote">{quote(d.instruction)}</div>}
                    </button>
                  ))}
              </>
            )}
          </div>
        );
      })}
      {/* keeps the rail honest about what the selector is pinned to */}
      {sel?.version != null && (
        <div className="small muted" style={{ padding: "0 9px" }}>
          Viewing an older version.
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.jobId
 * @param {number} props.refreshKey
 * @param {number|null} [props.sentResumeDocumentId] - the résumé version marked as sent (the drawer passes it; briefs have none)
 * @param {() => void} [props.onSentChanged]
 */
export default function DocumentsPanel({ jobId, refreshKey, sentResumeDocumentId = null, onSentChanged }) {
  const [docs, setDocs] = useState([]);
  const [sel, setSel] = useState(null);
  const [full, setFull] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [pane, setPane] = useState("preview");
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let live = true;
    api.listDocuments(jobId)
      .then((d) => { if (live) { setDocs(d); setLoadError(null); } })
      .catch((e) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [jobId, refreshKey]);

  const selected = useMemo(() => resolveSelection(docs, sel), [docs, sel]);

  useEffect(() => {
    if (!selected) { setFull(null); return; }
    let live = true;
    api.getDocument(selected.id).then((doc) => {
      if (!live) return;
      setFull(doc);
      setDecisions(doc.review_decisions || {});
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Panes are per-kind; a cover letter has no bullets to fall back to.
  useEffect(() => { setPane("preview"); }, [selected?.kind]);

  // A finished revision is the next version of the résumé: move onto it,
  // even when an older version was pinned (that is the one it came from).
  // Not at submit time — the newest version then would be a different
  // one. The drawer's own transition re-lists the documents.
  useTaskTransition(
    (t) => t.jobId === jobId && t.kind === "revise_resume",
    (t) => { if (t.status === "done") setSel({ kind: "resume", version: null }); },
  );
  // Likewise a rewritten cover letter: show the new version, not the one
  // the button was pressed on.
  useTaskTransition(
    (t) => t.jobId === jobId && t.kind === "cover_letter",
    (t) => { if (t.status === "done") setSel({ kind: "cover_letter", version: null }); },
  );

  if (docs.length === 0) {
    return (
      <EmptyState
        compact
        title={loadError ? "Could not load the documents" : "No documents yet"}
        body={loadError || "Use “Prepare application” to generate a résumé and cover letter."}
      />
    );
  }

  const isResume = full?.kind === "resume";
  // pendingCount already leaves out blocking entries and open-gate ones
  // (AI-composed bullets and reviewer notes), which need no decision.
  const pendingReview = isResume ? pendingCount(full.content_json, decisions) : 0;
  // Only the actionable misses get a badge — an honest gap is information,
  // not a task, and a number on a tab should mean there is something to do.
  const keywordGaps = isResume ? full.content_json.keyword_coverage?.counts?.missing_claimable || 0 : 0;
  // Questions the AI left open on this version are the one thing in the
  // revise thread that waits on you.
  const openQuestions = isResume ? (full.content_json.open_questions || []).length : 0;
  const nextResumeVersion = docs.filter((d) => d.kind === "resume").reduce((m, d) => Math.max(m, d.version), 0) + 1;

  return (
    <div className="docws">
      <DocumentRail docs={docs} selected={selected} sel={sel} onSelect={setSel} sentId={sentResumeDocumentId} />

      <div className="docws-main">
        <div className="docws-toolbar">
          <span className="docws-toolbar-title">
            {KIND_LABELS[selected?.kind] || selected?.kind} v{selected?.version}
          </span>
          {isResume && (
            <div className="segmented">
              <button type="button" className={pane === "preview" ? "active" : ""} onClick={() => setPane("preview")}>
                Preview
              </button>
              <button type="button" className={pane === "revise" ? "active" : ""} onClick={() => setPane("revise")}>
                Revise
                {openQuestions > 0 && <span className="count" title="Questions the AI left open on this version">{openQuestions}</span>}
              </button>
              <button type="button" className={pane === "review" ? "active" : ""} onClick={() => setPane("review")}>
                Review
                {pendingReview > 0 && <span className="count">{pendingReview}</span>}
              </button>
              <button type="button" className={pane === "bullets" ? "active" : ""} onClick={() => setPane("bullets")}>
                Bullets
              </button>
              <button type="button" className={pane === "keywords" ? "active" : ""} onClick={() => setPane("keywords")}>
                Keywords
                {keywordGaps > 0 && <span className="count">{keywordGaps}</span>}
              </button>
            </div>
          )}
          <span className="docws-spacer" />
          {isResume && onSentChanged && (
            full.id === sentResumeDocumentId
              ? <span className="chip-ok small" title="The version the interviewer has read; interview prep is written against it">sent</span>
              : (
                <button
                  type="button"
                  className="btn-sm btn-muted"
                  title="Mark this version as the one you sent; interview prep is written against it"
                  onClick={() => api.patchApplication(jobId, { sentResumeDocumentId: full.id }).then(onSentChanged)}
                >
                  Mark as sent
                </button>
              )
          )}
          {isResume && <ResumeExportBar document={full} decisions={decisions} />}
          {full?.kind === "cover_letter" && <CoverLetterActions document={full} jobId={jobId} latestResumeVersion={nextResumeVersion - 1} />}
        </div>

        <div className={`docws-surface ${isResume && pane === "revise" ? "docws-surface-flush" : ""}`}>
          {!full && <div className="muted small">Loading…</div>}

          {isResume && pane === "preview" && <ResumePreview document={full} decisions={decisions} />}
          {isResume && pane === "revise" && (
            <ReviseThread
              jobId={jobId}
              document={full}
              nextVersion={nextResumeVersion}
              onSelectVersion={(version) => setSel({ kind: "resume", version })}
            />
          )}
          {isResume && pane === "review" && (
            <div className="card docws-panel">
              <div className="section-title">Flagged additions</div>
              <ReviewPanel document={full} onDecisionsChanged={setDecisions} />
            </div>
          )}
          {isResume && pane === "bullets" && (
            <div className="card docws-panel">
              <div className="section-title">Bullets — edit and trace to profile stories</div>
              <BulletList document={full} onDocumentChanged={setFull} />
            </div>
          )}
          {isResume && pane === "keywords" && (
            <div className="card docws-panel">
              <div className="section-title">ATS keyword coverage</div>
              <KeywordPanel document={full} />
            </div>
          )}

          {full?.kind === "cover_letter" && <CoverLetterPanel document={full} latestResumeVersion={nextResumeVersion - 1} />}
          {(full?.kind === "answer" || full?.kind === "fit_report") && (
            <div className="doc-page">
              <div className="doc-page-text">
                {full.question && <div className="small muted mb-3">{full.question}</div>}
                {full.content_text}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
