import { stripHtml } from "../html.js";
import { getSetting, setSetting } from "../../db/repo/settings.js";

export const name = "remotive";

export function enabled(cfg) {
  return cfg?.remotive?.enabled !== false;
}

const LOCATION_ALLOW = /canada|usa|united states|americas|worldwide|anywhere/i;

export async function fetch_(cfg) {
  const settings = cfg.remotive || {};
  const minIntervalHours = settings.min_interval_hours ?? 6;
  const lastFetch = getSetting("remotive_last_fetch_at");
  if (lastFetch && Date.now() - new Date(lastFetch).getTime() < minIntervalHours * 3600_000) {
    console.log(`[sources:remotive] skipped — fetched within the last ${minIntervalHours}h`);
    return [];
  }

  const url = new URL("https://remotive.com/api/remote-jobs");
  url.searchParams.set("category", settings.category || "software-dev");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`remotive: HTTP ${res.status}`);
  const data = await res.json();
  setSetting("remotive_last_fetch_at", new Date().toISOString());

  return (data.jobs || [])
    .filter((j) => LOCATION_ALLOW.test(j.candidate_required_location || ""))
    .map((j) => ({
      source: "remotive",
      source_id: String(j.id),
      url: j.url,
      apply_url: j.url,
      title: j.title,
      company: j.company_name || "Unknown",
      remote_scope: j.candidate_required_location || null,
      work_mode: "remote",
      description_html: j.description,
      description_text: stripHtml(j.description),
      posted_at: j.publication_date || null,
      salary_text: j.salary || null,
      tags: j.tags || [],
    }));
}
