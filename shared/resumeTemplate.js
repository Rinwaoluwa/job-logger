// Moved from the old App.jsx (renderResumeHtml, lines 37-192) with one
// addition: bullet items may now be a plain string OR { text, className }
// so applyReview() can mark inferred/pending bullets with <mark> in
// preview mode without this template knowing anything about review state.
//
// The layout mirrors the PDF and .docx exports (server/render/pdf.js,
// server/render/docx.js) paragraph for paragraph, from the same spec
// (shared/resumeLayout.js): same typeface, sizes, line height, spacing,
// margins and single-column skills. That is what lets a Chrome render of
// this HTML stand in for the exports when the tailor pipeline checks
// whether the résumé fits on one page.

import { PAGE, FONT, LINE_HEIGHT_RATIO, layoutStep } from "./resumeLayout.js";

const escapeHtml = (s) =>
  (s ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeUrl = (u) => {
  const v = (u ?? "").toString().trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `https://${v}`;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Wrap pending or rejected terms (preview only) in a span, matched as
 * whole words on already-escaped HTML. `marks` is [{ term, className }].
 */
function markTerms(escapedHtml, marks) {
  let out = escapedHtml;
  for (const { term, className } of marks || []) {
    const t = escapeRegex(escapeHtml(term));
    if (!t) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9+#])(${t})(?![A-Za-z0-9+#])`);
    out = out.replace(re, `$1<span class="pending-term ${escapeHtml(className || "inferred")}">$2</span>`);
  }
  return out;
}

function bulletHtml(bullet) {
  if (typeof bullet === "string") return `<li>${escapeHtml(bullet)}</li>`;
  const { text, className } = bullet;
  return `<li class="${escapeHtml(className || "")}">${escapeHtml(text)}</li>`;
}

// The same typeface the PDF and .docx embed, served by the app (and loaded
// from disk when measuring), so the preview wraps where the exports do.
const fontFaceCss = (base) =>
  base
    ? `@font-face { font-family: "${FONT.family}"; font-weight: 400; src: url("${base}/${FONT.files.regular}") format("truetype"); }
      @font-face { font-family: "${FONT.family}"; font-weight: 700; src: url("${base}/${FONT.files.bold}") format("truetype"); }`
    : "";

// Measuring only: once fonts are in, size the print page to the content
// so the PDF's MediaBox reports the exact content height, not just a
// page count. See server/render/measure.js.
const MEASURE_SCRIPT = `<script>
  document.fonts.ready.then(function () {
    var h = document.querySelector(".page").getBoundingClientRect().height;
    var s = document.createElement("style");
    s.textContent = "@page { size: ${PAGE.widthIn}in " + (h / 96 + ${PAGE.marginIn * 2} + 0.05) + "in; margin: ${PAGE.marginIn}in; }";
    document.head.appendChild(s);
  });
</script>`;

/**
 * @param {object} resume - applyReview() output
 * @param {{step?: number, fontBaseUrl?: string, measure?: boolean}} [opts]
 *   step: layout step from content_json.layout.step; fontBaseUrl: where
 *   the typeface's .ttf files are served from; measure: size the page to the content.
 */
export function renderResumeHtml(resume, { step = 0, fontBaseUrl = "", measure = false } = {}) {
  const L = layoutStep(step);
  const h = resume?.header || {};
  const summary = resume?.professional_summary || "";
  const skillGroups = Array.isArray(resume?.skill_groups) ? resume.skill_groups : [];
  const certs = Array.isArray(resume?.certifications) ? resume.certifications : [];
  const edu = Array.isArray(resume?.education) ? resume.education : [];
  const exp = Array.isArray(resume?.experience) ? resume.experience : [];
  const marks = resume?.marks || {};

  // The visible text is the URL, not a label: a parser extracting this PDF
  // sees the characters on the page, never the href, so "LinkedIn" would
  // lose the address entirely. The scheme and any trailing slash are
  // stripped so it stays readable for a human too.
  const link = (_label, url) => {
    const href = normalizeUrl(url);
    if (!href) return "";
    const shown = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(shown)}</a>`;
  };

  const sep = `<span class="sep">|</span>`;
  const contactBits = [h.phone, h.email, h.location].filter(Boolean).map(escapeHtml);
  const links = [link("LinkedIn", h.linkedin), link("GitHub", h.github), link("Portfolio", h.portfolio)].filter(Boolean);

  // One group per line, "Title: items", exactly as the .docx lays it out.
  const skillsHtml = skillGroups
    .filter((g) => Array.isArray(g?.items) && g.items.length)
    .map((g) => `<p class="para"><b>${escapeHtml(g.title || "")}:</b> ${markTerms(escapeHtml(g.items.join(", ")), marks.skills)}</p>`)
    .join("\n");

  const section = (title, body) => `<div class="section-title">${title}</div>\n${body}`;
  const list = (items) => `<ul class="bullets">${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;

  const expHtml = exp
    .map((r) => {
      const bullets = Array.isArray(r?.bullets) ? r.bullets : [];
      const right = [r?.location, r?.dates].filter(Boolean).map(escapeHtml).join(" | ");
      return `
        <div class="role-line"><span><b class="role-company">${escapeHtml(r?.company || "")}</b>${r?.title ? ` — ${escapeHtml(r.title)}` : ""}${r?.engagement_label ? ` (${escapeHtml(r.engagement_label)})` : ""}</span><span class="right">${right}</span></div>
        <ul class="bullets">
          ${bullets.map(bulletHtml).join("\n")}
        </ul>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(h.name || "Resume")}</title>
    <style>
      ${fontFaceCss(fontBaseUrl)}
      @page { size: letter; margin: ${PAGE.marginIn}in; }
      body { margin: 0; background: #fff; color: #000; font-family: "${FONT.family}", ${FONT.fallback}; font-size: ${L.body}pt; line-height: ${LINE_HEIGHT_RATIO}; }
      .page { width: ${PAGE.widthIn - PAGE.marginIn * 2}in; margin: 0 auto; padding: ${measure ? 0 : PAGE.marginIn}in; }
      p, ul, li, div { margin: 0; }
      .center { text-align: center; }
      .name { font-size: ${L.name}pt; font-weight: 700; }
      .target-title { font-size: ${L.title}pt; color: #333; padding: ${L.headerGap}pt 0; }
      .contact { font-size: ${L.contact}pt; padding-bottom: ${L.headerGap}pt; }
      .links { font-size: ${L.contact}pt; padding-bottom: ${L.headerAfter}pt; }
      .links a { color: #1155cc; }
      .sep { padding: 0 0.6em; }
      .section-title { font-size: ${L.heading}pt; font-weight: 700; text-transform: uppercase; padding-top: ${L.headingBefore}pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #999; margin-bottom: ${L.headingAfter}pt; }
      .para { padding-bottom: ${L.paraAfter}pt; }
      .role-line { display: flex; justify-content: space-between; gap: 12pt; align-items: baseline; padding-top: ${L.roleBefore}pt; }
      .role-line .right { color: #444; white-space: nowrap; font-size: ${L.side}pt; }
      .role-company { font-size: ${L.company}pt; }
      .bullets { padding-left: ${L.bulletIndentPt}pt; list-style: disc; }
      .bullets li { padding-bottom: ${L.bulletAfter}pt; }
      .bullets li.inferred { background: #fef9c3; }
      .bullets li.composed { background: #dbeafe; }
      .bullets li.rejected { text-decoration: line-through; color: #94a3b8; }
      .bullets li.fallback { background: #f1f5f9; }
      .pending-term.inferred { background: #fef9c3; }
      .pending-term.rejected { text-decoration: line-through; color: #94a3b8; }

      @media print {
        .page { padding: 0; }
        .section-title { break-after: avoid; }
        li { break-inside: avoid; }
        .bullets li.inferred, .bullets li.composed, .bullets li.fallback, .pending-term.inferred { background: none; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="name center">${escapeHtml(h.name || "")}</div>
      ${resume?.target_title ? `<div class="target-title center">${escapeHtml(resume.target_title)}</div>` : ""}
      ${contactBits.length ? `<div class="contact center"${links.length ? "" : ` style="padding-bottom:${L.headerAfter}pt"`}>${contactBits.join(sep)}</div>` : ""}
      ${links.length ? `<div class="links center">${links.join(sep)}</div>` : ""}

      ${summary ? section("Professional Summary", `<p class="para">${markTerms(escapeHtml(summary), marks.summary)}</p>`) : ""}
      ${skillsHtml ? section("Skills", skillsHtml) : ""}
      ${certs.length ? section("Certifications", list(certs)) : ""}
      ${exp.length ? section("Professional Experience", expHtml) : ""}
      ${edu.length ? section("Education", list(edu)) : ""}
    </div>
    ${measure ? MEASURE_SCRIPT : ""}
  </body>
</html>`;
}
