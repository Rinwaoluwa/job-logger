// Answers "how long is this résumé, really?" — the question nothing in
// the pipeline used to ask. Bullet-level word limits say nothing about
// whether the document spills onto another page, and page count is the
// constraint that actually forces the interesting decision: what gets cut.
//
// The measurement is a real Chrome render of the résumé HTML, laid out
// from the same spec as the PDF and .docx (shared/resumeLayout.js) and set
// in the same embedded typeface at the same line height, so lines wrap
// where the exports wrap them. The render sizes its own page to the content (see the template's
// measure mode), so the PDF's MediaBox gives the exact content height in
// points: how far over the budget it runs, not just whether it does.
// When no browser is installed we fall back to a rough layout estimate so
// the pipeline still has a length signal instead of none at all.

import { renderResumeHtml } from "../../shared/resumeTemplate.js";
import { applyReview } from "../../shared/applyReview.js";
import { PAGE, LINE_HEIGHT_RATIO, layoutStep } from "../../shared/resumeLayout.js";
import { htmlToPdf, findChrome } from "./chrome.js";
import { FONT_FILE_URL_BASE } from "./fonts.js";

// Content height one page holds, in points, less a safety margin so the
// small differences between Chrome's, pdfkit's and Word's line breaking
// can never carry a "fits" verdict onto a second page in an export.
const SAFETY_PT = 8;
const PAGE_CONTENT_PT = (PAGE.heightIn - PAGE.marginIn * 2) * 72 - SAFETY_PT;
const CONTENT_WIDTH_PT = (PAGE.widthIn - PAGE.marginIn * 2) * 72;

/**
 * The résumé exactly as it currently stands, with every bullet still on
 * the page: a gap fill exports unless the reviewer rejects it and a held
 * bullet takes up space in the preview until he decides, so length has to
 * be measured with them all included. Since gap fills went on by default
 * (2026-10-06) this is also close to what the export carries.
 */
export function measurableHtml(contentJson, step = 0) {
  return renderResumeHtml(applyReview(contentJson, {}, { mode: "preview" }), { step, fontBaseUrl: FONT_FILE_URL_BASE, measure: true });
}

/** Content height in points read from the PDF, or null if unreadable. */
function contentHeightPt(pdf) {
  const box = /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  if (!box) return null;
  // The template pads the sized page by both margins plus 0.05in.
  return Number(box[1]) - (PAGE.marginIn * 2 + 0.05) * 72;
}

// EB Garamond runs about 0.43em per character in running text (measured
// against Source Sans 3's 0.47 on the same copy); close enough to count
// wrapped lines, which is all the estimate is used for.
const wrappedLines = (text, sizePt, widthPt = CONTENT_WIDTH_PT) =>
  Math.max(1, Math.ceil((text || "").length / Math.max(20, Math.floor(widthPt / (sizePt * 0.43)))));

/** Approximate content height in points, used only when Chrome is absent. */
function estimateHeightPt(resume, L) {
  const line = (size) => size * LINE_HEIGHT_RATIO;
  let h = line(L.name) + line(L.contact) * 2 + L.headerGap + L.headerAfter;
  if (resume.target_title) h += line(L.title) + L.headerGap * 2;
  const heading = () => { h += L.headingBefore + line(L.heading) + 2.75 + L.headingAfter; };
  const bullet = (text) => { h += wrappedLines(text, L.body, CONTENT_WIDTH_PT - L.bulletIndentPt) * line(L.body) + L.bulletAfter; };

  heading();
  h += wrappedLines(resume.professional_summary, L.body) * line(L.body) + L.paraAfter;

  const groups = (resume.skill_groups || []).filter((g) => (g.items || []).length);
  if (groups.length) heading();
  for (const g of groups) h += wrappedLines(`${g.title}: ${g.items.join(", ")}`, L.body) * line(L.body) + L.paraAfter;

  if ((resume.certifications || []).length) heading();
  for (const c of resume.certifications || []) bullet(c);

  if ((resume.experience || []).length) heading();
  for (const role of resume.experience || []) {
    h += L.roleBefore + line(L.company);
    for (const b of role.bullets || []) bullet(typeof b === "string" ? b : b?.text);
  }

  if ((resume.education || []).length) heading();
  for (const e of resume.education || []) bullet(e);
  return h;
}

/**
 * @param {object} contentJson - a resume document's content_json
 * @param {{maxPages?: number, step?: number}} [opts] - step is the layout
 *   step (shared/resumeLayout.js) to measure at
 * @returns {Promise<{pages: number, method: "pdf"|"estimate", linesOver: number, step: number}>}
 *   `linesOver` is how many body-text lines to cut to get back inside
 *   `maxPages` — a directive for the rewrite prompt, never a gate.
 */
export async function measureResume(contentJson, { maxPages = 1, step = 0 } = {}) {
  const L = layoutStep(step);
  const result = (heightPt, method) => ({
    pages: Math.max(1, Math.ceil(heightPt / PAGE_CONTENT_PT)),
    method,
    linesOver: Math.ceil(Math.max(0, heightPt - PAGE_CONTENT_PT * maxPages) / (L.body * LINE_HEIGHT_RATIO)),
    step,
  });
  const estimate = () => result(estimateHeightPt(applyReview(contentJson, {}, { mode: "preview" }), L), "estimate");

  if (!findChrome()) return estimate();
  const height = contentHeightPt(await htmlToPdf(measurableHtml(contentJson, step)));
  return height === null ? estimate() : result(height, "pdf");
}
