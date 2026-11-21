#!/bin/zsh
# Daily RCIP job search. Started by launchd (~/Library/LaunchAgents/com.peter.rcip-jobs.plist)
# at 11:00 local time; if the Mac was asleep then, it runs on wake.
# Runs Claude Code headless with web tools and Gmail only (no shell, no file edits).

DIR="$HOME/.rcip-jobs"
LOG="$DIR/logs/$(date +%Y-%m-%d_%H%M).log"
cd "$DIR" || exit 1

# Skip if an email was already sent today (e.g. a manual run before 11:00).
if [[ -f "$DIR/logs/last-success" && "$(cat "$DIR/logs/last-success")" == "$(date +%Y-%m-%d)" && "$1" != "--force" ]]; then
  echo "Already ran today; use --force to run again." >> "$DIR/logs/skipped.log"
  exit 0
fi

PROMPT="$(cat "$DIR/prompt.md")"

# Adzuna keys live in ~/.rcip-jobs/secrets.env (never in the repo). launchd
# jobs cannot read ~/Downloads, so nothing here may point into the project.
ENV_FILE="$DIR/secrets.env"
if [[ -f "$ENV_FILE" ]]; then
  ADZ_ID="$(grep -E '^ADZUNA_APP_ID=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' ')"
  ADZ_KEY="$(grep -E '^ADZUNA_APP_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' ')"
  if [[ -n "$ADZ_ID" && -n "$ADZ_KEY" ]]; then
    PROMPT+=$'\n\n## Adzuna API keys\n'"app_id=$ADZ_ID"$'\n'"app_key=$ADZ_KEY"
  fi
fi

echo "=== start $(date) ===" >> "$LOG"
"$HOME/.local/bin/claude" -p "$PROMPT" \
  --model opus \
  --disallowedTools "Agent" "Task" \
  --allowedTools "WebSearch" "WebFetch" \
    "mcp__claude_ai_Gmail__send_message" \
    "mcp__claude_ai_Gmail__search_threads" \
    "mcp__claude_ai_Gmail__get_thread" \
    "mcp__claude_ai_Gmail__get_message" \
  >> "$LOG" 2>&1
STATUS=$?
echo "=== end $(date) exit=$STATUS ===" >> "$LOG"
# Only a confirmed send counts. Otherwise the 13:00 and 16:00 retries run.
if [[ $STATUS -eq 0 ]] && grep -q "^EMAIL_SENT " "$LOG"; then
  date +%Y-%m-%d > "$DIR/logs/last-success"
else
  echo "No confirmed email in this run; a later retry will try again." >> "$LOG"
  STATUS=1
fi

# Keep 60 days of logs.
find "$DIR/logs" -name "*.log" -mtime +60 -delete
exit $STATUS
