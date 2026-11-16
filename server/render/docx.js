// Word (.docx) export — the fallback behind "More" for portals that ask
// for Word, and the belt-and-braces format for an ATS: a .docx carries its
// text as actual strings in XML, so extraction is exact. The default
// download is the PDF (server/render/pdf.js), written with pdfkit so it
// has the same word-level text; the Chrome-printed PDF it replaced did
// not, which is why it was dropped.
//
// Layout is deliberately plain — one column, no tables, no text boxes, no
// headers or footers, standard section headings. Everything a résumé
// parser is known to trip over is left out.
//
// Sizes, spacing and the typeface come from shared/resumeLayout.js, the
// same spec the PDF and the HTML template render from, so the page
// measurement the tailor pipeline takes in Chrome holds for this file
// too. The regular face is embedded so Word shows the same type where the
// font is not installed (bold is synthesised there). Keep the renderers
// in step: a paragraph added here needs its twins in pdf.js and
// shared/resumeTemplate.js.

import {
  Document, Packer, Paragraph, TextRun, TabStopType, AlignmentType, HeadingLevel, ExternalHyperlink, LevelFormat,
} from "docx";
import { applyReview } from "../../shared/applyReview.js";
import { PAGE, LETTER, FONT, LINE_HEIGHT_RATIO, layoutStep, stepOf } from "../../shared/resumeLayout.js";
import { fontData } from "./fonts.js";

const FAMILY = FONT.family;
const CONTENT_WIDTH = (PAGE.widthIn - PAGE.marginIn * 2) * 1440; // twips
const BULLETS = "resume-bullets";

const clean = (v) => (v ?? "").toString().trim();
const hp = (pt) => Math.round(pt * 2); // half-points, for font sizes
const tw = (pt) => Math.round(pt * 20); // twips, for spacing

// Line height is set "exactly" to the shared ratio of the paragraph's font
// size, matching the PDF's and the preview's advance, rather than left to
// Word's "single" (the font's own, taller, leading).
const spacing = (beforePt, afterPt, sizePt) => ({
  before: tw(beforePt), after: tw(afterPt), line: tw(sizePt * LINE_HEIGHT_RATIO), lineRule: "exact",
});

const pageProperties = (marginIn) => {
  const margin = marginIn * 1440;
  return {
    page: {
      size: { width: PAGE.widthIn * 1440, height: PAGE.heightIn * 1440 },
      margin: { top: margin, bottom: margin, left: margin, right: margin },
    },
  };
};

/** Document options shared by both exports: metadata, embedded font, default style. */
const baseDocOptions = ({ creator, title, bodyPt }) => ({
  creator,
  title,
  fonts: [{ name: FAMILY, data: fontData("regular") }],
  styles: {
    default: {
      document: {
        run: { font: FAMILY, size: hp(bodyPt) },
        paragraph: { spacing: spacing(0, 0, bodyPt) },
      },
    },
  },
});

/**
 * @param {object} document - a résumé document row (content_json + review_decisions)
 * @returns {Promise<Buffer>} the .docx file
 */
