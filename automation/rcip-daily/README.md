# Daily RCIP & AIP job email

Runs once a day on this Mac. It searches for software developer jobs at
designated employers under Canada's Rural Community Immigration Pilot (RCIP),
the Atlantic Immigration Program (AIP), Alberta's Accelerated Tech Pathway and
Saskatchewan's Tech Talent Pathway, and emails the results to Peter.

| File | What it is |
|---|---|
| `prompt.md` | The search instructions and the HTML email template, in plain English. Edit this to change what is searched or how the email looks. |
| `run.sh` | Runs `claude -p` headless with only web tools and Gmail. Writes a log per run and skips a second run on the same day unless given `--force`. |
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

## Use

```bash
~/.rcip-jobs/run.sh --force          # run now
ls ~/.rcip-jobs/logs                 # one log per run
launchctl bootout gui/$(id -u)/com.peter.rcip-jobs   # stop the daily schedule
```
