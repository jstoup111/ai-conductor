#!/usr/bin/env bash
# examples/intake-loop.sh — headless, self-asserting intake-loop flow
# example.
#
# Usage: ./examples/intake-loop.sh <s|m|l|small|medium|large>
#
# Spins up an isolated sandbox, seeds a pending envelope into the durable
# inbox (examples/fixtures/intake/seed.sh, plan Task 12), runs
# `conduct-ts intake-loop --once` under run_with_timeout, and asserts the
# run wrote intake-status.json into the sandbox engineer dir (see
# .docs/stories/flow-examples.md, Story 8). Prints PASS/FAIL and exits
# 0/non-zero accordingly.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

TIER="${1:-}"

if [ -z "$TIER" ]; then
  echo "Usage: intake-loop.sh <s|m|l|small|medium|large>" >&2
  exit 1
fi

sandbox_up

"$SCRIPT_DIR/fixtures/intake/seed.sh"

cd "$SANDBOX_PROJECT_ROOT" || exit 1

run_with_timeout 30 conduct-ts intake-loop --once

assert_checkpoint "intake-loop" "$TIER" \
  '[ -f "$AI_CONDUCTOR_ENGINEER_DIR/intake-status.json" ]' \
  "no intake-status.json"
exit $?
