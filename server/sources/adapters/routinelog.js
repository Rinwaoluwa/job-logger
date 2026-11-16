// Reads the "Job Search Log" Claude Doc that the daily "Jobs" routine on
// claude.ai appends to, and turns each logged line into a job.
//
// The routine runs in Anthropic's cloud and cannot reach this app, and the
// doc has no public export URL, so the hand-off is the claude.ai "Claude
// Docs" connector: a headless `claude` call (runClaude in connector mode)
// reads the doc with that one tool and hands back the day headings and
// their bullet lines copied verbatim. Parsing stays here. Each read asks
// for the latest day already stored onward, so the call stays small, and
// costs about half a cent on haiku. Each job is one line:
//
//   - Company — Title — Location — posted YYYY-MM-DD — salary <text> — Strong fit|Stretch|Jack & Jill — <url> — <note>
//
// Fields are recognised by shape rather than position (the URL starts
// with http, "posted …", "salary …" and the fit label are keyword
// tokens), so older lines that lack salary or the note still parse.
// "Jack & Jill" in the fit slot marks a line the routine took from Jack's
// email; its URL is a Jack & Jill page that needs a sign-in, so such a job
// keeps the routine's summary and gets the employer's link from the Jack
// & Jill JSON import, matched on the id inside the URL.
//
// The routine has already judged fit against the candidate's brief, so
// this adapter is marked trusted: the refresh loop's generic title and
// age filters do not apply to its jobs.
//
// Descriptions: the doc holds only a summary line. For each new URL the
// adapter tries the ATS JSON API (Greenhouse, Lever, Ashby) and then a
// Readability fetch of the page, with no AI call in either path. When
// both fail (Indeed short links return 403, for example) the job is
// stored from the summary with description_truncated set, so the drawer's
// "Fetch full description" button and a pasted description remain the
// way to fill it in.

import { z } from "zod";
import { runClaude } from "../../ai/claude.js";
import {
  getJobByUrl, getJobBySeenUrl, getJobByJackAndJillId, isTombstoned, latestRoutineLoggedOn, updateJobMutableFields,
} from "../../db/repo/jobs.js";
import { fetchPage, detectAtsBoard } from "../extract.js";
import { fetchGreenhouseBoard } from "./greenhouse.js";
import { fetchLeverBoard } from "./lever.js";
import { fetchAshbyBoard } from "./ashby.js";

export const name = "routine";
export const trusted = true;

const TAG = "routine";
const JACKANDJILL_TAG = "jackandjill";

export function enabled(cfg) {
  return cfg?.routinelog?.enabled === true && !!cfg.routinelog.claude_doc_id;
}

export function docUrl(settings) {
  return settings?.claude_doc_id ? `https://claude.ai/code/artifact/${encodeURIComponent(settings.claude_doc_id)}` : null;
}

const SEPARATOR = /\s+—\s+/;
const DATE_HEADING = /^(\d{4}-\d{2}-\d{2})\s*$/;
const JACKANDJILL_URL = /(?:^|\.)jackandjill\.ai\/jobs\/([0-9a-f-]{36})(?:\/|$|\?)/i;
const MIN_DESCRIPTION_CHARS = 200;

/** What the last read saw, for the tab's card. Module-level because the
 * server is one process. */
let lastRead = null;

/** Parses one log line into its fields, or returns null when the line
 * carries no URL (headings, blank lines, prose). Exported for tests. */
