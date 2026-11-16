import { stripHtml } from "../html.js";

export const name = "remoteok";

export function enabled(cfg) {
  return cfg?.remoteok?.enabled !== false;
}

const UA = "Mozilla/5.0 (compatible; job-app-assistant/1.0; personal use)";

export async function fetch_(cfg) {
  const tags = new Set((cfg?.remoteok?.tags || []).map((t) => t.toLowerCase()));
  const res = await fetch("https://remoteok.com/api", {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`remoteok: HTTP ${res.status}`);
  const data = await res.json();
  // First element is a legal/attribution notice, not a job — see
  // https://remoteok.com/api "API Terms of Service".
  const jobs = Array.isArray(data) ? data.slice(1) : [];

  return jobs
    .filter((j) => tags.size === 0 || (j.tags || []).some((t) => tags.has(String(t).toLowerCase())))
    .map((j) => ({
      source: "remoteok",
      source_id: String(j.id),
      url: j.url,
      apply_url: j.apply_url || j.url,
      title: j.position,
      company: j.company || "Unknown",
      location_raw: j.location || null,
      work_mode: "remote",
      description_html: j.description,
      description_text: stripHtml(j.description),
      posted_at: j.date || null,
      salary_min: j.salary_min ?? null,
      salary_max: j.salary_max ?? null,
      tags: j.tags || [],
    }));
}

// RemoteOK's API terms require linking back and crediting them as the
// source when their data is displayed — surfaced in the Activity view
// whenever this adapter is enabled.
export const ATTRIBUTION = "Remote jobs via RemoteOK (remoteok.com)";
