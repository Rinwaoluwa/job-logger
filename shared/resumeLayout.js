// One typography spec for the résumé, read by all three renderers: the
// PDF writer (server/render/pdf.js), which produces the default download,
// the .docx writer (server/render/docx.js), and the HTML template
// (shared/resumeTemplate.js), which drives the on-screen preview and the
// page measurement. Keeping the numbers in one place is what makes "it
// fits on one page" true of every output and not just of the preview.
//
// Everything is in points. The .docx converts to half-points (font size)
// and twips (spacing); the HTML and PDF use pt directly.

export const PAGE = { widthIn: 8.5, heightIn: 11, marginIn: 0.4 };

// The typeface, embedded in the PDF and the .docx and served to the
// preview from /api/fonts. Static instances (not the variable font): pdfkit
// renders only a variable font's default instance and Word will not embed
// one. Files live in server/render/fonts/ under the OFL.
export const FONT = {
  family: "EB Garamond",
  files: { regular: "EBGaramond-Regular.ttf", bold: "EBGaramond-Bold.ttf" },
  fallback: "Garamond, Georgia, serif",
};

// Line height as a multiple of the font size, set explicitly in every
// renderer (CSS line-height, Word "exactly" spacing, pdfkit lineGap)
// rather than left to the font: EB Garamond's own metrics ask for 1.305
// (ascent 1007 + descent 298 per 1000), which would cost a one-page résumé
// about seven lines. 1.22 is Calibri's natural leading, which every
// existing document was measured at, and the face's real ink (ascenders
// to descenders) still fits in it.
export const LINE_HEIGHT_RATIO = 1.22;

// Step 0 is the normal layout: 10pt body, tight spacing. Step 1 is the
// last resort the tailor pipeline falls back to when trimming text was
// not enough: 9.5pt body and tighter still. Nothing goes smaller than that.
export const LAYOUT_STEPS = [
  {
    body: 10, side: 9, name: 16, title: 11.5, contact: 9.5, heading: 10.5, company: 11,
    headerGap: 0.5, headerAfter: 1.5, headingBefore: 3, headingAfter: 1.5, paraAfter: 0,
    roleBefore: 2, bulletAfter: 0, bulletIndentPt: 13,
  },
  {
    body: 9.5, side: 8.5, name: 15, title: 11, contact: 9, heading: 10, company: 10.5,
    headerGap: 0.5, headerAfter: 1, headingBefore: 2.5, headingAfter: 1, paraAfter: 0,
    roleBefore: 1.5, bulletAfter: 0, bulletIndentPt: 12,
  },
];

// Cover letter: a roomier page than the résumé, read by both the PDF and
// .docx writers. Same typeface and line-height ratio.
export const LETTER = { marginIn: 0.9, body: 11, name: 14, contact: 9.5, headerAfter: 14, paraAfter: 8 };

/** The layout step a saved résumé renders at (content_json.layout.step). */
export function layoutStep(index) {
  const i = Number.isInteger(index) ? index : 0;
  return LAYOUT_STEPS[Math.min(Math.max(0, i), LAYOUT_STEPS.length - 1)];
}

/** Step index recorded on a résumé document's content_json, 0 if none. */
export const stepOf = (contentJson) => contentJson?.layout?.step ?? 0;
