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

echo "=== start $(date) ===" >> "$LOG"
"$HOME/.local/bin/claude" -p "$(cat "$DIR/prompt.md")" \
  --model opus \
  --allowedTools "WebSearch" "WebFetch" \
    "mcp__claude_ai_Gmail__send_message" \
    "mcp__claude_ai_Gmail__search_threads" \
    "mcp__claude_ai_Gmail__get_thread" \
    "mcp__claude_ai_Gmail__get_message" \
  >> "$LOG" 2>&1
STATUS=$?
echo "=== end $(date) exit=$STATUS ===" >> "$LOG"
[[ $STATUS -eq 0 ]] && date +%Y-%m-%d > "$DIR/logs/last-success"

# Keep 60 days of logs.
find "$DIR/logs" -name "*.log" -mtime +60 -delete
exit $STATUS
