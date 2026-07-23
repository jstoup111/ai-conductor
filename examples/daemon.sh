#!/usr/bin/env bash
# examples/daemon.sh — headless, self-asserting daemon flow example.
#
# Story 6 (.docs/stories/flow-examples.md, "daemon flow example (headless,
# seeded fixture)"): seeds the examples/fixtures/daemon/ fixture (an
# accepted story + plan) into an isolated sandbox repo, drains the daemon
# once against it, and asserts the feature reaches DONE with a recorded
# pr_url/local-commit.
#
# Usage: ./examples/daemon.sh <tier>

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixtures/daemon"

source "$SCRIPT_DIR/lib/common.sh"

TIER="${1:-}"

sandbox_up

cp -R "$FIXTURE_DIR/." "$SANDBOX_PROJECT_ROOT/"

cd "$SANDBOX_PROJECT_ROOT"

run_with_timeout 60 conduct-ts daemon >/tmp/examples-daemon.$$.log 2>&1
cat /tmp/examples-daemon.$$.log
rm -f /tmp/examples-daemon.$$.log

assert_checkpoint "daemon" "$TIER" \
  '[ -f .pipeline/events.jsonl ] && grep -q "feature_complete" .pipeline/events.jsonl && grep -q "prUrl" .pipeline/events.jsonl' \
  "feature did not reach DONE"
