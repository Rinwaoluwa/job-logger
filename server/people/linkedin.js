// Reads LinkedIn pages through a Chrome profile of its own that the user has
// signed in to once by hand (the "Connect LinkedIn" button opens that
// profile on the login page). Searches run it headless over the DevTools
// protocol and hand page text to the people-search agent.
//
// Why a separate profile: Chrome locks a user-data-dir to one running
// instance, so the user's everyday browser can never be attached to, and
// nothing here can touch their other tabs or sessions. Why not the
// extension: Claude in Chrome is not installed on this machine, and the
// headless CLI could not be made to use it from a background task.
//
// Automated reading of LinkedIn while signed in is against LinkedIn's
// terms and can get an account restricted. The user chose this on
// 2026-10-18 knowing that; the reader keeps the load small (a page cap per
// round, a pause between pages, one browser at a time) and stops at the
// first login wall.

import { spawn } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { findChrome, ChromeUnavailableError } from "../render/chrome.js";

export const LOGIN_URL = "https://www.linkedin.com/login";
const FEED_URL = "https://www.linkedin.com/feed/";
const LAUNCH_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 1500;
const CLOSE_TIMEOUT_MS = 8000;
const SIGNIN_RETRY_MS = 4000;
const NAVIGATE_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1500;
// 7k keeps names and headlines (near the top of search results and People
// tabs) and stops each page adding thousands of tokens of context that
// every later agent turn re-reads.
const PAGE_TEXT_CHARS = 7_000;
const MAX_PROFILE_LINKS = 60;
// Headless Chrome announces itself in its User-Agent; a plain one keeps
// the session looking like the browser the user signed in with.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const LOGIN_WALL = /linkedin\.com\/(login|authwall|checkpoint|uas\/login|signup|start\/join)/i;

export function isLinkedInUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "linkedin.com" || h.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The DevTools endpoint of a Chrome already running on the profile, or
 * null. Chrome writes DevToolsActivePort when launched with a debugging
 * port and removes it on a clean exit; a stale file (crash) is detected by
 * probing the port. */
export async function runningEndpoint(profileDir) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  if (!existsSync(portFile)) return null;
  let port;
  let wsPath;
  try {
    [port, wsPath] = (await readFile(portFile, "utf8")).trim().split("\n");
  } catch {
    return null;
  }
  if (!port || !wsPath) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const info = await res.json();
    return info.webSocketDebuggerUrl || `ws://127.0.0.1:${port}${wsPath}`;
  } catch {
    return null;
  }
}

/** Is a Chrome holding the profile without a debugging port (an older
 * sign-in window, or one the user opened by hand)? SingletonLock is a
 * dangling symlink to "<host>-<pid>", left behind after an unclean exit,
 * so the pid is checked for life. */
