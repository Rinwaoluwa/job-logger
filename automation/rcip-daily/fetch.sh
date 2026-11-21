#!/usr/bin/env bash
# Fetch a URL from a cloud session and print it as plain text.
#
# The WebFetch tool cannot resolve hostnames in Claude Code cloud containers,
# but curl through the session's HTTPS proxy works. This wraps curl and turns
# HTML, PDF and JSON into text the model can read.
#
#   fetch.sh <url> [max_chars]     (default max_chars: 60000)
#
# Exit codes: 0 ok, 2 HTTP error or bot-check page, 3 network failure.

set -u
URL="${1:?usage: fetch.sh <url> [max_chars]}"
MAX="${2:-60000}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
read -r CODE CTYPE < <(curl -sL --compressed -m 40 -A "$UA" \
  -H 'Accept: text/html,application/xhtml+xml,application/json,application/pdf;q=0.9,*/*;q=0.8' \
  -H 'Accept-Language: en-CA,en;q=0.9' \
  -o "$TMP/body" -w '%{http_code} %{content_type}\n' "$URL" || echo "000 none")

if [[ "$CODE" == "000" ]]; then
  echo "FETCH_FAILED network error or timeout: $URL"
  exit 3
fi

if head -c 5 "$TMP/body" | grep -q '%PDF'; then
  pdftotext -layout "$TMP/body" - 2>/dev/null | head -c "$MAX"
elif [[ "$CTYPE" == *json* ]]; then
  (jq . "$TMP/body" 2>/dev/null || cat "$TMP/body") | head -c "$MAX"
else
  python3 - "$TMP/body" "$MAX" <<'PY'
import html, re, sys
raw = open(sys.argv[1], "rb").read().decode("utf-8", "replace")
title = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
t = re.sub(r"(?is)<(script|style|noscript|svg|head)\b.*?</\1>", " ", raw)
# Keep link targets: they matter for apply links and email addresses.
t = re.sub(r'(?is)<a\b[^>]*href="([^"#][^"]*)"[^>]*>(.*?)</a>', r" \2 [\1] ", t)
t = re.sub(r"(?i)<(br|/p|/div|/li|/tr|/h[1-6])\b[^>]*>", "\n", t)
t = re.sub(r"<[^>]+>", " ", t)
t = html.unescape(t)
t = re.sub(r"[ \t\r\f\v]+", " ", t)
t = re.sub(r"\n\s*\n+", "\n", t).strip()
if title:
    print("TITLE:", re.sub(r"\s+", " ", html.unescape(title.group(1))).strip())
print(t[: int(sys.argv[2])])
PY
fi

if [[ "$CODE" -ge 400 ]]; then
  echo
  echo "FETCH_HTTP_$CODE (blocked or missing): $URL"
  exit 2
fi
if grep -qiE 'radware|cf-chl|challenge-platform|captcha|Access Denied' "$TMP/body"; then
  echo
  echo "FETCH_BOT_CHECK (a bot-check page, not the real content): $URL"
  exit 2
fi
exit 0
