import { useState } from "react";
import CopyButton from "./ui/CopyButton.jsx";
import { api } from "../api/client.js";
import { useDownload } from "../hooks/useDownload.js";
import { useTasks, useJobTask } from "../hooks/useTasks.jsx";
import { isActive } from "../../shared/tasks.js";

function letterText(document) {
  return document.content_text || (document.content_json.paragraphs || []).join("\n\n");
}

/** Toolbar actions for a cover letter, so they sit with the résumé's.
 * PDF and .docx are rendered on the server in the résumé's typeface and
 * named with the job's company, the same way the résumé is. "Rewrite from
 * résumé" queues a cover_letter task that writes the next letter version
 * from the newest résumé as it stands (review decisions included). */
export function CoverLetterActions({ document, jobId, latestResumeVersion = null }) {
  const text = letterText(document);
  const { busy, error, download } = useDownload();
  const fetchFormat = (format) => download(format, `/api/documents/${document.id}/${format}`, `cover_letter.${format}`);

  const { start } = useTasks();
  const rewriteTask = useJobTask(jobId, "cover_letter");
  const rewriting = isActive(rewriteTask);
  // Prepare and revise write their own letter when they finish.
  const prepareTask = useJobTask(jobId, "prepare_application");
  const reviseTask = useJobTask(jobId, "revise_resume");
  const resumeBusy = isActive(prepareTask) || isActive(reviseTask);
  const [rewriteError, setRewriteError] = useState(null);
  const rewrite = async () => {
    setRewriteError(null);
    try {
      await start(() => api.rewriteCoverLetter(jobId));
    } catch (e) {
      setRewriteError(e.message);
    }
  };
  const rewriteTitle = resumeBusy
    ? "The résumé is being rewritten; it brings a new cover letter with it"
    : "Write a new version of this letter from the newest résumé, with your review decisions applied";

  return (
    <>
      {jobId && (
        <button type="button" onClick={rewrite} disabled={rewriting || resumeBusy} title={rewriteTitle}>
          {rewriting ? (rewriteTask.status === "queued" ? "Queued…" : "Rewriting…") : `Rewrite from résumé${latestResumeVersion ? ` v${latestResumeVersion}` : ""}`}
        </button>
      )}
      <button type="button" onClick={() => fetchFormat("pdf")} disabled={!!busy} title="PDF with real text — opens anywhere">
        {busy === "pdf" ? "Building…" : "Download PDF"}
      </button>
      <details className="more-menu">
        <summary>More</summary>
        <div className="more-menu-items">
          <button type="button" onClick={() => fetchFormat("docx")} disabled={!!busy} title="Word — for portals that ask for .docx">
            {busy === "docx" ? "Building…" : "Download .docx"}
          </button>
          <CopyButton text={text} label="Copy text" size="md" />
        </div>
      </details>
      {(error || rewriteError) && <span className="small text-danger">{error || rewriteError}</span>}
    </>
  );
}

/** The letter itself, on the same page surface the résumé uses, with the
 * résumé version it was written to match. A revision writes a fresh
 * letter, so a letter behind the newest résumé means that write failed
 * or the letter predates the link; one more revision refreshes it. */
export default function CoverLetterPanel({ document, latestResumeVersion = null }) {
  const data = document.content_json;
  const claims = data.inferred_claims || [];
  const from = data.resume_version ?? null;
  const behind = from != null && latestResumeVersion != null && latestResumeVersion > from;

  return (
    <>
      <div className="doc-page">
        <div className="doc-page-text">{letterText(document)}</div>
      </div>
      {from != null && (
        <div className="small muted mt-2">
          Written from résumé v{from}.
          {behind && ` The résumé has moved on to v${latestResumeVersion}; use "Rewrite from résumé" to refresh this letter.`}
        </div>
      )}
      {claims.length > 0 && (
        <div className="card docws-panel mt-4">
          <div className="section-title">Not from your profile — review before sending</div>
          <ul className="small m-0 pl-5">
            {claims.map((c, i) => (
              <li key={i} className="mb-1">
                {c.text} <span className="muted">— {c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
