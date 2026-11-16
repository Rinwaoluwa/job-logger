# Job application assistant

A personal tool for generating tailored résumés, cover letters, and
application answers — grounded in a hand-maintained profile of your real
work, not invented by the model — plus a job pipeline that pulls postings
from several public APIs, scores fit against your profile, and tracks
applications.

## How it's different from a typical "AI résumé builder"

Every generated document must trace back to a story or verified metric in
`profile/`. The model may still suggest a plausible adjacent skill or
bullet that isn't in your profile, but it has to say so — every such
addition is tagged `inferred` and shown in a review panel where you accept
or reject it before anything is exported. Numbers only ever come from
metrics you've explicitly marked `verified: yes`. See `profile/README.md`
for the full convention.

Résumés and cover letters download as **PDF**, rendered server-side with
pdfkit from the same review decisions you made on screen, with a `.docx`
behind "More" for portals that ask for Word. The PDF writer matters: a
PDF printed from headless Chrome positions every character individually,
leaving no word-level text runs, so Apple's own extractor read the name
as "MORGAN ALEX JOR / DAN" and produced 41 mid-word splits in a
two-page résumé against 1 for the same content as `.docx`. pdfkit writes
each line as a real string, so a parser extracts it exactly, as it does
from Word. Chrome is still used headlessly, but only to measure page
count. Files are named after you and the job's company
(`Alex_Morgan_Shopify.pdf`, `Alex_Morgan_Cover_Letter_Shopify.pdf`).

Once a résumé exists you can tell the AI what to change ("shorten the
summary", "add a bullet on the Northwind role about the Azure DevOps pipeline",
"drop the Paystack bullet") from the Documents tab. Each instruction runs
as a background task, produces a new version with that change applied and
everything else kept, and records what the AI changed. The thread of
instructions on a résumé is shown beside it and sent back on every later
revision, so a later edit never undoes an earlier one. The truth rules
still apply: a requested claim the profile does not support is held for
review, and a do-not-claim term is declined.

You do not need a posting to get a résumé. The Résumés tab takes a job
title, optionally the skills you want to lead with, a company and a note,
and writes a résumé the same way a tailored one is written: a single
low-effort call turns the brief into the job analysis a posting would
produce (your skills as must-haves, the usual expectations for that title
as the rest), and the planner, writer, reviewer and page budget run
unchanged. Each run is kept as a hidden job (source `brief`), so it gets
the same versions, revisions, review panel and PDF/`.docx` exports, named
after the title (`Alex_Morgan_Senior_Frontend_Engineer.pdf`) since
there is no company. The tab lists every run with its progress, and
Delete removes the run and its documents. Briefs never appear on the
Jobs or Applications tabs.

Length is a first-class constraint: the résumé is held to one page
(`RESUME_MAX_PAGES`, default 1). Every draft is measured in Chrome, laid
out from the same spec as the PDF and `.docx` (`shared/resumeLayout.js`)
and set in the same typeface, EB Garamond (embedded in both exports), so
the measurement holds for the files you download. A draft that overruns
goes back for a trim rather than being shipped long, and as a last resort
the font steps down from 10pt to 9.5pt. Every role gets four bullets of
real work (about 20 on the page; the older roles one line each), and the
planner may add up to two invented, review-gated gap-fill bullets per role
(eight at most) for posting requirements the profile does not cover. When
a posting leads with a framework the profile lists on a role only with a
limiting note ("React (legacy apps, not the main build)"), the planner may
reframe that role: its frontend bullets are written in the posting's
framework, review-gated under one "Reframed:" label, with the real-stack
wording kept as the fallback a rejection restores. When the page
overflows, the two-line bullets on the top roles are tightened first; a
role never drops below three bullets.

Generation runs on the `claude` CLI in headless mode (`claude -p ...
--output-format json`), riding on your Claude Code subscription — no
separate API key.

