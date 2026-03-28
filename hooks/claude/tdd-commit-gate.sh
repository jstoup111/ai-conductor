#!/bin/bash
# Block git commits outside the COMMIT phase of TDD cycle.
# Opt-in: only active when .pipeline/tdd-phase exists.
set -e

TDD_PHASE_FILE=".pipeline/tdd-phase"

# If no phase file, TDD mechanical enforcement is not active — allow
if [ ! -f "$TDD_PHASE_FILE" ]; then
  exit 0
fi

CURRENT_PHASE=$(cat "$TDD_PHASE_FILE" | tr -d '[:space:]')

if [ "$CURRENT_PHASE" != "COMMIT" ]; then
  echo "TDD GATE: Commit blocked. Current phase: ${CURRENT_PHASE}. Commits only allowed during COMMIT phase. Complete the cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT" >&2
  exit 2
fi

exit 0