export function parseLogLine(line, loggedOn = null) {
  const cleaned = String(line || "")
    .replace(/^﻿/, "")
    .replace(/^\s*\\?[-•*]\s*/, "")
    .trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(SEPARATOR).map((t) => t.trim()).filter(Boolean);
  const urlIndex = tokens.findIndex((t) => /^https?:\/\//i.test(t));
  if (urlIndex === -1) return null;

  const url = tokens[urlIndex].replace(/[),.]+$/, "");
  const note = tokens.slice(urlIndex + 1).join(", ") || null;
  const before = tokens.slice(0, urlIndex);
  const jackAndJillId = url.match(JACKANDJILL_URL)?.[1]?.toLowerCase() || null;

  let postedAt = null;
  let salary = null;
  let fit = null;
  let via = jackAndJillId ? "jackandjill" : null;
  const positional = [];
  for (const token of before) {
    let m;
    if ((m = token.match(/^(?:posted|date)\b\s*(.*)$/i))) {
      // "posted 2026-09-15", "posted unknown", "date not shown"
      const d = m[1].match(/\d{4}-\d{2}-\d{2}/);
      postedAt = d ? d[0] : null;
    } else if ((m = token.match(/^salary\b\s*[:]?\s*(.*)$/i)) || (m = token.match(/^((?:CA|US)?\$\s?[\d,.]+.*)$/i))) {
      // "salary $126,800–$164,100", "salary not listed", or a bare "$80,000–$110,000"
      const text = m[1].trim();
      salary = text && !/^(not listed|none|n\/a|unknown)$/i.test(text) ? text : null;
    } else if (/^(strong fit|stretch)\b/i.test(token)) {
      fit = /^stretch/i.test(token) ? "stretch" : "strong fit";
    } else if (/^jack\s*(&|and)\s*jill$/i.test(token)) {
      // The routine writes Jack's pick in the fit slot; it is a source, not
      // a verdict (fit scoring here fills that in).
      via = "jackandjill";
    } else {
      positional.push(token);
    }
  }
  const [company, title, location] = positional;
  if (!company || !title) return null;

  return { company, title, location: location || null, postedAt, salary, fit, url, note, loggedOn, via, jackAndJillId };
}

export function parseLog(text) {
  const entries = [];
  let loggedOn = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(DATE_HEADING);
    if (heading) { loggedOn = heading[1]; continue; }
    const entry = parseLogLine(line, loggedOn);
    if (entry) entries.push(entry);
  }
  return entries;
}

const logSchema = z.object({
  sections: z.array(z.object({
    date: z.string(),
    lines: z.array(z.string()),
  })),
});

const READ_SYSTEM = "You are a data extraction tool. You copy text exactly as it appears; you never paraphrase, summarise, reorder or omit.";

function readPrompt(docId, since) {
  const range = since
    ? `whose date is on or after ${since} (include ${since} itself)`
    : "(all of them)";
  return [
    `Read the Claude Doc with id ${docId} and return its job log lines.`,
    "",
    "Steps:",
    `1. Call mcp__claude_ai_Claude_Docs__read with ref {"object":"project","id":"${docId}"}. The result lists the doc's tabs under files[]; take the first tab's content.id (its prose node id).`,
    `2. Call mcp__claude_ai_Claude_Docs__read with ref {"object":"node","id":"<that node id>"}, engine "prose", container {"kind":"project","id":"${docId}"}, payload {"projection":"outline"}. The outline lists each level-2 date heading (YYYY-MM-DD) followed by its <list id=…>, with the bullets folded into a <gap/>. The first id prints in full (e.g. "mdemdskqjwm.0"); later ids print short (".28453") and take the prefix of the last full id above them, so ".28453" means "mdemdskqjwm.28453".`,
    `3. For every date heading ${range}, call mcp__claude_ai_Claude_Docs__read with the same ref, engine and container and payload {"kind":"view","parentId":"<that heading's full list id>"} to get its bullets. One call per list; never read the whole doc with a plain view (it is too large to come back).`,
    `4. Return those date headings with their bullet lines, in document order.`,
    "",
    "Copy each bullet line character-for-character as plain text: no leading dash or bullet, no markdown escaping (write _ not \\_), keep the em dashes (—) and the full URL exactly as written. Decode XML entities (&amp; is &). Do not add, drop, merge or shorten lines. A heading with no bullets has an empty lines array.",
  ].join("\n");
}