The Profile tab is built for reading the knowledge base, not just
checking it. "All stories" lists every role and behavioural story in one
place, searchable and filterable by role and competency, with each
story's outcome visible before you open it and its spoken "Interview
version" beside the STAR fields once you do. "Rehearse" turns the same
stories into flashcards: a prompt built from the story's competency or
title, answer out loud, press space to reveal. Lists in the files render
as lists, every `brightpay-s7` / `gen-s6` / `brightpay-m8` in the text is a link, and
editorial asides like "(confirmed 2026-10-11)" are subdued. Every story,
metric and project has a hash (`#/profile/story/brightpay-s7`), so a link from
anywhere in the app lands on it.

A job's Interview tab prepares you from the posting and from the résumé
you actually sent. Before any AI runs it shows a story map — which
profile stories answer each requirement, and how well — taken from the
plan the résumé was written to. "Generate" (one Sonnet call, on demand)
adds the angle to take on each story, 10–14 likely questions with draft
answers linked to the stories behind them (each question can be rewritten
on its own, with a note), an opening pitch with "why this role" and "why
leave your current role", gap defenses for must-haves the profile lacks,
and a section on the résumé's invented gap-fill claims: for each, how
deep your real experience goes and the honest line to say if probed. The
fills are never used as facts in an answer.

Every long operation — preparing an application, interview prep, an
application answer, fit scoring, adding a job by link, refreshing sources —
is a background task. Start as many as you like and keep using the app; a
pill in the top bar ("2 running · 1 queued") opens an activity panel with
each task's stage progress, cost, and Cancel / Retry, and a toast (plus a
browser notification when the tab is hidden) tells you when one finishes.
Tasks are rows in SQLite, so a server restart re-queues whatever was
running instead of losing it. `TASK_CONCURRENCY`, `CLAUDE_CONCURRENCY` and
`CHROME_CONCURRENCY` in `.env` set how much runs at once.

## Getting started

```bash
npm install
cp .env.example .env   # fill in ADZUNA keys if you want that source; everything else has sane defaults
npm run dev             # runs the Express API (:8787) and Vite dev server (:5173) together
```

Open http://localhost:5173.

`profile/` ships with a fictional sample person ("Alex Morgan") so the app
runs out of the box. Before generating anything you intend to send, replace
every file in it with your own details; `profile/README.md` documents the
format and `npm run profile:check` lists what is still outstanding. If you
work with a coding agent, `AGENTS.md` tells it how to interview you for
this content.

Requirements: Node 22.5 or newer (the database uses the built-in
`node:sqlite`), the `claude` CLI installed and signed in, and Chrome,
Chromium, Edge or Brave for page measurement.

## Production

```bash
npm run build
npm start
```

Serves the built SPA and the API from one process on `HOST:PORT` (default
`127.0.0.1:8787`). The app has no authentication, so it refuses to bind to
anything other than `127.0.0.1`/`localhost` unless you set
`ALLOW_REMOTE=1` — only do that if you understand the exposure (it holds
your résumé, PII, and an unauthenticated AI relay).

## Layout

