# Daily RCIP & AIP job email

Runs once a day on this Mac. It searches for software developer jobs at
designated employers under Canada's Rural Community Immigration Pilot (RCIP)
and Atlantic Immigration Program (AIP), and emails the results to Peter.

| File | What it is |
|---|---|
| `prompt.md` | The search instructions and the HTML email template, in plain English. Edit this to change what is searched or how the email looks. |
| `run.sh` | Runs `claude -p` headless with only web tools and Gmail. Writes a log per run and skips a second run on the same day unless given `--force`. |
| `com.peter.rcip-jobs.plist` | The launchd schedule: daily at 11:00 local time, or on wake if the Mac was asleep. |

## Install on a Mac

```bash
mkdir -p ~/.rcip-jobs/logs
ln -sf "$PWD/automation/rcip-daily/prompt.md" ~/.rcip-jobs/prompt.md
ln -sf "$PWD/automation/rcip-daily/run.sh" ~/.rcip-jobs/run.sh
cp automation/rcip-daily/com.peter.rcip-jobs.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peter.rcip-jobs.plist
```

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
