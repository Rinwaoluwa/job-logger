import { stripHtml } from "../html.js";
import { config } from "../../config.js";

export const name = "adzuna";

export function enabled(cfg) {
  if (cfg?.adzuna?.enabled === false) return false;
  return !!(config.adzuna.appId && config.adzuna.appKey);
}

async function searchOnce({ country, what, where, page, maxDaysOld, resultsPerPage }) {
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
  url.searchParams.set("app_id", config.adzuna.appId);
  url.searchParams.set("app_key", config.adzuna.appKey);
  url.searchParams.set("what", what);
  if (where) url.searchParams.set("where", where);
  url.searchParams.set("max_days_old", String(maxDaysOld));
  url.searchParams.set("results_per_page", String(resultsPerPage));
  url.searchParams.set("content-type", "application/json");

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`adzuna ${country} "${what}": HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    source: "adzuna",
    source_id: String(r.id),
    url: r.redirect_url,
    apply_url: r.redirect_url,
    title: r.title,
    company: r.company?.display_name || "Unknown",
    location_raw: r.location?.display_name || null,
    country: country.toUpperCase(),
    salary_min: r.salary_min ?? null,
    salary_max: r.salary_max ?? null,
    currency: country === "ca" ? "CAD" : "USD",
    description_text: stripHtml(r.description),
    description_truncated: true, // Adzuna only returns a snippet
    posted_at: r.created || null,
    raw: { category: r.category?.label },
  }));
}

export async function fetch_(cfg) {
  if (!enabled()) {
    console.warn("[sources:adzuna] ADZUNA_APP_ID/ADZUNA_APP_KEY not set — skipping");
    return [];
  }
  const settings = cfg.adzuna || {};
  const pages = settings.pages ?? 2;
  const maxDaysOld = settings.max_days_old ?? 14;
  const resultsPerPage = settings.results_per_page ?? 50;

  const results = [];
  for (const target of cfg.targets || []) {
    const country = target.country;
    for (const title of cfg.queries?.titles || []) {
      const what = target.remote ? `${title} remote` : title;
      for (let page = 1; page <= pages; page++) {
        try {
          const batch = await searchOnce({ country, what, where: target.remote ? undefined : target.where, page, maxDaysOld, resultsPerPage });
          results.push(...batch);
          if (batch.length < resultsPerPage) break; // no more pages
        } catch (e) {
          console.warn(`[sources:adzuna] ${e.message}`);
          break;
        }
      }
    }
  }
  return results;
}
