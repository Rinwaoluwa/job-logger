// Imports the job list the user scrapes from Jack & Jill (jackandjill.ai)
// and saves as JSON under data/jackandjill/. There is no API call and no
// credential: the folder is the hand-off, the same way the routine log's
// Claude Doc is for the daily routine. Each scrape is its own file, so a
// new scrape is a new dated file and nothing has to be merged by hand.
//
// A file is a JSON array of Jack & Jill job records, or an object whose
// `jobs` / `data` / `results` / `items` key holds that array. Only the
// fields the app needs are read (see mapRecord), so a trimmed file works;
// `company` and `position` (or `title`) are the only required ones. Jack
// & Jill's own application stage is deliberately ignored: the pipeline
// stage in this app is the user's.
//
// Jack & Jill has already matched these to the candidate, so the adapter
// is trusted: the generic title filter does not apply. Age does, with its
// own cutoff (`jackandjill.max_age_days`, else `filters.max_age_days`,
// else 30): a record posted before it is skipped, and a Jack & Jill job
// already stored that has aged past it is deleted on each import unless
// the user has saved it, applied, or generated documents for it.
//
// Re-import rules: a record already in the db (same cleaned URL, same
// Jack & Jill id, or the same company+title within 45 days from another
// source) is not inserted again — it is enriched with the `jackandjill`
// tag and Jack's take so it still shows on the Jack & Jill tab. A record
// for a job the user deleted in the app (job_tombstones) is skipped.

import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../../config.js";
import {
  getJobByUrl, getJobBySourceId, getJobByJackAndJillId, getJobByDedupeKey, isTombstoned, updateJobMutableFields,
  listStaleUntouchedJobs, deleteJob,
} from "../../db/repo/jobs.js";
import { dedupeKey, inferWorkMode, withinMaxAge } from "../normalize.js";
import { findFuzzyMatch } from "../dedup.js";
import { stripMarkdown } from "../html.js";

export const name = "jackandjill";
export const trusted = true;
export const TAG = "jackandjill";

const DEFAULT_DIR = "data/jackandjill";
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const LIST_KEYS = ["jobs", "data", "results", "items"];

export function enabled(cfg) {
  return cfg?.jackandjill?.enabled !== false;
}

export function resolveDir(cfg) {
  return path.resolve(config.root, cfg?.jackandjill?.path || DEFAULT_DIR);
}

const DEFAULT_MAX_AGE_DAYS = 30;

/** Days after which a posting is too old to import or keep; 0 disables. */
export function maxAgeDays(cfg) {
  const days = cfg?.jackandjill?.max_age_days ?? cfg?.filters?.max_age_days ?? DEFAULT_MAX_AGE_DAYS;
  return Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : 0;
}

/** What the last run saw, per file, for the import card. Module-level
 * because the server is one process and config is read once anyway. */
let lastImport = null;

const nullableString = z.string().nullish();
const recordSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).nullish(),
  company: z.string().min(1),
  position: nullableString,
  title: nullableString,
  location: nullableString,
  job_description: nullableString,
  description_summary: nullableString,
  jacks_take: nullableString,
  external_url: nullableString,
  apply_href: nullableString,
  company_domain: nullableString,
  posted_at: z.union([z.string(), z.number()]).nullish(),
  created_at: z.union([z.string(), z.number()]).nullish(),
  match_score: z.number().nullish(),
  job_data_attributes: z.looseObject({
    work_mode: nullableString,
    work_mode_detail: nullableString,
    city: nullableString,
    salary_parsed: nullableString,
    salary_estimated: nullableString,
    salary_estimated_reasoning: nullableString,
  }).nullish(),
});

/** Drops utm_* tracking params and the hash so the URL matches what an
 * ATS board adapter or "add by link" stored for the same posting. */
