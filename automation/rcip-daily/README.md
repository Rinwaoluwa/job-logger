# Daily RCIP & AIP job email

Runs once a day on this Mac. It searches for software developer jobs at
designated employers under Canada's Rural Community Immigration Pilot (RCIP),
the Atlantic Immigration Program (AIP), Alberta's Accelerated Tech Pathway and
Saskatchewan's Tech Talent Pathway, and emails the results to Peter.

| File | What it is |
|---|---|
| `prompt.md` | The search instructions and the HTML email template, in plain English. Edit this to change what is searched or how the email looks. |
| `run.sh` | Runs `claude -p` headless with only web tools and Gmail. Writes a log per run and skips a second run on the same day unless given `--force`. |
| `cloud.md`, `fetch.sh` | The cloud version: runbook for a scheduled claude.ai/code session, and a curl page reader for it (see below). |
| `com.peter.rcip-jobs.plist` | The launchd schedule: 11:00 local time, with retries at 13:00 and 16:00 that do nothing once the day's email is confirmed sent. A missed time runs on wake. |

## Install on a Mac

The live copy runs from `~/.rcip-jobs`, not from this folder: macOS does not
let launchd jobs read `~/Downloads`, so symlinks into the project fail with
"can't open input file". Copy the files, and copy them again after editing:

```bash
mkdir -p ~/.rcip-jobs/logs
cp automation/rcip-daily/prompt.md automation/rcip-daily/run.sh ~/.rcip-jobs/
cp automation/rcip-daily/com.peter.rcip-jobs.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.peter.rcip-jobs 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peter.rcip-jobs.plist
```

Optional Adzuna keys go in `~/.rcip-jobs/secrets.env` (`ADZUNA_APP_ID=` and
`ADZUNA_APP_KEY=` lines), which is outside the repo.

A run counts as done only when the model ends with `EMAIL_SENT <id>`; anything
else leaves the day open for the next retry.

The plist has absolute paths for user `openspace`; change them on another Mac.
Requires the `claude` CLI signed in to an account with the Gmail connector.
The run happens from `~/.rcip-jobs`, outside this repo, so the repo's
`CLAUDE.md` and `AGENTS.md` are not loaded into the search.

## Run in the cloud instead (no Mac needed)

A scheduled task on claude.ai/code starts a fresh cloud session every day at
10:32 Lagos time. It follows `cloud.md`, which reuses `prompt.md` and adds:

- **Gmail drafts.** For each qualifying job with a published application email,
  it saves a Gmail draft addressed to the employer, with the Step 6b note as the
  body and `Peter-A-Odejobi.docx` (from Google Drive) attached. Nothing is sent
  to an employer: you open the draft from the digest, check it, and press Send.
- **`fetch.sh`.** WebFetch does not work in cloud containers, so pages are read
  with curl through the session proxy. canada.ca does not answer from cloud
  machines; IRCC status comes from WebSearch on that day.
- **Step 0.** It does nothing if today's digest has already been sent, so a
  manual run and the scheduled one do not double up.

Manage the schedule under Scheduled tasks on claude.ai/code ("RCIP & AIP daily
job search"). It needs the Gmail and Google Drive connectors switched on in
that task's settings.

The scheduled session does not read this repository. It downloads one file
from Google Drive, `rcip-daily-cloud-runbook.md` (next to the résumé), which is
`fetch.sh`, `cloud.md` and `prompt.md` joined into one text. After editing any
of the three here, rebuild that file and upload it over the Drive copy (ask
Claude to "rebuild the cloud runbook"). If the cloud task
is on, stop the Mac job so you do not get two digests:

```bash
launchctl bootout gui/$(id -u)/com.peter.rcip-jobs
```

To change the résumé, upload a new file to Drive and put its file id in
`cloud.md` Step 0b.

## Use

```bash
~/.rcip-jobs/run.sh --force          # run now
ls ~/.rcip-jobs/logs                 # one log per run
launchctl bootout gui/$(id -u)/com.peter.rcip-jobs   # stop the daily schedule
```
