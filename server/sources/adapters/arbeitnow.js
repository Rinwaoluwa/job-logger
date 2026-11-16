import { stripHtml } from "../html.js";

export const name = "arbeitnow";

// EU-heavy board; disabled by default per config/sources.json — kept for
// completeness since it's a free, no-key, full-description source.
export function enabled(cfg) {
  return cfg?.arbeitnow?.enabled === true;
}

const LOCATION_ALLOW = /canada|usa|united states|worldwide|anywhere/i;

export async function fetch_(cfg) {
  const maxPages = cfg?.arbeitnow?.pages ?? 2;
  const results = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL("https://www.arbeitnow.com/api/job-board-api");
    url.searchParams.set("page", String(page));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const jobs = (data.data || []).filter(
        (j) => j.remote === true && LOCATION_ALLOW.test(j.location || ""),
      );
      results.push(
        ...jobs.map((j) => ({
          source: "arbeitnow",
          source_id: j.slug,
          url: j.url,
          apply_url: j.url,
          title: j.title,
          company: j.company_name || "Unknown",
          location_raw: j.location || null,
          work_mode: "remote",
          description_html: j.description,
          description_text: stripHtml(j.description),
          posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
          tags: j.tags || [],
        })),
      );
      if (!data.data || data.data.length === 0) break;
    } catch (e) {
      console.warn(`[sources:arbeitnow] page ${page} failed: ${e.message}`);
      break;
    }
  }
  return results;
}
