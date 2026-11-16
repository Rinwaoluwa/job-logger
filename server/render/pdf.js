// PDF export — the default download, for résumés and cover letters.
//
// Written with pdfkit rather than printed from headless Chrome. Chrome's
// PDF positions every glyph on its own, so the file has no word-level text
// and parsers have to guess where words end (Apple's extractor once read
// the name as "MORGAN ALEX JOR / DAN"). pdfkit writes each line as a
// real string with real space glyphs and a ToUnicode map, so an ATS
// extracts exactly what is on the page, the same as from the .docx.
//
// The résumé mirrors server/render/docx.js and shared/resumeTemplate.js
// paragraph for paragraph, from the one spec in shared/resumeLayout.js:
// same typeface (embedded), sizes, line height, spacing and margins. That
// is what lets the page measurement taken in Chrome hold for this file.
// Keep the three in step: a paragraph added here needs its twins there.

import PDFDocument from "pdfkit";
import { applyReview } from "../../shared/applyReview.js";
import { PAGE, LETTER, LINE_HEIGHT_RATIO, layoutStep, stepOf } from "../../shared/resumeLayout.js";
import { fontPath } from "./fonts.js";

const PT = 72; // points per inch
const clean = (v) => (v ?? "").toString().trim();
const BLACK = "#000000";

/** Thin layer over pdfkit: one page geometry, two fonts, explicit line height. */
class Writer {
  constructor({ marginIn, title, author, subject }) {
    this.M = marginIn * PT;
    this.W = PAGE.widthIn * PT - 2 * this.M;
    this.bottom = PAGE.heightIn * PT - this.M;
    this.doc = new PDFDocument({
      size: [PAGE.widthIn * PT, PAGE.heightIn * PT],
      margins: { top: this.M, bottom: this.M, left: this.M, right: this.M },
      info: { Title: title, Author: author, Subject: subject, Creator: "Job application assistant" },
      displayTitle: true,
      lang: "en",
    });
    this.doc.registerFont("regular", fontPath("regular"));
    this.doc.registerFont("bold", fontPath("bold"));
  }

  /** Line advance for a size: the shared ratio, not the font's own leading. */
  lineHeight(size) {
    return size * LINE_HEIGHT_RATIO;
  }

  /**
   * Select font, size and colour; returns the lineGap that makes pdfkit's
   * advance (the font's natural height plus lineGap) equal lineHeight(size).
   */
  set(font, size, color = BLACK) {
    this.doc.font(font).fontSize(size).fillColor(color);
    return this.lineHeight(size) - this.doc.currentLineHeight(true);
  }

  /** pdfkit has no keep-with-next, so headings and bullets check first. */
  ensureRoom(pt) {
    if (this.doc.y + pt > this.bottom) this.doc.addPage();
  }

  para(text, { font = "regular", size, color = BLACK, align = "left", before = 0, after = 0, x = this.M, width = this.W, ...rest } = {}) {
    const t = clean(text);
    if (!t) return;
    const lineGap = this.set(font, size, color);
    this.ensureRoom(before + this.lineHeight(size));
    this.doc.y += before;
    this.doc.text(t, x, this.doc.y, { width, align, lineGap, ...rest });
    this.doc.y += after;
  }

  /** Uppercase heading with the same 0.75pt rule 2pt below it as the other renderers. */
  heading(text, L) {
    this.ensureRoom(L.headingBefore + this.lineHeight(L.heading) + 2.75 + L.headingAfter + this.lineHeight(L.body));
    this.para(text.toUpperCase(), { font: "bold", size: L.heading, before: L.headingBefore });
    const y = this.doc.y + 2;
    this.doc.moveTo(this.M, y).lineTo(this.M + this.W, y).lineWidth(0.75).strokeColor("#999999").stroke();
    this.doc.y = y + 0.75 + L.headingAfter;
  }

