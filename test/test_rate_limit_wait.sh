#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$HARNESS_DIR/hooks/claude/rate-limit-wait.sh"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

run_hook() {
  local fixture_dir=$1
  local payload=$2
  mkdir -p "$fixture_dir"
  (
    cd "$fixture_dir"
    printf '%s' "$payload" | "$HOOK" >/dev/null
  )
}

assert_wait() {
  local description=$1
  local fixture_dir=$2
  local expected=$3
  local actual
  actual=$(sed -n '2p' "$fixture_dir/.pipeline/rate-limit-hit")
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL %s: expected %s seconds, got %s\n' "$description" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$description"
}

SECONDS_FIXTURE="$TMP_ROOT/seconds"
run_hook "$SECONDS_FIXTURE" '{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"retry after 120 seconds","last_assistant_message":"API Error: Rate limit reached"}'
assert_wait 'StopFailure error_details seconds' "$SECONDS_FIXTURE" 120

SHORT_SECONDS_FIXTURE="$TMP_ROOT/short-seconds"
run_hook "$SHORT_SECONDS_FIXTURE" '{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"retry after 30 seconds"}'
assert_wait 'seconds below 60 are not treated as minutes' "$SHORT_SECONDS_FIXTURE" 30

MINUTES_FIXTURE="$TMP_ROOT/minutes"
run_hook "$MINUTES_FIXTURE" '{"hook_event_name":"StopFailure","error":"rate_limit","last_assistant_message":"Try again in 5 minutes"}'
assert_wait 'StopFailure last_assistant_message minutes' "$MINUTES_FIXTURE" 300

FALLBACK_FIXTURE="$TMP_ROOT/fallback"
run_hook "$FALLBACK_FIXTURE" '{"hook_event_name":"StopFailure","error":"rate_limit"}'
assert_wait 'unparseable StopFailure payload fallback' "$FALLBACK_FIXTURE" 300