/** Asks the CLI (connector mode) for the doc's sections from `since` on,
 * and rebuilds them as the text the parser already understands. */
async function readLog(settings, since) {
  const { data, costUsd } = await runClaude({
    purpose: "routine_log:read",
    system: READ_SYSTEM,
    prompt: readPrompt(settings.claude_doc_id, since),
    schema: logSchema,
    model: settings.model || "haiku",
    effort: "low",
    timeoutMs: 240_000,
    mcpTools: ["mcp__claude_ai_Claude_Docs__read"],
    // A list per date section, so a first read of the whole log needs room.
    maxTurns: 20,
    maxBudgetUsd: settings.max_cost_usd ?? 0.25,
  });
  const text = data.sections
    .map((s) => [s.date, ...s.lines.map((l) => `- ${l}`)].join("\n"))
    .join("\n\n");
  return { text, sections: data.sections, costUsd };
}

/** ATS boards are fetched once per slug per refresh, not once per job. */
function boardCache() {
  const cache = new Map();
  return async (board, slug) => {
    const key = `${board}:${slug}`;
    if (!cache.has(key)) {
      const fetcher = board === "greenhouse" ? fetchGreenhouseBoard : board === "lever" ? fetchLeverBoard : fetchAshbyBoard;
      cache.set(key, fetcher({ slug }).catch((e) => {
        console.warn(`[sources:routine] ${key}: ${e.message}`);
        return [];
      }));
    }
    return cache.get(key);
  };
}

async function hydrate(entry, getBoard) {
  const ats = detectAtsBoard(entry.url);
  if (ats) {
    const jobs = await getBoard(ats.board, ats.slug);
    const match = jobs.find((j) => j.url === entry.url || j.apply_url === entry.url);
    if (match) {
      return {
        description_text: match.description_text,
        description_html: match.description_html ?? null,
        posted_at: match.posted_at || null,
        location_raw: match.location_raw || null,
        apply_url: match.apply_url || match.url,
        source_id: match.source_id ?? null,
        raw: match.raw ?? null,
      };
    }
  }
  try {
    const { text } = await fetchPage(entry.url);
    if (text && text.length >= MIN_DESCRIPTION_CHARS) return { description_text: text };
  } catch (e) {
    console.warn(`[sources:routine] could not fetch ${entry.url}: ${e.message}`);
  }
  return null;
}