export function cleanUrl(raw) {
  const text = String(raw || "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const u = new URL(text);
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    let out = u.toString();
    if (out.endsWith("?")) out = out.slice(0, -1);
    return out;
  } catch {
    return text.replace(/[?&]utm_[^&#]*/gi, "").replace(/\?$/, "").replace(/#.*$/, "");
  }
}

function mapWorkMode(value) {
  const v = String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "remote") return "remote";
  if (v === "hybrid") return "hybrid";
  if (v === "onsite" || v === "inoffice" || v === "office" || v === "inperson") return "onsite";
  return undefined;
}

function toIso(value) {
  if (value == null || value === "") return null;
  const d = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseSalary(text) {
  const m = String(text || "").match(/^\s*(CAD|USD|CA\$|US\$|C\$|\$)?\s*\$?\s*([\d,]{4,})\s*(?:-|–|to)\s*\$?\s*([\d,]{4,})/i);
  if (!m) return {};
  const num = (s) => Number(s.replace(/,/g, ""));
  const cur = m[1] ? m[1].toUpperCase() : null;
  return {
    salary_min: num(m[2]),
    salary_max: num(m[3]),
    currency: cur === "CAD" || cur === "CA$" || cur === "C$" ? "CAD" : cur === "USD" || cur === "US$" ? "USD" : null,
  };
}

/**
 * Maps one Jack & Jill record to the partial job shape toJob expects.
 * Returns { ok: true, job } or { ok: false, reason }. Exported for tests.
 */
export function mapRecord(input, fileName = null) {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ") };
  const rec = parsed.data;
  const title = (rec.position || rec.title || "").trim();
  if (!title) return { ok: false, reason: "position/title missing" };
  const company = rec.company.trim();
  const sourceId = rec.id != null ? String(rec.id) : null;
  const realUrl = cleanUrl(rec.external_url);
  if (!realUrl && !sourceId) return { ok: false, reason: "no external_url and no id" };
  const url = realUrl || `jackandjill:${sourceId}`;
  const attrs = rec.job_data_attributes || {};

  const description = stripMarkdown(rec.job_description);
  const summary = stripMarkdown(rec.description_summary);
  const take = stripMarkdown(rec.jacks_take);
  const salaryText = attrs.salary_parsed || attrs.salary_estimated || null;
  const workMode = mapWorkMode(attrs.work_mode);
  const modeHint = `${attrs.work_mode_detail || ""} ${rec.location || ""}`;
  const inferred = inferWorkMode(modeHint);

  const job = {
    source: name,
    source_id: sourceId,
    url,
    apply_url: cleanUrl(rec.apply_href) || realUrl || (rec.company_domain ? `https://${rec.company_domain}` : null),
    title,
    company,
    location_raw: rec.location?.trim() || null,
    city: attrs.city || null,
    work_mode: workMode ?? (inferred !== "unknown" ? inferred : undefined),
    salary_text: salaryText,
    ...(attrs.salary_parsed ? parseSalary(attrs.salary_parsed) : {}),
    description_text: description || summary || `${title} at ${company}`,
    description_truncated: !description,
    posted_at: toIso(rec.posted_at) || toIso(rec.created_at),
    tags: [TAG],
    raw: {
      jackandjill: {
        id: sourceId,
        // The employer's posting, kept so a job first stored with a
        // Jack & Jill page as its link can be pointed at the real posting.
        external_url: realUrl,
        jacks_take: take || null,
        description_summary: summary || null,
        match_score: rec.match_score ?? null,
        salary_estimated: attrs.salary_estimated || null,
        salary_estimated_reasoning: attrs.salary_estimated_reasoning || null,
        work_mode_detail: attrs.work_mode_detail || null,
        company_domain: rec.company_domain || null,
        imported_from: fileName,
      },
    },
  };
  return { ok: true, job };
}

function readRecords(filePath) {
  const size = statSync(filePath).size;
  if (size > MAX_FILE_BYTES) throw new Error(`file is ${(size / 1048576).toFixed(0)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB`);
  const text = readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of LIST_KEYS) if (Array.isArray(data[key])) return data[key];
    // A single record pasted on its own.
    if (data.company && (data.position || data.title)) return [data];
  }
  throw new Error("expected a JSON array of jobs (or an object with a jobs/data/results/items array)");
}

function listFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json") && !f.startsWith("."))
    .sort()
    .map((f) => {
      const st = statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    });
}

function findExisting(job) {
  return getJobByUrl(job.url)
    || getJobBySourceId(name, job.source_id)
    // The routine log records Jack's email link, which carries the same id:
    // match on it before the company/title heuristics ("The Bank of Nova
    // Scotia" vs "Scotiabank" would otherwise miss).
    || getJobByJackAndJillId(job.source_id)
    || getJobByDedupeKey(dedupeKey(job.company, job.title))
    || findFuzzyMatch(job);
}

const JACKANDJILL_PAGE = /(^|\.)jackandjill\.ai\//i;

/** True when "Open posting" would land on a Jack & Jill page (the routine
 * log records Jack's email links) or on no web page at all. */
function needsEmployerLink(link) {
  return !link || !/^https?:\/\//i.test(link) || JACKANDJILL_PAGE.test(link);
}

/** A job already stored (from a board, the routine, or an earlier import)
 * gains the tag and Jack's take so the Jack & Jill tab lists it, and the
 * employer's posting as its link when its own link is a Jack & Jill page. */
