// One filename for every export of a document, computed on the server
// (Content-Disposition on the download routes) and, as a fallback, in the
// browser (the <a download> name), so what lands in Downloads is the same
// whichever side names it: "Alex_Morgan_Cohere" for a résumé,
// "Alex_Morgan_Cover_Letter_Cohere" for the letter — never a bare
// "resume.pdf" in a folder full of them.

const KIND_SUFFIX = { resume: "", cover_letter: "Cover Letter" };

/** The company a document title carries ("Résumé — Shopify" → "Shopify"), or "". */
export const companyFromTitle = (title) => (title || "").split("—").slice(1).join("—").trim();

/**
 * @param {{name?: string, company?: string, kind?: "resume"|"cover_letter"}} parts
 * @returns {string} e.g. "Alex_Morgan_Shopify" — without an extension.
 */
export function documentFilename({ name, company, kind = "resume" }) {
  return [(name || "resume").trim(), KIND_SUFFIX[kind] || "", (company || "").trim()]
    .filter(Boolean)
    .join(" ")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Résumé filename from the document itself. The server passes the job's
 * company, which is always known; the browser, which only has the
 * document, falls back to the company in the title when there is one.
 * @param {{content_json?: object, title?: string}} document
 * @param {{company?: string}} [opts]
 */
export function resumeFilename(document, { company } = {}) {
  return documentFilename({
    name: document.content_json?.resume?.header?.name,
    company: company ?? companyFromTitle(document.title),
    kind: "resume",
  });
}
