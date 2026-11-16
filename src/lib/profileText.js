// A small reader for the free text in profile/*.md. The files are
// hand-written markdown-ish prose: paragraphs separated by blank lines,
// hand-wrapped at ~75 columns, with the occasional "- item" list or a
// "(1) … (2) …" enumeration, **bold**, `code`, ids such as brightpay-s7 that
// refer to other entries, and editorial asides like "(confirmed
// 2026-10-11)" or "[AI-DRAFTED — confirm before using in an interview]".
// Nothing here is HTML; the output is a block/token tree that RichText
// turns into elements, so no markdown dependency and no innerHTML.

const COMMENT_RE = /<!--[\s\S]*?-->/g;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*(\(\d+\)|\d+[.)])\s+(.*)$/;

/**
 * @returns {Array<{type:"p", text:string} | {type:"ul"|"ol", items:Array<{marker:string, text:string}>}>}
 */
export function parseBlocks(text) {
  const src = String(text || "").replace(COMMENT_RE, "").replace(/\r\n/g, "\n");
  const blocks = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const ul = line.match(UL_RE);
    const ol = ul ? null : line.match(OL_RE);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push({ marker: ol ? ol[1] : "", text: (ul ? ul[1] : ol[2]).trim() });
      continue;
    }
    if (list) {
      // A wrapped line under a list item continues that item (markdown's
      // lazy continuation); the files wrap both indented and not.
      list.items[list.items.length - 1].text += " " + line.trim();
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

// Inline tokens, matched left to right. Order matters only for overlaps:
// a bold run is read before anything inside it.
const NOTE_WORDS = "confirmed|corrected|decided|deleted|removed|your pick|your words|your answer|verified|checked";
const INLINE_RE = new RegExp(
  [
    "(\\*\\*[^*\\n]+\\*\\*)",
    "(`[^`\\n]+`)",
    "(\\[AI-DRAFTED[^\\]]*\\])",
    `(\\((?:[^()\\n]*\\d{4}-\\d{2}-\\d{2}[^()\\n]*|(?:${NOTE_WORDS})\\b[^()\\n]*)\\))`,
    "(\\b(?:[a-z]+-[sm]\\d+|proj-[a-z0-9]+(?:-[a-z0-9]+)*)\\b)",
  ].join("|"),
  "gi",
);

/**
 * @returns {Array<{type:"text"|"bold"|"code"|"draft"|"note"|"id", text:string}>}
 */
export function parseInline(text) {
  const src = String(text || "");
  const tokens = [];
  let last = 0;
  for (const m of src.matchAll(INLINE_RE)) {
    if (m.index > last) tokens.push({ type: "text", text: src.slice(last, m.index) });
    if (m[1]) tokens.push({ type: "bold", text: m[1].slice(2, -2) });
    else if (m[2]) tokens.push({ type: "code", text: m[2].slice(1, -1) });
    else if (m[3]) tokens.push({ type: "draft", text: m[3] });
    else if (m[4]) tokens.push({ type: "note", text: m[4] });
    else if (m[5]) tokens.push({ type: "id", text: m[5].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ type: "text", text: src.slice(last) });
  return tokens;
}

/** The text with the editorial asides removed — for search and previews. */
export function plainText(text) {
  return parseBlocks(text)
    .flatMap((b) => (b.type === "p" ? [b.text] : b.items.map((i) => i.text)))
    .join(" ")
    .replace(/\[AI-DRAFTED[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
