import { stripHtml } from "../html.js";

export const name = "jobicy";

export function enabled(cfg) {
  return cfg?.jobicy?.enabled !== false;
}

async function searchOnce({ geo, tag }) {
  const url = new URL("https://jobicy.com/api/v2/remote-jobs");
  url.searchParams.set("count", "50");
  url.searchParams.set("geo", geo);
  if (tag) url.searchParams.set("tag", tag);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`jobicy geo=${geo} tag=${tag}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    source: "jobicy",
    source_id: String(j.id),
    url: j.url,
    apply_url: j.url,
    title: j.jobTitle,
    company: j.companyName || "Unknown",
    remote_scope: j.jobGeo || null,
    work_mode: "remote",
    description_html: j.jobDescription,
    description_text: stripHtml(j.jobDescription),
    posted_at: j.pubDate || null,
    salary_min: j.annualSalaryMin ?? null,
    salary_max: j.annualSalaryMax ?? null,
  }));
}

export async function fetch_(cfg) {
  const settings = cfg.jobicy || {};
  const geos = settings.geos || ["canada", "usa"];
  const tags = settings.tags || ["developer"];
  const results = [];
  for (const geo of geos) {
    for (const tag of tags) {
      try {
        results.push(...(await searchOnce({ geo, tag })));
      } catch (e) {
        console.warn(`[sources:jobicy] ${e.message}`);
      }
    }
  }
  return results;
}
