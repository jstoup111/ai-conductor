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

# resolve_prompt [tier] — echo the path to prompts/<tier>.md for a tier arg
# (s|m|l or small|medium|large). With no arg: if stdin is a TTY, interactively
# prompts "Which prompt? [s/m/l]"; if not a TTY, prints usage and returns
# non-zero rather than silently defaulting. Unknown tiers print usage and
# return non-zero.
resolve_prompt() {
  local tier="${1:-}"

  if [ -z "$tier" ]; then
    if [ -t 0 ]; then
      read -r -p "Which prompt? [s/m/l] " tier
    else
      echo "Usage: resolve_prompt <s|m|l|small|medium|large>" >&2
      return 1
    fi
  fi

  case "$tier" in
    s|small) echo "prompts/small.md" ;;
    m|medium) echo "prompts/medium.md" ;;
    l|large) echo "prompts/large.md" ;;
    *)
      echo "Usage: resolve_prompt <s|m|l|small|medium|large>" >&2
      return 1
      ;;
  esac
}

# run_with_timeout <secs> <cmd...> — run cmd, killing it (and returning
# non-zero) if it is still running after <secs>. Prefers the system
# `timeout` binary (coreutils / macOS via `gtimeout`); falls back to a
# portable bash-only watchdog if neither is on PATH.
run_with_timeout() {
  local secs="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
    return $?
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
    return $?
  fi

  "$@" &
  local cmd_pid=$!
  (
    sleep "$secs"
    kill -TERM "$cmd_pid" 2>/dev/null
  ) &
  local watchdog_pid=$!

  local status
  wait "$cmd_pid"
  status=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  return "$status"
}

# assert_checkpoint <flow> <tier> <predicate> [reason] [timeout_secs] —
# evaluate <predicate> (a string eval'd as a shell command/test) via
# run_with_timeout. Prints "PASS <flow>/<tier>" and returns 0 if the
# predicate succeeds; prints "FAIL <flow>/<tier>: <reason>" and returns
# non-zero if it fails; prints "FAIL <flow>/<tier>: timeout" and returns
# non-zero if it is killed for exceeding <timeout_secs> (default 10).
assert_checkpoint() {
  local flow="$1"
  local tier="$2"
  local predicate="$3"
  local reason="${4:-checkpoint not met}"
  local timeout_secs="${5:-10}"

  run_with_timeout "$timeout_secs" bash -c "$predicate"
  local exit_code=$?

  if [ "$exit_code" -eq 0 ]; then
    echo "PASS ${flow}/${tier}"
    return 0
  fi

  if [ "$exit_code" -eq 124 ] || [ "$exit_code" -eq 137 ]; then
    echo "FAIL ${flow}/${tier}: timeout"
  else
    echo "FAIL ${flow}/${tier}: ${reason}"
  fi
  return 1
}