function profileLocked(profileDir) {
  let target;
  try {
    target = readlinkSync(path.join(profileDir, "SingletonLock"));
  } catch {
    return false;
  }
  const pid = Number(target.split("-").pop());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Opens the LinkedIn profile in a visible window on the login page. The
 * user signs in there and clicks Check: the check attaches to this window
 * over its debugging port, confirms the session and closes the window so
 * the profile is free for headless searches. (On macOS closing the window
 * does not quit Chrome, so the check must do it.) If a window on the
 * profile is already open, Chrome hands the URL to it and exits. */
export async function openSignInWindow(profileDir) {
  const bin = findChrome();
  if (!bin) throw new ChromeUnavailableError();
  await mkdir(profileDir, { recursive: true });
  const running = await runningEndpoint(profileDir);
  if (!running && !profileLocked(profileDir)) {
    await rm(path.join(profileDir, "DevToolsActivePort"), { force: true }).catch(() => {});
  }
  const child = spawn(
    bin,
    [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-extensions",
      "--new-window",
      LOGIN_URL,
    ],
    { stdio: "ignore", detached: true },
  );
  child.unref();
  return { pid: child.pid, reused: !!running };
}

/**
 * One headless browser on the LinkedIn profile, speaking the DevTools
 * protocol over the WebSocket Node 22 ships with. Use through
 * withBrowser(); never leave one running.
 */
class Browser {
  constructor(bin, profileDir) {
    this.bin = bin;
    this.profileDir = profileDir;
    this.child = null;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.tabs = new Set();
    // true when attached to a Chrome that was already running on the
    // profile (the sign-in window): then only our own tabs are closed on
    // kill(), never that browser.
    this.attached = false;
  }

  async launch() {
    await mkdir(this.profileDir, { recursive: true });
    const running = await runningEndpoint(this.profileDir);
    if (running) {
      this.attached = true;
      await this.connect(running);
      return;
    }
    if (profileLocked(this.profileDir)) {
      throw new Error(
        "Chrome is already running on the LinkedIn profile without a debugging port. Quit it (Cmd+Q in that window; closing the window alone leaves Chrome running) and try again.",
      );
    }
    const portFile = path.join(this.profileDir, "DevToolsActivePort");
    await rm(portFile, { force: true }).catch(() => {});
    this.child = spawn(
      this.bin,
      [
        "--headless=new",
        "--disable-gpu",
        `--user-data-dir=${this.profileDir}`,
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-extensions",
        "--window-size=1280,2400",
        `--user-agent=${UA}`,
        "--lang=en-US",
        "about:blank",
      ],
      { stdio: "ignore", detached: true },
    );
    let launchError = null;
    this.child.on("error", (e) => { launchError = e; });

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    let endpoint = null;
    while (Date.now() < deadline) {
      if (launchError) throw new Error(`Failed to launch Chrome at ${this.bin}: ${launchError.message}`);
      if (this.child.exitCode !== null) break;
      if (existsSync(portFile)) {
        const [port, wsPath] = (await readFile(portFile, "utf8")).trim().split("\n");
        if (port && wsPath) {
          endpoint = `ws://127.0.0.1:${port}${wsPath}`;
          break;
        }
      }
      await sleep(150);
    }
    if (!endpoint) {
      this.kill();
      throw new Error(
        "Chrome did not start on the LinkedIn profile. If a Chrome window on the LinkedIn profile is open, quit it (Cmd+Q) and try again.",
      );
    }
    await this.connect(endpoint);
  }

  connect(endpoint) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome's DevTools socket")), { once: true });
      ws.addEventListener("message", (ev) => this.onMessage(String(ev.data)));
      ws.addEventListener("close", () => {
        for (const [, p] of this.pending) p.reject(new Error("Chrome closed the DevTools connection"));
        this.pending.clear();
      });
      this.ws = ws;
    });
  }

  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) for (const fn of this.listeners) fn(msg);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.listeners.delete(fn); resolve(false); }, timeoutMs);
      const fn = (msg) => {
        if (predicate(msg)) {
          clearTimeout(t);
          this.listeners.delete(fn);
          resolve(true);
        }
      };
      this.listeners.add(fn);
    });
  }

  async openTab() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    const tab = { targetId, sessionId };
    this.tabs.add(tab);
    return tab;
  }

  async closeTab(tab) {
    this.tabs.delete(tab);
    await this.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => {});
  }

  /** Shuts the whole browser down cleanly (cookies flushed) and waits for
   * it to release the profile. Used on the sign-in window once the check
   * has seen the session, so headless searches can open the profile. */
  async closeBrowser() {
    await this.send("Browser.close").catch(() => {});
    const deadline = Date.now() + CLOSE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!(await runningEndpoint(this.profileDir)) && !profileLocked(this.profileDir)) break;
      await sleep(200);
    }
    await sleep(300);
    this.attached = false;
    this.kill();
  }

  /** Loads a URL in the tab and returns its final URL, title, visible text
   * and the profile links on it. */
  async readPage(tab, url, { scroll = true } = {}) {
    const loaded = this.waitFor((m) => m.method === "Page.loadEventFired" && m.sessionId === tab.sessionId, NAVIGATE_TIMEOUT_MS);
    await this.send("Page.navigate", { url }, tab.sessionId);
    await loaded;
    await sleep(SETTLE_MS);
    if (scroll) {
      // Search results and People tabs fill in as the page scrolls.
      for (let i = 0; i < 3; i++) {
        await this.evaluate(tab, "window.scrollBy(0, Math.max(800, window.innerHeight)); true");
        await sleep(700);
      }
      await this.evaluate(tab, "window.scrollTo(0, 0); true");
      await sleep(300);
    }
    const result = await this.evaluate(tab, PAGE_EXTRACT_JS);
    return result;
  }

  async evaluate(tab, expression) {
    const { result, exceptionDetails } = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      tab.sessionId,
    );
    if (exceptionDetails) throw new Error(`page script failed: ${exceptionDetails.text}`);
    return result?.value;
  }

  kill() {
    if (this.attached && this.ws?.readyState === WebSocket.OPEN) {
      // Someone else's browser: close only the tabs we opened. The replies
      // are not awaited; the socket closes right after.
      for (const tab of this.tabs) {
        try { this.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => {}); } catch { /* socket gone */ }
      }
      this.tabs.clear();
    }
    try { this.ws?.close(); } catch { /* already closed */ }
    const child = this.child;
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }
}

