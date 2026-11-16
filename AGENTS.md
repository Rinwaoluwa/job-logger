# AGENTS.md

Guide for a coding agent (Claude Code or similar) working in this repository on behalf of its new owner.

## What this is

A local, single-user job-application assistant. It pulls job postings, scores fit, writes tailored résumés, cover letters and application answers, prepares interviews, tracks applications and finds people to contact at a company.

Every generated document is grounded in a hand-maintained knowledge base in `profile/`. The model may add material the profile does not contain, but it must flag it as `inferred`, and the user accepts or rejects it in a review panel before export.

The app was built by someone else for their own job search and shared as a copy. **All personal content has been removed.** What ships in `profile/` is a fictional sample person, "Alex Morgan". Your first job is to help the new owner replace it with their own.

## First run: ask the owner for their content

Do not generate documents for the owner until the sample profile is replaced. Do not invent any of this content; ask for it.

Start by asking for their current résumé or LinkedIn export, then interview them role by role. Write their answers into the files below, following the formats in `profile/README.md`. Run `npm run profile:check` after each file; it lists unanswered `<ask>` placeholders, draft stories, unverified metrics, duplicate ids and broken references.

| File | Ask the owner for |
|---|---|
| `profile/facts.md` | Full name, phone, email, city, LinkedIn, GitHub, portfolio. Target job titles, seniority, locations, salary floor and range, commute limits, notice period. Work authorization per country and willingness to relocate. Every job with exact title, dates and employment type. How to explain any overlapping jobs or gaps. Education, certifications, years of experience to state. Why they are looking and where they want to be in three to five years. Anything that must never appear on a document. |
| `profile/roles/NN-slug.md` (one per job) | What the company and product were and who used them. Team size and their part in it. What they personally built. Technologies they actually used, with honest limits ("consumed the API, did not write it"). Numbers they can defend, each confirmed before you mark it `verified: yes`. Three to six STAR stories per role, each with a 60 to 90 second spoken version. What they must not claim on that role. |
| `profile/skills.md` | Each skill, an honest proficiency (`expert`, `strong`, `working`, `familiar`) and the role ids where it was used. Buzzwords they are happy or unwilling to use. |
| `profile/behavioral.md` | One story per heading: leadership, conflict, failure, prioritisation, ambiguity, learning fast, feedback, proudest achievement, changing course, difficult feedback, pushing back on a deadline, cross-team work. |
| `profile/projects.md` | Side projects, and whether each may be mentioned in prose. Optional. |
| `profile/proposed-work.md` | Optional and sensitive: plausible work they did not do, offered to the résumé's gap-fill planner. Explain what it is and ask whether they want it at all. If not, delete every entry. |

Rules while interviewing:

- Role ids (`id:` in each role file) are short lowercase slugs and prefix every story and metric id (`acme-s1`, `acme-m1`). Remove the sample files `01-northwind.md` and `02-brightpay.md` once real roles exist.
- Mark a story `Status: verified` and a metric `verified: yes` only after the owner confirms it. Anything you drafted from a résumé stays `draft` or `verified: no` until then. The pipeline never uses a draft story's numbers.
- If the owner is unsure of a number, leave it out. Write `- none — do not put numbers on this role` if a role has none.

Then ask about the settings outside `profile/`:

- `config/sources.json`: job titles to search, title filters, target locations, which job boards to enable, and any company boards to follow. See `config/README.md`. Every adapter is disabled in the shared copy.
- `.env` (copy from `.env.example`): Adzuna keys if they want that source; whether to enable the LinkedIn reader (see Risks).
- The folder where they keep résumé files, for the attachment picker. It defaults to `~/Documents/Generate Resumes` and is changed through the `attachments.source_folder` setting.

## Assumptions baked into the code

The original owner was a male full-stack software engineer in Canada looking at Canadian and US-remote roles. These places assume that and need changing if the new owner differs. Ask before editing prompts.

| Where | Assumption |
|---|---|
| `server/ai/prompts/*.js` | Prompts say "one specific software engineer" and refer to the candidate as "he". |
| `server/ai/prompts/system.js` (`FEW_SHOT_BULLETS` and the summary examples) | Example bullets are written for web engineering roles at fictional employers. They are marked as illustrations; for best results rewrite them from the owner's verified profile. |
| `server/ai/prompts/peopleSearch.js` (`OUTREACH_FORMATS`, the LinkedIn note, the GOOD and BAD examples) | Example outreach messages introduce "Alex, a full-stack engineer based in Vancouver". Real drafts take facts from the profile, but the examples set the shape and tone. |
| `server/ai/prompts/jdAnalysis.js:17` | Red flags hard-code "3-8 years of experience" and onsite work outside the "Greater Vancouver Area". |
| `server/sources/normalize.js:28` | Country detection only knows Canada and the US. |
| `server/sources/adapters/arbeitnow.js:11`, `remotive.js:10`, `jobicy.js:36`, `muse.js:38` | Location allow-lists and defaults are Canada and US. |
| `server/profile/render.js:143` | Work authorization is rendered from the `canada` and `usa` keys of `facts.md`. Other countries need a code change here. |
| `profile/facts.md` targets | Salary keys are named in CAD (`salary_floor_cad`). The key names are free-form; the Profile tab prints whatever keys exist. |

## Running it

