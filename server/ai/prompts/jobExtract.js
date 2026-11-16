function escapeTag(text, tag) {
  return String(text || "").replaceAll(`</${tag}>`, `<​/${tag}>`);
}

const MAX_CHARS = 60_000;

export function jobExtractPrompt({ url, pageText }) {
  const truncated = pageText.length > MAX_CHARS;
  const text = truncated ? pageText.slice(0, MAX_CHARS) : pageText;
  return `Extract the job posting from this page text (fetched from ${url}).

<page_text>
${escapeTag(text, "page_text")}
</page_text>
${truncated ? `\n(Note: the page text was truncated to ${MAX_CHARS} characters before reaching you; work with what's shown.)\n` : ""}

Rules:
- description_markdown must contain the FULL posting text (responsibilities, requirements, benefits) reformatted as clean markdown with headings — not a summary. Drop navigation, cookie banners, "similar jobs", and site chrome.
- If this page is not actually a job posting, set is_job_posting to false and put a one-line explanation in "title" (leave the other fields as reasonable empty-ish placeholders).
- posted_at: an ISO date only if one is visibly stated on the page; otherwise null.`;
}
