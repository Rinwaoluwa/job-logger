// The one LinkedIn browser in the server process, shared by every search
// call. A people-search round runs several `claude` processes at once, each
// with its own linkedinMcp.js; if each of those opened Chrome on the
// signed-in profile they would race on the profile lock and the first to
// shut down would kill the browser the others were using. So the MCP
// servers are proxies: they POST to /api/people/linkedin/read and this
// module does the reading, one page at a time, with one page cap per
// search run and one pause between pages however many agents are asking.
//
// A run is opened by the pipeline before its first round and closed in a
// finally; its token travels to the MCP servers in their env. Chrome is
// launched on the first read and killed shortly after the last run closes.

import { randomBytes } from "node:crypto";
import { createBrowser, isLinkedInUrl, looksSignedOut } from "./linkedin.js";

const PAUSE_MS = [2000, 3500];
const IDLE_CLOSE_MS = 15_000;

const runs = new Map(); // token -> { maxPages, pagesRead, signedOut }
let browser = null;
let tabPromise = null;
let chain = Promise.resolve();
let lastReadAt = 0;
let idleTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Registers a search run. @returns {{token: string}} */
export function openRun({ maxPages = 20, profileDir } = {}) {
  if (!profileDir) throw new Error("profileDir is required");
  const token = randomBytes(16).toString("hex");
  runs.set(token, { maxPages: Math.max(1, maxPages), pagesRead: 0, signedOut: false, profileDir });
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  return { token };
}

/** Forgets a run; the browser goes away once no run is left. */
export function closeRun(token) {
  runs.delete(token);
  if (runs.size === 0 && browser && !idleTimer) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (runs.size === 0) killBrowser();
    }, IDLE_CLOSE_MS);
    idleTimer.unref();
  }
}

export function activeRuns() {
  return runs.size;
}

function killBrowser() {
  const b = browser;
  browser = null;
  tabPromise = null;
  try { b?.kill(); } catch { /* gone */ }
}

function getTab(profileDir) {
  if (!tabPromise) {
    tabPromise = (async () => {
      browser = createBrowser(profileDir);
      await browser.launch();
      return browser.openTab();
    })();
    // A failed launch must not poison the next read.
    tabPromise.catch(() => { killBrowser(); });
  }
  return tabPromise;
}

export class ReaderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Reads one LinkedIn page for a run. Reads are serialised: one tab, one
 * page at a time, a pause between pages.
 * @returns {Promise<{url: string, title: string, text: string, truncated: boolean, links: {label: string, href: string}[]}>}
 */
export function read(token, url) {
  const run = runs.get(token);
  if (!run) throw new ReaderError("unknown or finished LinkedIn run", 403);
  if (!isLinkedInUrl(url)) throw new ReaderError("linkedin tools read linkedin.com pages only; use WebFetch for other sites");
  if (run.signedOut) throw new ReaderError("The LinkedIn profile is signed out (login wall). Stop using the linkedin tools and continue with web search; say so in search_notes.");
  if (run.pagesRead >= run.maxPages) throw new ReaderError(`LinkedIn page cap for this search reached (${run.maxPages}). Continue with web search and WebFetch.`);
  run.pagesRead += 1;

  const job = chain.then(async () => {
    if (!runs.has(token)) throw new ReaderError("the LinkedIn run was closed", 403);
    if (lastReadAt) {
      const wait = PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]) - (Date.now() - lastReadAt);
      if (wait > 0) await sleep(wait);
    }
    const tab = await getTab(run.profileDir);
    lastReadAt = Date.now();
    const page = await browser.readPage(tab, url);
    if (looksSignedOut(page)) {
      run.signedOut = true;
      throw new ReaderError("LinkedIn showed a login wall: the profile is signed out. Stop using the linkedin tools and continue with web search; say so in search_notes.");
    }
    return page;
  });
  // The chain itself never rejects, so one failed read does not block the next.
  chain = job.catch(() => {});
  return job;
}

/** Test/shutdown hook: closes every run and the browser now. */
export function shutdownReader() {
  runs.clear();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  killBrowser();
}
