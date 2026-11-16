import { stripHtml } from "../html.js";

export const name = "muse";

export function enabled(cfg) {
  return cfg?.muse?.enabled !== false;
}

async function searchOnce({ location, page }) {
  const url = new URL("https://www.themuse.com/api/public/jobs");
  url.searchParams.set("category", "Software Engineering");
  if (location) url.searchParams.set("location", location);
  url.searchParams.set("page", String(page));

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`muse "${location}" page ${page}: HTTP ${res.status}`);
  const data = await res.json();
  return {
    jobs: (data.results || []).map((r) => ({
      source: "muse",
      source_id: String(r.id),
      url: r.refs?.landing_page,
      apply_url: r.refs?.landing_page,
      title: r.name,
      company: r.company?.name || "Unknown",
      location_raw: (r.locations || []).map((l) => l.name).join("; ") || null,
      description_html: r.contents,
      description_text: stripHtml(r.contents),
      posted_at: r.publication_date || null,
      raw: { levels: r.levels?.map((l) => l.name) },
    })),
    pageCount: data.page_count || 1,
  };
}

export async function fetch_(cfg) {
  const settings = cfg.muse || {};
  const locations = settings.locations || ["Vancouver, Canada", "Flexible / Remote"];
  const maxPages = settings.pages ?? 3;

  const results = [];
  for (const location of locations) {
    for (let page = 1; page <= maxPages; page++) {
      try {
        const { jobs, pageCount } = await searchOnce({ location, page });
        results.push(...jobs);
        if (page >= pageCount) break;
      } catch (e) {
        console.warn(`[sources:muse] ${e.message}`);
        break;
      }
    }
  }
  return results;
}
