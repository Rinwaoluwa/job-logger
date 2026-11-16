export async function fetchAshbyBoard({ slug }) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ashby ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    source: "ashby",
    source_id: j.id,
    url: j.jobUrl,
    apply_url: j.applyUrl || j.jobUrl,
    title: j.title,
    company: slug,
    location_raw: j.location || null,
    work_mode: j.isRemote ? "remote" : "unknown",
    description_html: j.descriptionHtml,
    description_text: j.descriptionPlain || undefined,
    posted_at: j.publishedAt || null,
    salary_text: j.compensation?.compensationTierSummary || null,
    raw: { department: j.department, team: j.team },
  }));
}

export const name = "ashby";
export function enabled(cfg) {
  return Array.isArray(cfg?.boards?.ashby) && cfg.boards.ashby.length > 0;
}
export async function fetch_(cfg) {
  const results = [];
  for (const slug of cfg.boards.ashby) {
    try {
      results.push(...(await fetchAshbyBoard({ slug })));
    } catch (e) {
      console.warn(`[sources:ashby] ${slug} failed: ${e.message}`);
    }
  }
  return results;
}