- `profile/` — the ground-truth knowledge base every generated document is built from. See `profile/README.md`.
- `shared/` — the résumé layout spec, HTML template, filename and review-resolution logic, imported by the browser preview and the server-side PDF/`.docx` exports so they can't drift apart.
- `server/render/` — pdfkit PDF and `.docx` generation (résumé and cover letter, EB Garamond embedded), and the headless-Chrome page-count measurement the tailor pipeline enforces its page budget with.
- `server/ai/` — the Claude CLI runner, prompts, schemas, deterministic lint/verify checks, and the multi-stage pipelines (tailor résumé, cover letter, application answers, fit analysis, interview prep).
- `server/tasks/` — the background task worker: one handler per task kind, a priority queue over the `tasks` table with a reserved slot for user-initiated work, and cancellation that kills the in-flight `claude`/Chrome processes.
- `server/sources/` — job board adapters (Adzuna, The Muse, Remotive, Jobicy, Arbeitnow, RemoteOK, Greenhouse/Lever/Ashby boards), the daily routine's Job Search Log (a Claude Doc read through the `claude` CLI's Claude Docs connector), the Jack & Jill file import, plus link-based ingestion, normalization, and de-duplication.
- `server/db/` — SQLite (via Node's built-in `node:sqlite`) storage for jobs, applications, generated documents, fit analyses, interview prep, background tasks, and an AI-call cost log.
- `config/sources.json` — which boards/queries/locations to pull from; see `config/README.md`.
- `src/` — the React UI: seven views in a left sidebar (Jobs, Applications, Interviews, Résumés, Answer, Profile, Insights); the Jobs tab has an "All jobs | Jack & Jill | Job Search Log" switch. Tailoring happens inside a job's drawer rather than in a separate view, and views stay mounted when you switch tabs so filters, drafts and open drawers survive. Running AI cost, the background-task pill and the theme toggle (light, dark or system) sit at the bottom of the sidebar.

## Data sources

Free, no-key sources: The Muse, Remotive, Jobicy, RemoteOK (attribution
required when it's the source of a listing — see the Activity tab),
Arbeitnow (EU-heavy, disabled by default). Adzuna requires a free
`ADZUNA_APP_ID`/`ADZUNA_APP_KEY` (https://developer.adzuna.com). Company
ATS boards (Greenhouse/Lever/Ashby) are opt-in per company slug in
`config/sources.json`. "Add by link" accepts any job posting URL and reads
it with Readability, or routes straight to the ATS API when the URL is a
recognized board. Jobs matched by Jack & Jill (jackandjill.ai) come in
from JSON you scrape and drop into `data/jackandjill/`; the Jobs tab's
"Jack & Jill" switch lists them with Jack's take, and they are ordinary
jobs otherwise (fit, tailoring, application tracking). The daily "Jobs"
routine on claude.ai logs its picks to a Claude Doc ("Job Search Log");
the app reads it through the `claude` CLI's Claude Docs connector and the
"Job Search Log" switch lists those, with the routine's note. A routine
pick that came from Jack & Jill links to a sign-in-only Jack & Jill page;
the next Jack & Jill import matches it by id and fills in the employer's
posting link. See `config/README.md`.

## Insights

The Insights view reads the application history back to you: the funnel
(applied, interviewing, offer, rejected, still open), the response rate and
the median days to a first reply, the same by channel, by source and by the
résumé version that was sent (no gap fills, with gap fills, reframed stack),
applications per week, the ones that have gone quiet with a "Follow up"
that opens them, outreach reply rates, and what the AI spend bought per
application and per call kind. Every rate shows its counts and is greyed
out under five observations; nothing is smoothed. A response is the first
move to interviewing, offer or rejected after the application, or a reply
logged on the People tab.

## Finding people

The People tab in a job's drawer looks for the likely hiring manager,
in-house recruiters and peers at the company, then drafts an email and a
LinkedIn note for each (profile facts only, never the résumé's gap fills).
The search is a multi-round agent loop on the `claude` CLI with WebSearch
and WebFetch (Opus, `config.people` in `server/config.js`, env
`PEOPLE_*`): a round is one call per role still short (hiring manager,
recruiters, peers), run in parallel so a round takes about as long as one
role's search; every call must try the company's own pages, blog bylines,
GitHub, press and talk pages and several web-query shapes, and logs what
it tried; the next round gets that log, the people already known and the
gaps still open, and runs while a target is short, up to three rounds or
$6 per search. The row is saved after every round, so a later timeout keeps
what was found. "Search deeper" builds on the job's last result (people
and their drafts are kept, leavers dropped); "Start fresh" does not. The
hints box (team, names, the company's site or LinkedIn page) is passed to
the search and remembered for the next run.

When LinkedIn is connected, the calls also get `linkedin_*` tools served
by a small stdio MCP server of the app's own (`server/people/linkedinMcp.js`)
that proxies to the server, which drives one dedicated Chrome profile
(`data/chrome-linkedin/`, never your everyday browser) over the DevTools
protocol for all the parallel calls: company People tabs, people search and
profile pages, one page at a time, with a page cap per search and a pause
between pages. "Connect LinkedIn" opens that profile on the login page; sign in,
then click "Check": it confirms the session inside that window and quits
it (on macOS closing a window leaves Chrome running, which would keep the
profile locked). Automated reading of LinkedIn while
signed in is against LinkedIn's terms and can get an account restricted;
`PEOPLE_LINKEDIN=0` turns it off.