export async function resumeDocx(document) {
  const resume = applyReview(document.content_json, document.review_decisions || {}, { mode: "export" });
  const L = layoutStep(stepOf(document.content_json));
  const h = resume.header || {};
  const children = [];

  const run = (text, { size = L.body, ...rest } = {}) => new TextRun({ text: clean(text), size: hp(size), font: FAMILY, ...rest });

  /** "Company — Title" on the left, "Location | Dates" hard-right. */
  const roleLine = (role) =>
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
      spacing: spacing(L.roleBefore, 0, L.company),
      children: [
        run(role.company, { size: L.company, bold: true }),
        ...(clean(role.title) ? [run(` — ${clean(role.title)}`)] : []),
        ...(clean(role.engagement_label) ? [run(` (${clean(role.engagement_label)})`, { color: "444444" })] : []),
        new TextRun({
          text: `\t${[role.location, role.dates].map(clean).filter(Boolean).join(" | ")}`,
          size: hp(L.side),
          font: FAMILY,
          color: "444444",
        }),
      ],
    });

  const sectionHeading = (text) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: spacing(L.headingBefore, L.headingAfter, L.heading),
      border: { bottom: { color: "999999", size: 6, style: "single", space: 2 } },
      children: [run(text, { size: L.heading, bold: true, color: "000000", allCaps: true })],
    });

  const bodyParagraph = (runs) => new Paragraph({ spacing: spacing(0, L.paraAfter, L.body), children: runs });

  const bulletParagraph = (text) =>
    new Paragraph({
      numbering: { reference: BULLETS, level: 0 },
      spacing: spacing(0, L.bulletAfter, L.body),
      children: [run(text)],
    });

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: spacing(0, 0, L.name),
      children: [run(h.name, { size: L.name, bold: true })],
    }),
  );
  if (clean(resume.target_title)) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: spacing(L.headerGap, L.headerGap, L.title),
        children: [run(resume.target_title, { size: L.title, color: "333333" })],
      }),
    );
  }

  // Contact line: the URL text is the link text, so it survives extraction.
  const bits = [h.phone, h.email, h.location].map(clean).filter(Boolean);
  const urls = [h.linkedin, h.github, h.portfolio].map(clean).filter(Boolean);
  if (bits.length) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: spacing(0, urls.length ? L.headerGap : L.headerAfter, L.contact),
        children: [run(bits.join("  |  "), { size: L.contact })],
      }),
    );
  }
  if (urls.length) {
    const linkRuns = [];
    urls.forEach((url, i) => {
      const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const shown = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (i > 0) linkRuns.push(run("  |  ", { size: L.contact }));
      linkRuns.push(
        new ExternalHyperlink({
          link: href,
          children: [new TextRun({ text: shown, size: hp(L.contact), font: FAMILY, color: "1155CC", underline: {} })],
        }),
      );
    });
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: spacing(0, L.headerAfter, L.contact), children: linkRuns }));
  }

  if (clean(resume.professional_summary)) {
    children.push(sectionHeading("Professional Summary"));
    children.push(bodyParagraph([run(resume.professional_summary)]));
  }

  // One group per line rather than a two-column grid: columns are the
  // classic way to confuse a parser, and there is nothing to gain here.
  const groups = (resume.skill_groups || []).filter((g) => (g.items || []).length);
  if (groups.length) {
    children.push(sectionHeading("Skills"));
    for (const g of groups) {
      children.push(bodyParagraph([
        run(`${clean(g.title)}: `, { bold: true }),
        run((g.items || []).map(clean).filter(Boolean).join(", ")),
      ]));
    }
  }

  if ((resume.certifications || []).length) {
    children.push(sectionHeading("Certifications"));
    for (const c of resume.certifications) children.push(bulletParagraph(c));
  }

  // No stack line: the technologies are shown doing work in the bullets
  // and listed in Skills, and the line cost a row per role on a one-page
  // résumé.
  const roles = resume.experience || [];
  if (roles.length) {
    children.push(sectionHeading("Professional Experience"));
    for (const role of roles) {
      // Employer, title, location and dates on one line. They used to take
      // two lines so a parser could pick out each value on its own; on a
      // one-page résumé that second line cost five lines in all, and the
      // "Company — Title ... Location | Dates" shape parses fine.
      children.push(roleLine(role));
      for (const bullet of role.bullets || []) {
        const text = typeof bullet === "string" ? bullet : bullet?.text;
        if (clean(text)) children.push(bulletParagraph(text));
      }
    }
  }

  if ((resume.education || []).length) {
    children.push(sectionHeading("Education"));
    for (const e of resume.education) children.push(bulletParagraph(e));
  }

  const doc = new Document({
    ...baseDocOptions({
      creator: clean(h.name) || "Resume",
      title: [clean(h.name), clean(resume.target_title)].filter(Boolean).join(" — "),
      bodyPt: L.body,
    }),
    // A tight hanging indent instead of Word's default half inch, matching
    // the HTML template's list indent.
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: tw(L.bulletIndentPt), hanging: tw(L.bulletIndentPt) } },
                run: { font: FAMILY },
              },
            },
          ],
        },
      ],
    },
    sections: [{ properties: pageProperties(PAGE.marginIn), children }],
  });

  return Packer.toBuffer(doc);
}

/**
 * @param {object} document - a cover_letter document row; content_json.paragraphs
 *   already open with the greeting, so nothing is added around them.
 * @param {{name?: string, phone?: string, email?: string, location?: string}} header
 *   the candidate's contact block, from the profile
 * @returns {Promise<Buffer>} the .docx file
 */
export async function coverLetterDocx(document, header = {}) {
  const name = clean(header.name);
  const run = (text, { size = LETTER.body, ...rest } = {}) => new TextRun({ text: clean(text), size: hp(size), font: FAMILY, ...rest });
  const children = [];

  const contact = [header.phone, header.email, header.location].map(clean).filter(Boolean).join("  |  ");
  // The gap after the header belongs to whichever header line is last.
  const headerLines = [
    name && { size: LETTER.name, run: run(name, { size: LETTER.name, bold: true }) },
    contact && { size: LETTER.contact, run: run(contact, { size: LETTER.contact, color: "444444" }) },
  ].filter(Boolean);
  headerLines.forEach((line, i) => {
    const last = i === headerLines.length - 1;
    children.push(new Paragraph({ spacing: spacing(0, last ? LETTER.headerAfter : 0, line.size), children: [line.run] }));
  });

  for (const p of document.content_json?.paragraphs || []) {
    if (clean(p)) children.push(new Paragraph({ spacing: spacing(0, LETTER.paraAfter, LETTER.body), children: [run(p)] }));
  }

  const doc = new Document({
    ...baseDocOptions({ creator: name || "Cover letter", title: [name, "Cover letter"].filter(Boolean).join(" — "), bodyPt: LETTER.body }),
    sections: [{ properties: pageProperties(LETTER.marginIn), children }],
  });

  return Packer.toBuffer(doc);
}
