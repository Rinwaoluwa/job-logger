import { useMemo } from "react";
import { renderResumeHtml } from "../../../shared/resumeTemplate.js";
import { applyReview } from "../../../shared/applyReview.js";
import { stepOf } from "../../../shared/resumeLayout.js";
import { RESUME_FONT_BASE } from "../../lib/resumeFonts.js";

const PAGE_HEIGHT_PX = 1056; // US Letter at 96dpi

// The résumé on a sheet of paper, at its real width. The iframe is sized
// tall enough for the whole document so the only scrollbar is the
// surface's — nesting a scrollable iframe inside a scrollable panel made
// this almost impossible to read.
export default function ResumePreview({ document, decisions }) {
  const html = useMemo(
    () =>
      renderResumeHtml(applyReview(document.content_json, decisions, { mode: "preview" }), {
        step: stepOf(document.content_json),
        fontBaseUrl: RESUME_FONT_BASE,
      }),
    [document, decisions],
  );

  // Page count comes from the server's Chrome measurement; the on-screen
  // flow is a little shorter than print (no page margins), so the slack
  // shows as a small white gap rather than clipping the last bullet.
  const pages = Math.max(1, document.content_json?.layout?.pages || 2);

  return (
    <div className="doc-page">
      <iframe
        className="doc-page-iframe"
        style={{ height: pages * PAGE_HEIGHT_PX + 48 }}
        sandbox=""
        srcDoc={html}
        title="Résumé preview"
      />
    </div>
  );
}