function enrich(existing, job) {
  const tags = Array.isArray(existing.tags) ? existing.tags : [];
  const incoming = job.raw.jackandjill;
  const current = existing.raw?.jackandjill || null;
  const fields = {};
  if (incoming.external_url && needsEmployerLink(existing.apply_url || existing.url)) {
    fields.apply_url = incoming.external_url;
  }
  // A job already carrying another Jack & Jill record's take (the scrape
  // lists some postings twice under different ids) keeps the first one,
  // or every import would swap the two.
  const other = tags.includes(TAG) && current?.id && incoming.id && current.id !== incoming.id;
  const same = tags.includes(TAG) && current
    && JSON.stringify({ ...current, imported_from: null }) === JSON.stringify({ ...incoming, imported_from: null });
  if ((same || other) && !fields.apply_url) return false;
  if (other) {
    updateJobMutableFields(existing.id, fields);
    return true;
  }
  updateJobMutableFields(existing.id, {
    ...fields,
    tags: tags.includes(TAG) ? tags : [...tags, TAG],
    raw: { ...(existing.raw || {}), jackandjill: incoming },
  });
  return true;
}

/** Deletes this source's jobs that have aged past the cutoff and that the
 * user never acted on. deleteJob leaves a tombstone, so they stay gone. */
function purgeStale(days) {
  if (!days) return 0;
  const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const ids = listStaleUntouchedJobs(name, cutoffIso);
  for (const id of ids) deleteJob(id);
  return ids.length;
}

export async function fetch_(cfg) {
  const dir = resolveDir(cfg);
  const days = maxAgeDays(cfg);
  mkdirSync(dir, { recursive: true });
  const files = listFiles(dir);
  const seenIds = new Set();
  const seenUrls = new Set();
  const jobs = [];
  const report = [];

  for (const file of files) {
    const entry = { name: file.name, records: 0, emitted: 0, enriched: 0, skipped: 0, stale: 0, invalid: 0, error: null };
    report.push(entry);
    let records;
    try {
      records = readRecords(path.join(dir, file.name));
    } catch (e) {
      entry.error = e.message;
      console.warn(`[sources:jackandjill] ${file.name}: ${e.message}`);
      continue;
    }
    entry.records = records.length;
    for (const rec of records) {
      const mapped = mapRecord(rec, file.name);
      if (!mapped.ok) { entry.invalid++; continue; }
      const job = mapped.job;
      if ((job.source_id && seenIds.has(job.source_id)) || seenUrls.has(job.url)) { entry.skipped++; continue; }
      if (job.source_id) seenIds.add(job.source_id);
      seenUrls.add(job.url);

      if (!withinMaxAge(job.posted_at, days)) { entry.stale++; continue; }
      if (isTombstoned({ url: job.url, source: name, sourceId: job.source_id })) { entry.skipped++; continue; }
      const existing = findExisting(job);
      if (existing) {
        if (enrich(existing, job)) entry.enriched++; else entry.skipped++;
        continue;
      }
      jobs.push(job);
      entry.emitted++;
    }
  }

  const removed = purgeStale(days);
  lastImport = { at: new Date().toISOString(), path: dir, files: report, removed, maxAgeDays: days };
  const failed = report.filter((r) => r.error);
  if (files.length && failed.length === files.length) {
    throw new Error(`no readable file in ${dir}: ${failed.map((r) => `${r.name} (${r.error})`).join("; ")}`);
  }
  const totals = report.reduce((acc, r) => {
    for (const k of ["records", "emitted", "enriched", "skipped", "stale", "invalid"]) acc[k] += r[k];
    return acc;
  }, { records: 0, emitted: 0, enriched: 0, skipped: 0, stale: 0, invalid: 0 });
  console.log(`[sources:jackandjill] ${files.length} file(s), ${totals.records} records, ${totals.emitted} new, ${totals.enriched} enriched, ${totals.skipped} already known, ${totals.stale} older than ${days || "∞"} days, ${totals.invalid} invalid; ${removed} stale job(s) removed`);
  return jobs;
}

/** Folder, files and the last run's per-file results, for the import
 * card. Reads directory metadata only; no file is parsed here. */
export function describe(cfg) {
  const dir = resolveDir(cfg);
  let files = [];
  let error = null;
  try {
    files = listFiles(dir);
  } catch (e) {
    if (e.code !== "ENOENT") error = e.message;
  }
  return { path: dir, enabled: enabled(cfg), maxAgeDays: maxAgeDays(cfg), files, error, lastImport };
}
