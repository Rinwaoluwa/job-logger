import { stripHtml } from "../html.js";

// Greenhouse's `content` field comes back HTML-escaped-as-text (e.g.
// "&lt;h2&gt;Who we are&lt;/h2&gt;" rather than "<h2>Who we are</h2>"),
// so tag-stripping regexes never match until entities are decoded first.
function unescapeEntities(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export async function fetchGreenhouseBoard({ slug }) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`greenhouse ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    source: "greenhouse",
    source_id: String(j.id),
    url: j.absolute_url,
    apply_url: j.absolute_url,
    title: j.title,
    company: slug,
    location_raw: j.location?.name || null,
    description_html: unescapeEntities(j.content),
    description_text: stripHtml(unescapeEntities(j.content)),
    posted_at: j.first_published || j.updated_at || null,
    raw: { departments: j.departments?.map((d) => d.name) },
  }));
}

export const name = "greenhouse";
export function enabled(cfg) {
  return Array.isArray(cfg?.boards?.greenhouse) && cfg.boards.greenhouse.length > 0;
}
export async function fetch_(cfg) {
  const slugs = cfg.boards.greenhouse;
  const results = [];
  for (const slug of slugs) {
    try {
      results.push(...(await fetchGreenhouseBoard({ slug })));
    } catch (e) {
      console.warn(`[sources:greenhouse] ${slug} failed: ${e.message}`);
    }
  }
  return results;
}
