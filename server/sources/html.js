// Minimal HTML-to-text stripping with paragraph/list boundary preservation,
// no dependency needed for this (jsdom + Readability handle the harder
// case of a full scraped page in extract.js — this is for adapter
// payloads that are already just a job's own HTML description field).

const BLOCK_TAGS = /<\/(p|div|li|br|h[1-6]|tr)>/gi;
const LIST_ITEM = /<li[^>]*>/gi;

export function stripHtml(html) {
  if (!html) return "";
  let text = String(html);
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(LIST_ITEM, "\n- ");
  text = text.replace(BLOCK_TAGS, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

/**
 * Light markdown-to-text for job descriptions that arrive as markdown
 * (Jack & Jill exports): headings, emphasis, links and rules go, list
 * bullets and paragraph breaks stay, so the drawer's pre-wrap view reads
 * as prose instead of showing "## " and "**".
 */
export function stripMarkdown(md) {
  if (!md) return "";
  let text = String(md).replace(/\r\n/g, "\n");
  text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""));
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  text = text.replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "");
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2");
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1");
  text = text.replace(/^[ \t]*[*+][ \t]+/gm, "- ");
  text = text.replace(/[ \t]+$/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
