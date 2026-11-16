import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { stripHtml } from "./html.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;
const MIN_READABILITY_CHARS = 500;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 job-app-assistant/1.0";

/** Recognized ATS hosts get routed to their JSON API instead of being
 * scraped as HTML — see routes/jobs.js from-link handling. */
export function detectAtsBoard(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("greenhouse.io") || u.hostname.includes("boards.greenhouse.io")) {
      const m = u.pathname.match(/\/([^/]+)\/jobs\/(\d+)/) || u.pathname.match(/^\/([^/]+)/);
      return m ? { board: "greenhouse", slug: m[1] } : null;
    }
    if (u.hostname.includes("lever.co")) {
      const m = u.pathname.match(/^\/([^/]+)/);
      return m ? { board: "lever", slug: m[1] } : null;
    }
    if (u.hostname.includes("ashbyhq.com")) {
      const m = u.pathname.match(/^\/([^/]+)/);
      return m ? { board: "ashby", slug: m[1] } : null;
    }
  } catch {
    // ignore malformed URLs
  }
  return null;
}

export async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
    const reader = res.body?.getReader?.();
    let html;
    if (reader) {
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) break;
        chunks.push(value);
      }
      html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    } else {
      html = await res.text();
    }

    let title = "";
    let text = "";
    try {
      const dom = new JSDOM(html, { url });
      const reader2 = new Readability(dom.window.document);
      const article = reader2.parse();
      if (article && article.textContent && article.textContent.trim().length >= MIN_READABILITY_CHARS) {
        title = article.title || "";
        text = article.textContent.trim();
      }
    } catch {
      // fall through to the stripHtml fallback below
    }

    if (!text) {
      const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
      const stripped = stripHtml(
        (bodyMatch ? bodyMatch[0] : html)
          .replace(/<nav[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[\s\S]*?<\/footer>/gi, ""),
      );
      text = stripped;
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : "";
    }

    return { title, text, html };
  } finally {
    clearTimeout(timeout);
  }
}