  /** "•" at the margin, text hanging at bulletIndentPt, like the .docx numbering level. */
  bullet(text, L) {
    const t = clean(text);
    if (!t) return;
    const lineGap = this.set("regular", L.body);
    this.ensureRoom(this.lineHeight(L.body));
    const y = this.doc.y;
    this.doc.text("•", this.M, y, { lineBreak: false });
    this.doc.text(t, this.M + L.bulletIndentPt, y, { width: this.W - L.bulletIndentPt, lineGap });
    this.doc.y += L.bulletAfter;
  }

  /** "Title: " in bold, then the items, wrapping as one paragraph. */
  labelled(label, text, L) {
    const lineGap = this.set("bold", L.body);
    this.ensureRoom(this.lineHeight(L.body));
    this.doc.text(`${clean(label)}: `, this.M, this.doc.y, { width: this.W, lineGap, continued: true });
    this.set("regular", L.body);
    this.doc.text(clean(text), { width: this.W, lineGap });
    this.doc.y += L.paraAfter;
  }

  /** "Company — Title" on the left, "Location | Dates" hard-right, one baseline. */
  roleLine(role, L) {
    const doc = this.doc;
    const company = clean(role.company);
    const label = clean(role.engagement_label) ? ` (${clean(role.engagement_label)})` : "";
    const title = (clean(role.title) ? ` — ${clean(role.title)}` : "") + label;
    const right = [role.location, role.dates].map(clean).filter(Boolean).join(" | ");
    const GAP = 12;

    this.ensureRoom(L.roleBefore + this.lineHeight(L.company) + this.lineHeight(L.body));
    const top = doc.y + L.roleBefore;

    this.set("regular", L.side, "#444444");
    const rw = right ? doc.widthOfString(right) : 0;
    this.set("bold", L.company);
    const cw = doc.widthOfString(company);
    // Runs differ in size, so place each on a shared alphabetic baseline
    // (the one the largest run, the company, would sit on) instead of by
    // line top.
    const baseline = top + (doc._font.ascender / 1000) * L.company;
    const run = (text, x) => doc.text(text, x, baseline, { lineBreak: false, baseline: "alphabetic" });
    this.set("regular", L.body);
    const tw = title ? doc.widthOfString(title) : 0;

    // Left side first, so the content stream reads "Company — Title
    // Location | Dates" for a parser that takes text in drawing order.
    if (cw + tw + (right ? GAP + rw : 0) <= this.W) {
      this.set("bold", L.company);
      run(company, this.M);
      if (title) {
        this.set("regular", L.body);
        run(title, this.M + cw);
      }
      doc.y = top + this.lineHeight(L.company);
    } else {
      // Too long for one line: the left side wraps in the room beside the dates.
      const lineGap = this.set("bold", L.company);
      doc.text(company, this.M, top, { width: this.W - (right ? rw + GAP : 0), lineGap, continued: !!title });
      if (title) {
        this.set("regular", L.body);
        doc.text(title, { lineGap });
      }
    }
    if (right) {
      const endY = doc.y;
      this.set("regular", L.side, "#444444");
      run(right, this.M + this.W - rw);
      doc.y = endY;
    }
  }

  /** Centred row of clickable URLs; the visible text is the address itself. */
  links(urls, L, after) {
    const doc = this.doc;
    const segs = [];
    urls.forEach((url, i) => {
      const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const shown = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (i > 0) segs.push({ text: "  |  " });
      segs.push({ text: shown, href });
    });
    this.set("regular", L.contact);
    const widths = segs.map((s) => doc.widthOfString(s.text));
    const total = widths.reduce((a, b) => a + b, 0);
    this.ensureRoom(this.lineHeight(L.contact));

    if (total <= this.W) {
      const y = doc.y;
      let x = this.M + (this.W - total) / 2;
      segs.forEach((s, i) => {
        doc.fillColor(s.href ? "#1155cc" : BLACK).text(s.text, x, y, { lineBreak: false, link: s.href, underline: !!s.href });
        x += widths[i];
      });
      doc.y = y + this.lineHeight(L.contact) + after;
    } else {
      for (const s of segs) {
        if (s.href) this.para(s.text, { size: L.contact, color: "#1155cc", align: "center", link: s.href, underline: true });
      }
      doc.y += after;
    }
  }

