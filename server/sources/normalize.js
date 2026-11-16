import { stripHtml } from "./html.js";

const STOPWORDS_SUFFIX = /\b(inc|ltd|llc|corp|co|corporation|limited|company)\b\.?/gi;

export function normCompany(name) {
  return String(name || "")
    .toLowerCase()
    .replace(STOPWORDS_SUFFIX, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\(remote\)/g, "")
    .replace(/-\s*remote\b/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeKey(company, title) {
  return `${normCompany(company)}|${normTitle(title)}`;
}

const CANADA_HINTS = /\bcanada\b|\bontario\b|\bqu[ée]bec\b|\btoronto\b|\bhamilton\b|\bottawa\b|\bmississauga\b|\bmontreal\b|\bvancouver\b|\bcalgary\b|\bbc\b|,\s*on\b/i;
const US_STATE_ABBR = /,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;
const US_HINTS = /\bunited states\b|\busa\b|\bu\.s\.a?\.?\b/i;

export function inferCountry(locationText) {
  const text = String(locationText || "");
  if (CANADA_HINTS.test(text)) return "CA";
  if (US_HINTS.test(text) || US_STATE_ABBR.test(text)) return "US";
  return null;
}

const REMOTE_HINTS = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/i;
const HYBRID_HINTS = /\bhybrid\b/i;
const ONSITE_HINTS = /\bon-?site\b|\bin[- ]office\b|\bin person\b/i;

export function inferWorkMode(text) {
  const t = String(text || "");
  if (HYBRID_HINTS.test(t)) return "hybrid";
  if (REMOTE_HINTS.test(t)) return "remote";
  if (ONSITE_HINTS.test(t)) return "onsite";
  return "unknown";
}

/**
 * Normalizes a partial job record from any adapter into the common shape
 * stored in the `jobs` table. Adapter-provided fields win over inferred
 * ones; missing fields fall back to inference from title/location/description.
 */
/** True when postedAt is within maxAgeDays of now. Undated jobs and a
 * disabled cutoff (0 / null) always pass. */
export function withinMaxAge(postedAt, maxAgeDays) {
  if (!maxAgeDays || !postedAt) return true;
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return true;
  return Date.now() - posted <= maxAgeDays * 86_400_000;
}

export function toJob(partial) {
  const title = partial.title || "";
  const company = partial.company || "";
  const locationText = partial.location_raw || "";
  const description = partial.description_text || stripHtml(partial.description_html) || "";
  const combinedText = `${title} ${locationText} ${description.slice(0, 500)}`;

  return {
    source: partial.source,
    source_id: partial.source_id ?? null,
    url: partial.url,
    apply_url: partial.apply_url ?? partial.url ?? null,
    title,
    company,
    location_raw: locationText || null,
    country: partial.country ?? inferCountry(combinedText),
    region: partial.region ?? null,
    city: partial.city ?? null,
    work_mode: partial.work_mode ?? inferWorkMode(combinedText),
    remote_scope: partial.remote_scope ?? null,
    salary_text: partial.salary_text ?? null,
    salary_min: partial.salary_min ?? null,
    salary_max: partial.salary_max ?? null,
    currency: partial.currency ?? null,
    description_text: description,
    description_html: partial.description_html ?? null,
    description_truncated: !!partial.description_truncated,
    posted_at: partial.posted_at ?? null,
    dedupe_key: dedupeKey(company, title),
    also_seen_on: partial.also_seen_on ?? [],
    raw: partial.raw ?? null,
    tags: partial.tags ?? [],
  };
}
