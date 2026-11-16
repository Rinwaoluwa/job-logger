// Renders HTML to PDF by driving an already-installed Chrome/Chromium in
// headless mode. No npm dependency and no bundled browser download. Used
// only to measure the résumé's page count (server/render/measure.js); the
// downloadable PDF comes from pdfkit (server/render/pdf.js), because
// Chrome's PDF text does not extract cleanly.
//
// The browser is only ever pointed at a file:// URL we just wrote
// ourselves, with a throwaway --user-data-dir so it can never attach to
// (or disturb) the user's running Chrome profile.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { createSemaphore } from "../ai/semaphore.js";
import { currentTask, TaskCancelledError } from "../tasks/context.js";

// Several tailor runs can reach their page measurement at once; each one
// is a whole browser, so cap how many overlap.
export const chromeSemaphore = createSemaphore(config.chrome.concurrency);

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const PATH_CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

function findOnPath(name) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

let resolved; // undefined = not looked up yet, null = looked up and absent

/** Absolute path to a usable Chrome binary, or null if none is installed. */
export function findChrome() {
  if (resolved !== undefined) return resolved;
  // An explicitly configured binary is the whole answer: if it's wrong,
  // say so rather than quietly rendering with some other browser the
  // machine happens to have.
  const fromEnv = process.env.CHROME_BIN;
  if (fromEnv) {
    if (existsSync(fromEnv)) return (resolved = fromEnv);
    console.warn(`[render] CHROME_BIN is set to ${fromEnv}, which does not exist — page measurement will use the estimate`);
    return (resolved = null);
  }
  for (const p of MAC_CANDIDATES) {
    if (existsSync(p)) return (resolved = p);
  }
  for (const name of PATH_CANDIDATES) {
    const p = findOnPath(name);
    if (p) return (resolved = p);
  }
  return (resolved = null);
}

export class ChromeUnavailableError extends Error {
  constructor() {
    super(
      "No Chrome/Chromium found to measure the résumé with. Install Google Chrome, or set CHROME_BIN to a Chrome-based browser binary.",
    );
    this.name = "ChromeUnavailableError";
  }
}

/**
 * @param {string} html - a complete standalone HTML document
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [opts] - the signal
 *   defaults to the running background task's, so cancelling the task
 *   tears the browser down too.
 * @returns {Promise<Buffer>} the rendered PDF
 */
export async function htmlToPdf(html, { timeoutMs = 30_000, signal = currentTask()?.signal } = {}) {
  const bin = findChrome();
  if (!bin) throw new ChromeUnavailableError();
  return chromeSemaphore.withSlot(() => renderPdf(bin, html, { timeoutMs, signal }), { signal });
}

async function renderPdf(bin, html, { timeoutMs, signal }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "resume-pdf-"));
  const htmlPath = path.join(dir, "document.html");
  const pdfPath = path.join(dir, "document.pdf");

  try {
    await writeFile(htmlPath, html, "utf8");

    const args = [
      "--headless=new",
      "--disable-gpu",
      `--user-data-dir=${path.join(dir, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      // Page margins and paper size come from the document's own @page
      // rule; these suppress Chrome's default URL/date furniture. The
      // older flag name is kept for Chrome builds that predate the rename
      // (unknown flags are ignored).
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=5000",
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ];

    // Chrome (152 on macOS, at least) writes the PDF and then keeps
    // running instead of exiting, so waiting on 'exit'/'close' would hang
    // every render until the timeout. Watch for the finished file
    // instead, then take the browser down ourselves. It is spawned
    // detached so the kill reaches its renderer/GPU children too.
    const child = spawn(bin, args, { stdio: "ignore", detached: true });
    let launchError = null;
    child.on("error", (e) => {
      launchError = e;
    });

    try {
      const pdf = await waitForPdf(pdfPath, { timeoutMs, failed: () => launchError, signal });
      return pdf;
    } catch (e) {
      if (launchError) throw new Error(`Failed to launch Chrome at ${bin}: ${launchError.message}`);
      throw e;
    } finally {
      killTree(child);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Polls for a complete PDF at `pdfPath`, judging completeness by the
 * %%EOF trailer rather than by the browser's exit. */
async function waitForPdf(pdfPath, { timeoutMs, failed, signal }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new TaskCancelledError();
    if (failed()) break;
    if (existsSync(pdfPath)) {
      const buf = await readFile(pdfPath).catch(() => null);
      // A PDF is only complete once its trailer has been written; until
      // then we are looking at a partial flush.
      if (buf && buf.length > 0 && buf.subarray(-1024).includes("%%EOF")) return buf;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome produced no complete PDF within ${timeoutMs}ms`);
}

/** SIGKILLs the browser and every process it spawned. */
function killTree(child) {
  if (!child.pid) return;
  try {
    // Negative pid targets the whole process group, which only exists
    // because the child was spawned detached.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/**
 * Page count of a PDF, read straight from the object graph.
 *
 * Chrome's PDF writer emits the page tree uncompressed, so the /Count on
 * the root /Pages node is readable without a full parser. Falls back to
 * counting individual page objects, and returns null if neither shape is
 * recognisable rather than guessing.
 *
 * @param {Buffer} buf
 * @returns {number|null}
 */
export function pdfPageCount(buf) {
  const text = buf.toString("latin1");

  // Key order inside the dictionary isn't guaranteed, so look at each
  // /Pages object's body and pull its /Count from either side.
  let best = null;
  for (const match of text.matchAll(/<<([^>]*\/Type\s*\/Pages[^>]*)>>/g)) {
    const count = /\/Count\s+(\d+)/.exec(match[1]);
    if (count) {
      const n = Number(count[1]);
      if (best === null || n > best) best = n;
    }
  }
  if (best !== null) return best;

  const pageObjects = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return pageObjects ? pageObjects.length : null;
}
