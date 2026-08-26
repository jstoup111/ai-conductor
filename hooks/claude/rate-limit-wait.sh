#!/bin/bash
# StopFailure hook: fires when Claude hits a rate limit.
# Writes a marker file with timestamp and wait duration so conduct waits accurately.
set -e

MARKER=".pipeline/rate-limit-hit"
mkdir -p .pipeline

# Try to extract wait time from the StopFailure JSON payload.
# Common patterns: "retry after 300 seconds", "try again in 5 minutes", "resets at HH:MM"
wait_seconds=""

# StopFailure sends JSON on stdin. Keep the old environment/log sources as
# compatibility fallbacks for older hosts and direct script invocations.
payload=""
if [ ! -t 0 ]; then
  payload=$(head -c 1048576 2>/dev/null || true)
fi

error_text=""
if [ -n "$payload" ] && command -v python3 >/dev/null 2>&1; then
  error_text=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
parts = [payload.get("error_details"), payload.get("last_assistant_message")]
print("\n".join(part for part in parts if isinstance(part, str)))
' 2>/dev/null || true)
fi
if [ -z "$error_text" ]; then
  error_text="${CLAUDE_ERROR:-}"
fi
if [ -z "$error_text" ] && [ -f ".pipeline/conduct.log" ]; then
  error_text=$(tail -5 .pipeline/conduct.log 2>/dev/null || echo "")
fi

# Parse "retry after N seconds" and "try again in N minutes".
duration=$(printf '%s' "$error_text" \
  | grep -oiE "(retry|try again).*(after|in)[[:space:]]*[0-9]+[[:space:]]*(seconds?|minutes?)?" \
  | head -1 || true)
if [ -n "$duration" ]; then
  wait_seconds=$(printf '%s' "$duration" | grep -oE "[0-9]+" | tail -1)
  unit=$(printf '%s' "$duration" | grep -oiE "(seconds?|minutes?)" | tail -1 || true)
  if printf '%s' "$unit" | grep -qi '^minute'; then
    wait_seconds=$((wait_seconds * 60))
  elif [ -z "$unit" ] && [ -n "$wait_seconds" ] && [ "$wait_seconds" -lt 60 ] 2>/dev/null; then
    wait_seconds=$((wait_seconds * 60))
  fi
fi

# Parse "resets at HH:MM", "resets 11pm", "resets 11:00pm", or ISO timestamp
if [ -z "$wait_seconds" ] && echo "$error_text" | grep -qoiE "resets?\s*[0-9]" 2>/dev/null; then
  reset_epoch=""
  now_epoch=$(date +%s)

  # Try HH:MM format first (e.g., "resets at 23:00", "resets 23:00")
  reset_time=$(echo "$error_text" | grep -oiE "[0-9]{1,2}:[0-9]{2}\s*(am|pm)?" | head -1)
  if [ -n "$reset_time" ]; then
    reset_epoch=$(date -d "$reset_time" +%s 2>/dev/null || echo "")
  fi

  # Try bare hour with am/pm (e.g., "resets 11pm", "resets 3am")
  if [ -z "$reset_epoch" ] || [ "$reset_epoch" -le "$now_epoch" ] 2>/dev/null; then
    bare_time=$(echo "$error_text" | grep -oiE "[0-9]{1,2}\s*(am|pm)" | head -1)
    if [ -n "$bare_time" ]; then
      reset_epoch=$(date -d "$bare_time" +%s 2>/dev/null || echo "")
    fi
  fi

  # Calculate wait if we got a valid future time
  if [ -n "$reset_epoch" ] && [ "$reset_epoch" -gt "$now_epoch" ] 2>/dev/null; then
    wait_seconds=$((reset_epoch - now_epoch))
  # If parsed time is in the past, it might mean tomorrow
  elif [ -n "$reset_epoch" ] && [ "$reset_epoch" -le "$now_epoch" ] 2>/dev/null; then
    wait_seconds=$(( reset_epoch + 86400 - now_epoch ))
  fi
fi

# Fallback: 5 minutes (not 15)
if [ -z "$wait_seconds" ] || [ "$wait_seconds" -le 0 ] 2>/dev/null; then
  wait_seconds=300
fi

# Write marker: line 1 = timestamp, line 2 = wait seconds
echo "$(date +%s)" > "$MARKER"
echo "$wait_seconds" >> "$MARKER"

echo "Rate limit hit at $(date). Wait: ${wait_seconds}s. Marker: ${MARKER}"
exit 0
