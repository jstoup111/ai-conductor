#!/bin/bash
# StopFailure hook: fires when Claude hits a rate limit.
# Writes a marker file with timestamp and wait duration so conduct waits accurately.
set -e

MARKER=".pipeline/rate-limit-hit"
mkdir -p .pipeline

# Try to extract wait time from the error message (passed via stdin or env)
# Common patterns: "retry after 300 seconds", "try again in 5 minutes", "resets at HH:MM"
wait_seconds=""

# Check if CLAUDE_ERROR or last output contains retry info
error_text="${CLAUDE_ERROR:-}"
if [ -z "$error_text" ] && [ -f ".pipeline/conduct.log" ]; then
  error_text=$(tail -5 .pipeline/conduct.log 2>/dev/null || echo "")
fi

# Parse "retry after N seconds"
if echo "$error_text" | grep -qoiE "retry.*(after|in)\s*[0-9]+" 2>/dev/null; then
  wait_seconds=$(echo "$error_text" | grep -oiE "[0-9]+" | head -1)
  # If the number looks like minutes (< 60), convert to seconds
  if [ -n "$wait_seconds" ] && [ "$wait_seconds" -lt 60 ] 2>/dev/null; then
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
