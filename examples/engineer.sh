#!/usr/bin/env bash
# examples/engineer.sh — headless primitives + guided full-loop engineer
# flow example.
#
# Story 7 (.docs/stories/flow-examples.md, "engineer flow example (headless
# primitives + guided full loop)"): seeds the examples/fixtures/engineer/
# fixture (an accepted stories/plan set with no DRAFT ADR) into an isolated
# sandbox repo, then drives the headless `engineer worktree` -> `engineer
# land` -> `engineer handoff` primitives directly and asserts the flow
# reaches `pr-opened` or `local-commit`.
#
# With --interactive: guided launcher that execs the real `conduct-ts
# engineer` loop (stdio inherited) after sandbox setup, instead of driving
# the headless primitives itself.
#
# Usage: ./examples/engineer.sh <tier> [--interactive]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixtures/engineer"

source "$SCRIPT_DIR/lib/common.sh"

TIER="${1:-}"
INTERACTIVE=0
if [ "${2:-}" = "--interactive" ]; then
  INTERACTIVE=1
fi

sandbox_up

cp -R "$FIXTURE_DIR/." "$SANDBOX_PROJECT_ROOT/"

cd "$SANDBOX_PROJECT_ROOT" || exit 1

if [ "$INTERACTIVE" -eq 1 ]; then
  exec conduct-ts engineer
fi

WORKTREE_OUT="$(run_with_timeout 60 conduct-ts engineer worktree 2>&1)"
WORKTREE_STATUS=$?
if [ "$WORKTREE_STATUS" -eq 124 ]; then
  echo "FAIL engineer/${TIER}: timeout"
  exit 1
elif [ "$WORKTREE_STATUS" -ne 0 ]; then
  echo "FAIL engineer/${TIER}: worktree failed — ${WORKTREE_OUT}"
  exit 1
fi

LAND_OUT="$(run_with_timeout 60 conduct-ts engineer land 2>&1)"
LAND_STATUS=$?
if [ "$LAND_STATUS" -eq 124 ]; then
  echo "FAIL engineer/${TIER}: timeout"
  exit 1
elif [ "$LAND_STATUS" -ne 0 ]; then
  REASON="$(printf '%s\n' "$LAND_OUT" | tail -n 1)"
  echo "FAIL engineer/${TIER}: land rejected — ${REASON}"
  exit 1
fi

HANDOFF_OUT="$(run_with_timeout 60 conduct-ts engineer handoff 2>&1)"
HANDOFF_STATUS=$?
if [ "$HANDOFF_STATUS" -eq 124 ]; then
  echo "FAIL engineer/${TIER}: timeout"
  exit 1
elif [ "$HANDOFF_STATUS" -ne 0 ]; then
  echo "FAIL engineer/${TIER}: handoff failed — ${HANDOFF_OUT}"
  exit 1
fi

assert_checkpoint "engineer" "$TIER" \
  "case '${HANDOFF_OUT}' in *'\"kind\":\"pr-opened\"'*|*'\"kind\":\"local-commit\"'*) exit 0 ;; *) exit 1 ;; esac" \
  "handoff did not reach pr-opened/local-commit"
exit $?
