#!/usr/bin/env node
// A tiny MCP server (JSON-RPC 2.0 over stdio) the people-search agent
// reaches LinkedIn through. The `claude` CLI launches one per search call
// via --mcp-config. It owns no browser: every read is forwarded to the
// app server (server/people/linkedinReader.js behind
// POST /api/people/linkedin/read), which keeps one signed-in Chrome for all
// the calls of a search round and paces the pages. So three agents reading
// LinkedIn at once share one browser, one page cap and one pause.
//
// Hand-rolled on purpose: four methods and three tools do not need an SDK,
// and the server must start fast inside a background task.
//
// Env: LINKEDIN_APP_URL (the app, e.g. http://127.0.0.1:8787),
// LINKEDIN_RUN_TOKEN (the search run the pipeline opened).

const appUrl = (process.env.LINKEDIN_APP_URL || "").replace(/\/$/, "");
const token = process.env.LINKEDIN_RUN_TOKEN || "";
const READ_TIMEOUT_MS = 90_000;

const TOOLS = [
  {
    name: "linkedin_people_search",
    description:
      "LinkedIn people search, signed in. Returns the visible results (names, headlines, locations) and each result's profile URL. Combine the company name with a title or team keyword, e.g. keywords=\"Affirm engineering manager\" or keywords=\"recruiter\" with company=\"Affirm\". One call is one page of results.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Search words: title, team, stack, city." },
        company: { type: "string", description: "Company name to add to the search words." },
      },
      required: ["keywords"],
    },
  },
  {
    name: "linkedin_company_people",
    description:
      "The People tab of a LinkedIn company page, filtered by keywords. Needs the company's LinkedIn slug (the part after linkedin.com/company/). Best for 'everyone at <company> whose headline says recruiter / engineering manager / <job title>'.",
    inputSchema: {
      type: "object",
      properties: {
        company_slug: { type: "string", description: "e.g. \"affirm\" for linkedin.com/company/affirm" },
        keywords: { type: "string", description: "Filter words: recruiter, talent, engineering manager, the job title, the city." },
      },
      required: ["company_slug"],
    },
  },
  {
    name: "linkedin_read",
    description:
      "Read one linkedin.com page while signed in: a profile (to confirm a current title and employer), a company page (to find its slug and website), or a company search like https://www.linkedin.com/search/results/companies/?keywords=<name>.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "A linkedin.com URL." } },
      required: ["url"],
    },
  },
];

function formatPage(page) {
  const links = page.links?.length
    ? `LINKS (${page.links.length}):\n${page.links.map((l) => `- ${l.label} — ${l.href}`).join("\n")}\n\n`
    : "LINKS: none visible\n\n";
  return `URL: ${page.url}\nTITLE: ${page.title}\n\n${links}PAGE TEXT${page.truncated ? " (truncated)" : ""}:\n${page.text}`;
}

async function readUrl(url) {
  if (!appUrl || !token) throw new Error("the LinkedIn reader is not configured for this run (no app URL or token)");
  let res;
  try {
    res = await fetch(`${appUrl}/api/people/linkedin/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, url }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`the LinkedIn reader did not answer (${e.message}); continue with web search`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `LinkedIn read failed (${res.status})`);
  return formatPage(body);
}

const enc = encodeURIComponent;

async function callTool(name, args = {}) {
  switch (name) {
    case "linkedin_people_search": {
      if (!args.keywords) throw new Error("keywords is required");
      const words = [args.company, args.keywords].filter(Boolean).join(" ");
      return readUrl(`https://www.linkedin.com/search/results/people/?keywords=${enc(words)}&origin=GLOBAL_SEARCH_HEADER`);
    }
    case "linkedin_company_people": {
      const slug = String(args.company_slug || "").trim().replace(/^.*linkedin\.com\/company\//, "").replace(/\/.*$/, "");
      if (!slug) throw new Error("company_slug is required");
      const q = args.keywords ? `?keywords=${enc(args.keywords)}` : "";
      return readUrl(`https://www.linkedin.com/company/${enc(slug)}/people/${q}`);
    }
    case "linkedin_read":
      if (!args.url) throw new Error("url is required");
      return readUrl(String(args.url));
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (id === undefined) return;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "linkedin", version: "2.0.0" },
      });
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "tools/call":
      try {
        const text = await callTool(params.name, params.arguments || {});
        reply(id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
      return;
    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg).catch((e) => {
      if (msg.id !== undefined) replyError(msg.id, -32000, e.message);
    });
  }
});

// stdin closing is the CLI hanging up; nothing to tear down here.
const shutdown = () => setTimeout(() => process.exit(0), 50).unref();
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