Requirements: Node 22.5 or newer (the database is the built-in `node:sqlite`), the `claude` CLI installed and signed in, and Chrome, Chromium, Edge or Brave for page measurement.

```bash
npm install
cp .env.example .env
npm run dev            # API on 127.0.0.1:8787, Vite on localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Express API and Vite dev server together. |
| `npm run build` then `npm start` | One process serving the built app and the API. |
| `npm run profile:check` | Parses `profile/` and prints warnings. Run after every profile edit. |
| `npm test` | Vitest. |
| `npm run lint` | ESLint over `src`, `server`, `shared`. |
| `npm run db:reset` | Deletes the SQLite database. Destructive: confirm with the owner first. |

`npm run sources:refresh` points at `server/scripts/refresh.js`, which does not exist. Use the "Refresh sources" button in the Jobs view instead.

AI calls shell out to the `claude` CLI in headless mode and bill the owner's Claude subscription. There is no API key. Each call is logged with its cost in the `ai_calls` table and shown in the sidebar.

## Layout

| Path | Contents |
|---|---|
| `profile/` | The knowledge base. Markdown, hand-edited, parsed by `server/profile/parse.js`. Cached by file mtime, so a save is picked up on the next request. |
| `config/sources.json` | Job sources, queries, filters. Read once at startup. |
| `server/index.js` | Express entry point. Mounts every router under `/api`. |
| `server/config.js` | All environment variables and defaults. |
| `server/ai/claude.js` | The single wrapper around the `claude` CLI: structured output against a zod schema, one retry, cost logging, cancellation. |
| `server/ai/prompts/` | Prompt text per pipeline; `system.js` holds the shared system prompt, style guide, banned phrases and few-shot examples. |
| `server/ai/pipelines/` | Multi-stage pipelines: `tailorResume`, `finishResume`, `reviseResume`, `coverLetter`, `answerQuestion`, `fitAnalysis`, `interviewPrep`, `mockCritique`, `extractJob`, `peopleSearch`. |
| `server/ai/lint.js`, `verify.js`, `coverage.js`, `resumePatch.js` | Deterministic checks and patch merging that run around the model calls. |
| `server/tasks/` | Background task worker. Every long operation is a row in the `tasks` table; handlers are in `handlers.js`. |
| `server/sources/` | Job board adapters, link ingestion, normalisation, de-duplication. |
| `server/people/` | The LinkedIn reader: a dedicated Chrome profile driven over the DevTools protocol, exposed to the CLI through a small MCP server. |
| `server/render/` | PDF (pdfkit) and `.docx` export, and headless-Chrome page measurement. |
| `server/db/` | SQLite access. `migrations.js` is the schema; `repo/` has one module per table. |
| `server/routes/` | One Express router per area. |
| `shared/` | Code imported by both server and browser: résumé layout, HTML template, filenames, review resolution, task definitions. |
| `src/` | React UI. `views/` holds the seven tabs; `components/` is grouped by area; `hooks/` holds data hooks; `styles/` is plain CSS with design tokens in `tokens.css`. |
| `data/` | Created at runtime and git-ignored: the database, the LinkedIn Chrome profile, Jack & Jill imports. |

`README.md` describes the features in depth. `profile/README.md` and `config/README.md` document those two formats.

## Conventions

- ES modules throughout, no TypeScript. Request and model output shapes are zod schemas (`server/ai/schemas.js`).
- New long-running work goes through the task system (`shared/tasks.js`, `server/tasks/handlers.js`), not a long HTTP request.
- Every model call goes through `runClaude` in `server/ai/claude.js`. Do not spawn the CLI anywhere else.
- Schema changes are appended to `server/db/migrations.js`; never edit an applied migration.
- Styles use the tokens in `src/styles/tokens.css`; no hex colours or inline styles in JSX.
- The truth rules are the point of the app. Do not weaken the `inferred` flagging, the do-not-claim lists or the verified-metric rule to make output look better.

## Risks to tell the owner about

- **No authentication.** The server binds to `127.0.0.1` and refuses anything else unless `ALLOW_REMOTE=1`. It does not check the `Host` or `Origin` header, so a malicious web page using DNS rebinding could reach the API while the app is running. That would let it read the profile, start paid model runs, and read any `.pdf`, `.docx`, `.txt`, `.md` or `.html` file on disk by path through the attachment routes. Adding a middleware in `server/index.js` that rejects requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` closes this. Offer to add it.
- **LinkedIn reader.** The People tab can read LinkedIn through a signed-in Chrome profile stored in `data/chrome-linkedin/`. Automated reading is against LinkedIn's terms and can get an account restricted. It is on by default; set `PEOPLE_LINKEDIN=0` in `.env` to turn it off. That folder holds a live session: never commit, copy or share it.
- **Gap fills.** By design the résumé writer may add invented but plausible bullets for requirements the profile does not cover. They are labelled and sit in the review panel, but they are on the page unless rejected. Make sure the owner understands this before they send a résumé.
- **Cost.** A tailored résumé is several model calls; a people search can spend up to `PEOPLE_MAX_COST_USD` (default 6). Concurrency and caps are in `.env.example`.
- **Dependencies.** `npm audit` reported advisories in `body-parser`, `proxy-addr`, `qs` and `zod` when this copy was made. `npm audit fix` resolves them.
- **`data/` and `.env` are private.** They hold the owner's applications, generated documents and browser session. Keep them out of git and out of anything shared.