  /** @returns {Promise<Buffer>} */
  finish() {
    return new Promise((resolve, reject) => {
      const chunks = [];
      this.doc.on("data", (c) => chunks.push(c));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
      this.doc.end();
    });
  }
}

/**
 * @param {object} document - a résumé document row (content_json + review_decisions)
 * @returns {Promise<Buffer>} the PDF
 */
export async function resumePdf(document) {
  const resume = applyReview(document.content_json, document.review_decisions || {}, { mode: "export" });
  const L = layoutStep(stepOf(document.content_json));
  const h = resume.header || {};
  const w = new Writer({
    marginIn: PAGE.marginIn,
    title: [clean(h.name), clean(resume.target_title)].filter(Boolean).join(" — ") || "Resume",
    author: clean(h.name) || "Resume",
    subject: clean(document.title),
  });

  w.para(h.name, { font: "bold", size: L.name, align: "center" });
  if (clean(resume.target_title)) {
    w.para(resume.target_title, { size: L.title, color: "#333333", align: "center", before: L.headerGap, after: L.headerGap });
  }

  const bits = [h.phone, h.email, h.location].map(clean).filter(Boolean);
  const urls = [h.linkedin, h.github, h.portfolio].map(clean).filter(Boolean);
  if (bits.length) w.para(bits.join("  |  "), { size: L.contact, align: "center", after: urls.length ? L.headerGap : L.headerAfter });
  if (urls.length) w.links(urls, L, L.headerAfter);

  if (clean(resume.professional_summary)) {
    w.heading("Professional Summary", L);
    w.para(resume.professional_summary, { size: L.body, after: L.paraAfter });
  }

  const groups = (resume.skill_groups || []).filter((g) => (g.items || []).length);
  if (groups.length) {
    w.heading("Skills", L);
    for (const g of groups) w.labelled(g.title, (g.items || []).map(clean).filter(Boolean).join(", "), L);
  }

  if ((resume.certifications || []).length) {
    w.heading("Certifications", L);
    for (const c of resume.certifications) w.bullet(c, L);
  }

  const roles = resume.experience || [];
  if (roles.length) {
    w.heading("Professional Experience", L);
    for (const role of roles) {
      w.roleLine(role, L);
      for (const bullet of role.bullets || []) w.bullet(typeof bullet === "string" ? bullet : bullet?.text, L);
    }
  }

  if ((resume.education || []).length) {
    w.heading("Education", L);
    for (const e of resume.education) w.bullet(e, L);
  }

  return w.finish();
}

/**
 * @param {object} document - a cover_letter document row; content_json.paragraphs
 *   already open with the greeting, so nothing is added around them.
 * @param {{name?: string, phone?: string, email?: string, location?: string}} header
 *   the candidate's contact block, from the profile
 * @returns {Promise<Buffer>} the PDF
 */
export async function coverLetterPdf(document, header = {}) {
  const name = clean(header.name);
  const w = new Writer({
    marginIn: LETTER.marginIn,
    title: [name, "Cover letter"].filter(Boolean).join(" — "),
    author: name || "Cover letter",
    subject: clean(document.title),
  });

  if (name) w.para(name, { font: "bold", size: LETTER.name });
  const contact = [header.phone, header.email, header.location].map(clean).filter(Boolean).join("  |  ");
  if (contact) w.para(contact, { size: LETTER.contact, color: "#444444" });
  w.doc.y += LETTER.headerAfter;

  for (const p of document.content_json?.paragraphs || []) w.para(p, { size: LETTER.body, after: LETTER.paraAfter });

  return w.finish();
}
