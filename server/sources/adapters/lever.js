export async function fetchLeverBoard({ slug }) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`lever ${slug}: HTTP ${res.status}`);
  const postings = await res.json();
  return (postings || []).map((p) => ({
    source: "lever",
    source_id: p.id,
    url: p.hostedUrl,
    apply_url: p.applyUrl || p.hostedUrl,
    title: p.text,
    company: slug,
    location_raw: p.categories?.location || null,
    work_mode: p.workplaceType === "remote" ? "remote" : p.workplaceType === "hybrid" ? "hybrid" : p.workplaceType === "on-site" ? "onsite" : "unknown",
    description_text: [p.descriptionPlain, ...(p.lists || []).map((l) => `${l.text}\n${(l.content || "").replace(/<[^>]+>/g, "")}`)].filter(Boolean).join("\n\n"),
    posted_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    raw: { team: p.categories?.team, commitment: p.categories?.commitment },
  }));
}

export const name = "lever";
export function enabled(cfg) {
  return Array.isArray(cfg?.boards?.lever) && cfg.boards.lever.length > 0;
}
export async function fetch_(cfg) {
  const results = [];
  for (const slug of cfg.boards.lever) {
    try {
      results.push(...(await fetchLeverBoard({ slug })));
    } catch (e) {
      console.warn(`[sources:lever] ${slug} failed: ${e.message}`);
    }
  }
  return results;
}
