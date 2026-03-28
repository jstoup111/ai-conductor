#!/bin/bash
# TDD Phase Gate — Pre-commit Hook
#
# Optional mechanical enforcement for the TDD skill.
# Ensures commits only happen during the COMMIT phase of the TDD cycle.
#
# Installation:
#   Copy or symlink to .git/hooks/pre-commit in your target project.
#   Or add to Claude Code settings.json hooks.
#
# How it works:
#   - Checks for a .pipeline/tdd-phase file that tracks the current TDD phase
#   - If the phase is not COMMIT, the commit is blocked
#   - If no .pipeline/tdd-phase file exists, the hook passes (opt-in enforcement)

TDD_PHASE_FILE=".pipeline/tdd-phase"

# If no phase file exists, this project isn't using mechanical TDD enforcement
if [ ! -f "$TDD_PHASE_FILE" ]; then
  exit 0
fi

CURRENT_PHASE=$(cat "$TDD_PHASE_FILE" | tr -d '[:space:]')

if [ "$CURRENT_PHASE" != "COMMIT" ]; then
  echo "TDD GATE: Commit blocked."
  echo "Current phase: $CURRENT_PHASE"
  echo "Commits are only allowed during the COMMIT phase."
  echo ""
  echo "Complete the current TDD cycle:"
  echo "  RED → DOMAIN → GREEN → DOMAIN → COMMIT"
  echo ""
  echo "To override (not recommended): git commit --no-verify"
  exit 1
fi

# Phase is COMMIT — allow the commit
exit 0
