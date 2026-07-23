#!/usr/bin/env bash
# examples/interactive.sh — guided launcher (Story 5).
#
# Usage: ./examples/interactive.sh <s|m|l|small|medium|large>
#
# Sets up a sandbox, resolves the prompt for the requested tier, prints the
# completion checkpoint to watch for, then execs `conduct-ts inline
# "<prompt>" --interactive` with stdio inherited so a human drives the REPL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

sandbox_up

PROMPT_FILE="$(resolve_prompt "${1:-}")"
PROMPT="$(cat "$SCRIPT_DIR/$PROMPT_FILE")"

echo "Checkpoint to watch for: feature_complete / DONE"

if ! command -v conduct-ts >/dev/null 2>&1; then
  echo "Error: conduct-ts not found on PATH" >&2
  exit 1
fi

exec conduct-ts inline "$PROMPT" --interactive
