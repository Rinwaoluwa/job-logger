# config/sources.json

Controls which job boards get queried by "Refresh sources" and what
titles/locations/filters apply. Safe to edit by hand; picked up on the
next refresh (no restart needed — server/config.js reads it once at
startup though, so a restart IS needed for changes to `boards` or
adapter `enabled` flags to take effect; runtime-only settings like
`fit.max_per_refresh` are read fresh each time).

## Adding a company's ATS board

Add the company's board slug to `boards.greenhouse`, `boards.lever`, or
`boards.ashby`. Verify the slug works before adding it:

```bash
# Greenhouse
curl -s "https://boards-api.greenhouse.io/v1/boards/<slug>/jobs" | head -c 300

# Lever
curl -s "https://api.lever.co/v0/postings/<slug>?mode=json&limit=1" | head -c 300

# Ashby
curl -s "https://api.ashbyhq.com/posting-api/job-board/<slug>" | head -c 300
```

A 200 response with job data confirms the slug. The slug is usually the
company's name as it appears in their careers page URL
(`https://boards.greenhouse.io/<slug>`, `https://jobs.lever.co/<slug>`,
`https://jobs.ashbyhq.com/<slug>`).

## Adzuna

Requires a free `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` in `.env` (sign up at
https://developer.adzuna.com). Without them, the adapter is skipped with
a console warning — everything else still works.

## Daily routine log (`routinelog`)

The "Jobs" routine on claude.ai runs every morning, picks postings
against the candidate's brief, and appends them to a Claude Doc called
"Job Search Log". The `routine` source reads that doc on every refresh
(and from the Jobs page's **Job Search Log** tab, whose "Read log" button
runs only this source) and turns each new line into a job.

```json
"routinelog": {
  "enabled": true,
  "claude_doc_id": "<the id at the end of the doc's claude.ai/code/artifact/… link>",
  "model": "haiku",
  "max_cost_usd": 0.25,
  "max_hydrate_per_refresh": 20
}
```

How the read works: a Claude Doc has no public export URL, so the app
asks the `claude` CLI (headless, the same binary the AI pipelines use) to
read the doc through the claude.ai **Claude Docs** connector and hand
back the day headings and their lines copied verbatim; the parsing is
done here. The CLI must be logged in to the claude.ai account that owns
the doc with the Claude Docs connector enabled (`claude mcp list` shows
"claude.ai Claude Docs: Connected"). Each read asks only for the latest
day already stored onward, so it costs about half a cent on `haiku`
(the model used for this read only; `max_cost_usd` caps one call). The
call shows in the AI cost log as `routine_log:read`.

Each job is one line in the doc, fields separated by a spaced em dash:

```
- Company — Title — Location — posted YYYY-MM-DD — salary <text> — Strong fit|Stretch|Jack & Jill — <url> — <note>
```

The routine's prompt asks for exactly this shape. Jobs from this source
skip the generic `filters` (the routine already judged fit), show
`source: routine` in the drawer, carry the `routine` tag plus
`strong-fit` or `stretch`, and the routine's note shows under the title
on the tab. Descriptions come from the ATS API or a page fetch with no AI
call; when neither works (Indeed short links, for example) the job holds
the routine's summary and is marked truncated until you fetch or paste
the full posting.

`Jack & Jill` in the fit slot marks a line the routine took from Jack's
email. Its URL is a Jack & Jill page that needs a sign-in, so nothing is
fetched: the job is stored from the summary, tagged `jackandjill` as well
(so it lists on both tabs), and the Jack & Jill id inside the URL is
remembered. When the Jack & Jill export is next imported (below), the
record with that id is matched to this job, which then gets the
employer's posting as its "Open posting" link, Jack's take and the full
description; the drawer keeps a second link to the Jack & Jill page. If
the export was imported first, the routine line annotates that job
instead of adding a second one.

## Jack & Jill (`jackandjill`)

Jack & Jill (jackandjill.ai) matches postings to you but has no export.
Scrape the job list from its site as JSON and save it under
`data/jackandjill/` (any name, `.json`); the Jobs page's **Jack & Jill**
tab lists what is there and its "Import from file" button reads every
file in the folder. "Refresh sources" runs the importer too.

```json
"jackandjill": {
  "enabled": true,
  "path": "data/jackandjill",
  "max_age_days": 30
}
```

A file is a JSON array of Jack & Jill job records (or an object whose
`jobs` / `data` / `results` / `items` key holds the array). Only these
fields are read, so a trimmed file works and extra fields are ignored:

| read                                   | becomes                                     |
|----------------------------------------|---------------------------------------------|
| `company`, `position` (or `title`)     | company, title — the only required fields   |
| `external_url` (`utm_*` stripped)      | the job URL; null → an internal `jackandjill:<id>` URL |
| `apply_href`, `company_domain`         | apply link fallback                         |
| `location`, `job_data_attributes.city` | location                                    |
| `job_data_attributes.work_mode`        | remote / hybrid / onsite                    |
| `salary_parsed`, else `salary_estimated` | salary text (the estimate is marked "est.") |
| `job_description` (markdown)           | description, as plain text                  |
| `description_summary`, `jacks_take`    | shown in the drawer and under the title     |
| `posted_at`, else `created_at`         | posted date                                 |
| `id`                                   | remembered so the same record never imports twice |

Jack & Jill's own application stage (`candidate_application_stage`) is
deliberately ignored: the pipeline stage in this app is yours.

The importer is trusted (no title filter). Age still applies, with its
own cutoff: `max_age_days` (default: `filters.max_age_days`, else 30; `0`
disables). A record posted longer ago than that is skipped, and a Jack &
Jill job already in the app that has aged past it is deleted on each
import, with a tombstone, unless you saved it, applied, or generated
documents for it. Raising the cutoff later does not bring deleted jobs
back. A record whose URL,
Jack & Jill id (also when it is the id inside a routine-log line's Jack &
Jill page link), or company + title already exists — from a board, "add
by link", the routine log or an earlier import — is not inserted again;
the existing job gains the `jackandjill` tag, Jack's take and, when its
own link was a Jack & Jill page, the employer's posting as its apply
link, so it shows on the tab and opens where you can apply. A job
you delete in the app leaves a tombstone and is not re-imported ("Add by
link" still brings it back on purpose). One unreadable file does not
stop the others; its error shows on the tab. Fit scoring is queued for
up to `fit.max_per_refresh` new jobs per import.

Changing `enabled`, `path` or `max_age_days` needs a server restart; the
folder is re-read on every import.
