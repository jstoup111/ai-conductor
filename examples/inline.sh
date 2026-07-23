#!/usr/bin/env bash
# examples/inline.sh — headless, self-asserting inline flow example.
#
# Usage: ./examples/inline.sh <s|m|l|small|medium|large>
#
# Spins up an isolated sandbox, resolves the prompt fixture for the
# requested tier, runs `conduct-ts inline "<prompt>" --auto` inside it, and
# asserts the run reached the DONE marker (a `feature_complete` event in
# .pipeline/events.jsonl). Prints PASS/FAIL and exits 0/non-zero
# accordingly (see .docs/stories/flow-examples.md, Story 4).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

TIER="${1:-}"

PROMPT_PATH="$(resolve_prompt "$TIER")" || exit 1
PROMPT_FILE="$SCRIPT_DIR/$PROMPT_PATH"
PROMPT="$(cat "$PROMPT_FILE")"

sandbox_up

cd "$SANDBOX_PROJECT_ROOT" || exit 1

conduct-ts inline "$PROMPT" --auto

assert_checkpoint "inline" "$TIER" \
  '[ -f .pipeline/events.jsonl ] && grep -q "\"type\":\"feature_complete\"" .pipeline/events.jsonl' \
  "no DONE marker"
exit $?
