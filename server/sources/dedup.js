import { getJobByUrl, getJobBySeenUrl, getJobByDedupeKey, findCandidatesByCompany, insertJob, updateJobMutableFields } from "../db/repo/jobs.js";
import { enqueueFit } from "../db/repo/tasks.js";
import { PRIORITY } from "../../shared/tasks.js";
import { normCompany, normTitle } from "./normalize.js";

function tokenSet(text) {
  return new Set(text.split(/\s+/).filter(Boolean));
}

function jaccard(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Same company and a near-identical title (Jaccard ≥ 0.85). Exported so
 * a list import can recognise a near-duplicate before emitting it. */
export function findFuzzyMatch(job) {
  const candidates = findCandidatesByCompany(job.company);
  const targetTitle = normTitle(job.title);
  const targetCompany = normCompany(job.company);
  for (const c of candidates) {
    if (normCompany(c.company) !== targetCompany) continue;
    if (jaccard(normTitle(c.title), targetTitle) >= 0.85) return c;
  }
  return null;
}

/**
 * Inserts a normalized job, or merges it into an existing one found by
 * URL, dedupe key (within 45 days), or fuzzy title match within the same
 * company. Returns { job, created }.
 */
export function upsertJob(job, { enqueueFitOnCreate = false } = {}) {
  const byUrl = getJobByUrl(job.url);
  if (byUrl) {
    const merged = mergeMutableFields(byUrl, job);
    const updated = updateJobMutableFields(byUrl.id, merged);
    return { job: updated, created: false };
  }

  // A link the job was merged from, or the one it had before the user
  // edited its URL, still names this job.
  const bySeenUrl = getJobBySeenUrl(job.url);
  if (bySeenUrl) {
    const updated = updateJobMutableFields(bySeenUrl.id, mergeMutableFields(bySeenUrl, job));
    return { job: updated, created: false };
  }

  const byDedupeKey = getJobByDedupeKey(job.dedupe_key);
  if (byDedupeKey) {
    const alsoSeenOn = uniqueSeenOn(byDedupeKey.also_seen_on, job.source, job.url);
    const merged = mergeMutableFields(byDedupeKey, job, { alsoSeenOn });
    const updated = updateJobMutableFields(byDedupeKey.id, merged);
    return { job: updated, created: false };
  }

  const fuzzy = findFuzzyMatch(job);
  if (fuzzy) {
    const alsoSeenOn = uniqueSeenOn(fuzzy.also_seen_on, job.source, job.url);
    const merged = mergeMutableFields(fuzzy, job, { alsoSeenOn });
    const updated = updateJobMutableFields(fuzzy.id, merged);
    return { job: updated, created: false };
  }

  const inserted = insertJob(job);
  // A job the user added by hand is one they care about now, so its fit
  // scoring outranks the bulk queue a source refresh builds.
  if (enqueueFitOnCreate) enqueueFit(inserted.id, { priority: PRIORITY.user });
  return { job: inserted, created: true };
}

function uniqueSeenOn(existing, source, url) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  if (!list.some((s) => s.source === source && s.url === url)) list.push({ source, url });
  return list;
}

function mergeMutableFields(existing, incoming, { alsoSeenOn } = {}) {
  const fields = {};
  // Keep the longer description (fixes truncated snippets when a board
  // posting for the same job has the full text).
  if ((incoming.description_text || "").length > (existing.description_text || "").length) {
    fields.description_text = incoming.description_text;
    fields.description_html = incoming.description_html;
    fields.description_truncated = incoming.description_truncated;
  }
  if (incoming.salary_text && !existing.salary_text) fields.salary_text = incoming.salary_text;
  if (incoming.salary_min != null && existing.salary_min == null) fields.salary_min = incoming.salary_min;
  if (incoming.salary_max != null && existing.salary_max == null) fields.salary_max = incoming.salary_max;
  if (incoming.posted_at && (!existing.posted_at || incoming.posted_at < existing.posted_at)) fields.posted_at = incoming.posted_at;
  if (alsoSeenOn) fields.also_seen_on = alsoSeenOn;
  // Tags are how the Jobs tab's segments find a job (jackandjill, routine),
  // so a job merged into an earlier row keeps the tags it arrived with.
  const incomingTags = Array.isArray(incoming.tags) ? incoming.tags : [];
  const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
  if (incomingTags.some((t) => !existingTags.includes(t))) {
    fields.tags = [...existingTags, ...incomingTags.filter((t) => !existingTags.includes(t))];
  }
  return fields;
}