function summaryDescription(entry) {
  const lines = [
    `${entry.title} at ${entry.company}${entry.location ? ` (${entry.location})` : ""}.`,
    entry.fit ? `Daily routine rated this a ${entry.fit}.` : null,
    entry.via === "jackandjill" ? "Picked by Jack & Jill (jackandjill.ai)." : null,
    entry.note ? `Routine note: ${entry.note}` : null,
    entry.salary ? `Salary: ${entry.salary}` : null,
    "",
    entry.jackAndJillId
      ? "The link is a Jack & Jill page that needs a sign-in. The employer's posting link and full description arrive when you import the Jack & Jill export on the Jack & Jill tab; until then, paste the description here."
      : "The full posting could not be fetched automatically. Open the link and paste the description, or use \"Fetch full description\".",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** A Jack & Jill line whose posting the JSON import already stored: the
 * stored job gains the routine tag and the routine's note so it lists on
 * the Job Search Log tab too, with the employer link it already has. */
function annotateExisting(existing, entry) {
  const tags = Array.isArray(existing.tags) ? existing.tags : [];
  if (tags.includes(TAG) && existing.raw?.routine) return false;
  updateJobMutableFields(existing.id, {
    tags: tags.includes(TAG) ? tags : [...tags, TAG],
    raw: { ...(existing.raw || {}), routine: routineRaw(entry) },
  });
  return true;
}

function routineRaw(entry) {
  return {
    fit: entry.fit,
    note: entry.note,
    logged_on: entry.loggedOn,
    via: entry.via,
    jackandjill_id: entry.jackAndJillId,
  };
}

export async function fetch_(cfg) {
  const settings = cfg.routinelog || {};
  const maxHydrate = settings.max_hydrate_per_refresh ?? 20;
  const since = latestRoutineLoggedOn();
  const { text, sections, costUsd } = await readLog(settings, since);
  const entries = parseLog(text);
  const lineCount = sections.reduce((n, s) => n + s.lines.length, 0);
  const stats = {
    at: new Date().toISOString(), since, sections: sections.length, lines: lineCount,
    parsed: entries.length, unparsed: lineCount - entries.length, newJobs: 0, annotated: 0, deleted: 0, costUsd,
  };
  lastRead = stats;
  if (stats.unparsed > 0) {
    const bad = sections.flatMap((s) => s.lines).filter((l) => !parseLogLine(l));
    console.warn(`[sources:routine] ${stats.unparsed} line(s) did not parse:\n  ${bad.join("\n  ")}`);
  }
  if (!entries.length) {
    console.log(`[sources:routine] doc read (${lineCount} lines since ${since || "the start"}) but no job lines found`);
    return [];
  }

  const getBoard = boardCache();
  const jobs = [];
  let attempted = 0;
  let hydrated = 0;
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    // Already ingested on an earlier refresh (as its own row, or merged
    // into a same-company-and-title row that keeps this URL in
    // also_seen_on): leave it alone so a later edit in the app is not
    // overwritten by the summary. Deleted in the app: stays deleted.
    if (getJobByUrl(entry.url) || getJobBySeenUrl(entry.url) || isTombstoned({ url: entry.url })) continue;

    if (entry.jackAndJillId) {
      // Deleted in the app, or removed by the Jack & Jill import's age
      // purge: a deleted job stays gone, whichever feed lists it again.
      if (isTombstoned({ source: JACKANDJILL_TAG, sourceId: entry.jackAndJillId })) { stats.deleted++; continue; }
      const existing = getJobByJackAndJillId(entry.jackAndJillId);
      if (existing) {
        if (annotateExisting(existing, entry)) stats.annotated++;
        continue;
      }
    }

    let full = null;
    // A Jack & Jill page needs a sign-in, so there is nothing to fetch.
    if (!entry.jackAndJillId && attempted < maxHydrate) {
      attempted++;
      full = await hydrate(entry, getBoard);
      if (full) hydrated++;
    }

    const tags = [TAG];
    if (entry.fit) tags.push(entry.fit === "stretch" ? "stretch" : "strong-fit");
    if (entry.via === "jackandjill") tags.push(JACKANDJILL_TAG);

    jobs.push({
      source: name,
      source_id: full?.source_id ?? null,
      url: entry.url,
      apply_url: full?.apply_url || entry.url,
      title: entry.title,
      company: entry.company,
      location_raw: entry.location || full?.location_raw || null,
      description_text: full?.description_text || summaryDescription(entry),
      description_html: full?.description_html ?? null,
      description_truncated: !full,
      posted_at: entry.postedAt || full?.posted_at || null,
      salary_text: entry.salary,
      tags,
      raw: {
        ...(full?.raw || {}),
        routine: routineRaw(entry),
      },
    });
  }
  stats.newJobs = jobs.length;
  console.log(`[sources:routine] ${lineCount} lines since ${since || "the start"}, ${entries.length} parsed, ${jobs.length} new, ${stats.annotated} Jack & Jill jobs annotated, ${stats.deleted} deleted earlier and left out, ${hydrated} with a full description, ${jobs.length - hydrated} summary-only, $${(costUsd ?? 0).toFixed(3)}`);
  return jobs;
}

/** Doc link and the last read's numbers, for the Job Search Log card. */
export function describe(cfg) {
  const settings = cfg?.routinelog || {};
  return { enabled: enabled(cfg), docId: settings.claude_doc_id || null, docUrl: docUrl(settings), lastRead };
}
