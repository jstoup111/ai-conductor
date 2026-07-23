#!/usr/bin/env bash
# examples/lib/common.sh — shared sandbox + prompt library for flow examples.
#
# sandbox_up / sandbox_down:
#   sandbox_up creates a throwaway root (mktemp -d) and points HOME,
#   AI_CONDUCTOR_REGISTRY, and AI_CONDUCTOR_ENGINEER_DIR at fresh
#   directories under it, then git-inits a project root at
#   "$SANDBOX_ROOT/repo" (exposed as $SANDBOX_PROJECT_ROOT). It registers
#   an EXIT trap that calls sandbox_down, so callers get automatic cleanup
#   even if the calling script exits early or errors.
#
#   sandbox_down removes exactly the single captured $SANDBOX_ROOT path
#   (never a glob, never an unquoted expansion) and never touches the
#   caller's real ~/.ai-conductor or original $HOME.

# sandbox_up — create an isolated sandbox and export HOME/registry/engineer
# dir + SANDBOX_PROJECT_ROOT under it. Registers sandbox_down on EXIT.
sandbox_up() {
  SANDBOX_ROOT="$(mktemp -d)"

  export HOME="$SANDBOX_ROOT/home"
  export AI_CONDUCTOR_REGISTRY="$SANDBOX_ROOT/registry"
  export AI_CONDUCTOR_ENGINEER_DIR="$SANDBOX_ROOT/engineer"
  SANDBOX_PROJECT_ROOT="$SANDBOX_ROOT/repo"

  mkdir -p "$HOME" "$AI_CONDUCTOR_REGISTRY" "$AI_CONDUCTOR_ENGINEER_DIR" "$SANDBOX_PROJECT_ROOT"

  git -C "$SANDBOX_PROJECT_ROOT" init -q

  trap sandbox_down EXIT
}

# sandbox_down — remove exactly the captured sandbox root. Safe to call
# multiple times (e.g. once explicitly, once via the EXIT trap).
sandbox_down() {
  local root="${SANDBOX_ROOT:-}"
  if [ -n "$root" ] && [ -d "$root" ]; then
    rm -rf -- "$root"
  fi
  SANDBOX_ROOT=""
}
