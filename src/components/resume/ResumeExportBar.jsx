import { useMemo } from "react";
import CopyButton from "../ui/CopyButton.jsx";
import { renderResumeHtml } from "../../../shared/resumeTemplate.js";
import { applyReview, pendingCount } from "../../../shared/applyReview.js";
import { downloadHtml, printHtml } from "../../lib/download.js";
import { resumeFilename } from "../../../shared/resumeFilename.js";
import { stepOf } from "../../../shared/resumeLayout.js";
import { RESUME_FONT_BASE } from "../../lib/resumeFonts.js";
import { useDownload } from "../../hooks/useDownload.js";

// Lives in the document toolbar. PDF is the primary download: it is
// written with pdfkit on the server, so its text is real strings and an
// ATS extracts it exactly (the Chrome-printed PDF we offered before
// positioned every glyph separately, and parsers split the name itself).
// Word is the fallback for portals that ask for it; Print, HTML and Copy
// are occasional escape hatches, so they all sit behind "More".
export default function ResumeExportBar({ document, decisions }) {
  const pending = useMemo(() => pendingCount(document.content_json, decisions), [document, decisions]);
  const exportHtml = () =>
    renderResumeHtml(applyReview(document.content_json, decisions, { mode: "export" }), {
      step: stepOf(document.content_json),
      fontBaseUrl: RESUME_FONT_BASE,
    });
  const { busy, error, download } = useDownload();

  // Name plus company ("Alex_Morgan_Cohere"). The server names the PDF
  // and .docx itself from the job's company; this is for the .html, which
  // never leaves the browser.
  const filename = resumeFilename(document);
  const layout = document.content_json.layout;
  const overBudget = layout?.pages > layout?.max_pages;

  const fetchFormat = (format) => download(format, `/api/documents/${document.id}/${format}`, `${filename}.${format}`);

  return (
    <>
      {layout?.pages && (
        <span className={`small `}>
          {layout.pages} page{layout.pages === 1 ? "" : "s"}
          {overBudget ? ` · over the ${layout.max_pages}-page budget` : ""}
        </span>
      )}
      {pending > 0 && (
        <span className="small inferred-note" title="Pending additions are left out of the download">
          {pending} pending excluded
        </span>
      )}
      <button
        type="button"
        onClick={() => fetchFormat("pdf")}
        disabled={!!busy}
        title="PDF with real text — opens anywhere and an ATS reads it exactly"
      >
        {busy === "pdf" ? "Building…" : "Download PDF"}
      </button>
      <details className="more-menu">
        <summary>More</summary>
        <div className="more-menu-items">
          <button type="button" onClick={() => fetchFormat("docx")} disabled={!!busy} title="Word — for portals that ask for .docx">
            {busy === "docx" ? "Building…" : "Download .docx"}
          </button>
          <button type="button" onClick={() => printHtml(exportHtml())}>Print</button>
          <button type="button" onClick={() => downloadHtml(exportHtml(), `${filename}.html`)}>Download .html</button>
          <CopyButton text={exportHtml} label="Copy HTML" size="md" />
        </div>
      </details>
      {error && <span className="small text-danger">{error}</span>}
    </>
  );
}