// Runs inside the page. Visible text with blank runs collapsed, plus every
// profile and company-page link (innerText never carries hrefs, and the
// agent needs URLs).
const PAGE_EXTRACT_JS = `(() => {
  const text = (document.body?.innerText || "")
    .replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll('a[href*="linkedin.com/in/"], a[href^="/in/"], a[href*="linkedin.com/company/"], a[href^="/company/"]')) {
    const href = a.href.split("?")[0].replace(/\\/$/, "");
    const label = (a.innerText || a.getAttribute("aria-label") || "").trim().split("\\n")[0].slice(0, 120);
    if (!href || seen.has(href) || !label) continue;
    seen.add(href);
    links.push({ label, href });
    if (links.length >= ${MAX_PROFILE_LINKS}) break;
  }
  return { url: location.href, title: document.title, text: text.slice(0, ${PAGE_TEXT_CHARS}), truncated: text.length > ${PAGE_TEXT_CHARS}, links };
})()`;

/** A headless browser on the profile, not yet launched, so the caller can
 * register it for teardown before launch() runs. kill() is safe at any
 * point, including mid-launch. Callers serialise themselves: one profile,
 * one browser. */
export function createBrowser(profileDir) {
  const bin = findChrome();
  if (!bin) throw new ChromeUnavailableError();
  return new Browser(bin, profileDir);
}

/** Opens one headless browser on the profile, hands it to fn, always
 * tears it down. */
export async function withBrowser(profileDir, fn) {
  const browser = createBrowser(profileDir);
  await browser.launch();
  try {
    return await fn(browser);
  } finally {
    browser.kill();
  }
}

export function looksSignedOut(page) {
  if (!page) return true;
  if (LOGIN_WALL.test(page.url)) return true;
  const head = (page.text || "").slice(0, 1200);
  return /Sign in\s*\n[\s\S]{0,200}Join now/i.test(head) && !/Messaging|My Network|Notifications/i.test(head);
}

/**
 * Is the profile signed in? Loads the feed: a signed-out profile is sent to
 * the login page or the auth wall instead. If the sign-in window is still
 * open the check runs inside it, and once the session is confirmed the
 * window is closed so searches can open the profile headless.
 * @returns {Promise<{connected: boolean, reason: string|null, checkedAt: string, closedWindow?: boolean}>}
 */
export async function checkSignedIn(profileDir) {
  const checkedAt = new Date().toISOString();
  if (!existsSync(profileDir)) return { connected: false, reason: "No LinkedIn profile yet. Use Connect LinkedIn to sign in once.", checkedAt };
  let browser;
  try {
    browser = createBrowser(profileDir);
    await browser.launch();
    const tab = await browser.openTab();
    let page = await browser.readPage(tab, FEED_URL, { scroll: false });
    if (looksSignedOut(page) && browser.attached) {
      // The sign-in window may still be mid-redirect (login → feed) when
      // the user clicks Check; give the session a moment and read again.
      await sleep(SIGNIN_RETRY_MS);
      page = await browser.readPage(tab, FEED_URL, { scroll: false });
    }
    if (looksSignedOut(page)) {
      console.warn(`[linkedin] check saw a signed-out page: ${page.url}`);
      if (browser.attached) {
        await browser.closeTab(tab);
        return { connected: false, reason: "Not signed in yet. Finish signing in in the Chrome window that opened, then click Check again.", checkedAt };
      }
      return { connected: false, reason: "The LinkedIn profile is signed out. Use Connect LinkedIn to sign in again.", checkedAt };
    }
    if (browser.attached) {
      await browser.closeBrowser();
      return { connected: true, reason: null, checkedAt, closedWindow: true };
    }
    return { connected: true, reason: null, checkedAt };
  } catch (e) {
    return { connected: false, reason: e.message, checkedAt };
  } finally {
    browser?.kill();
  }
}
