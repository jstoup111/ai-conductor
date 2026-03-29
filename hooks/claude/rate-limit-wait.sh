#!/bin/bash
# StopFailure hook: fires when Claude hits a rate limit.
# Writes a marker file with timestamp so the conduct script knows to wait.
set -e

MARKER=".pipeline/rate-limit-hit"

# Write marker with current timestamp
mkdir -p .pipeline
echo "$(date +%s)" > "$MARKER"

# Calculate wait time — default 15 minutes, or read from env
WAIT_MINUTES=${RATE_LIMIT_WAIT:-15}

echo "Rate limit hit at $(date). Marker written to ${MARKER}. Conductor will wait ${WAIT_MINUTES} minutes."
exit 0
