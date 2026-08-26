#!/usr/bin/env bash
# test_helpers.sh - shared fixtures for bash tests.

rewrite_with_sed() {
  local target=$1
  shift
  local temp
  temp=$(mktemp "${target}.XXXXXX")
  if cp -p "$target" "$temp" && sed "$@" "$target" > "$temp"; then
    mv "$temp" "$target"
  else
    rm -f "$temp"
    return 1
  fi
}

# examples_fixture_setup / examples_fixture_teardown — fake conduct-ts (and
# claude/gh) executables on PATH for the examples/ acceptance specs
# (.docs/stories/flow-examples.md). The real conduct-ts drives live Claude Code
# sessions, which an acceptance run cannot invoke (cost, latency,
# credentials), so the fake stands in at the PATH boundary, records what it
# was called with, and produces the observable artifact (a `feature_complete`
# line in .pipeline/events.jsonl, engineer-cli JSON kinds, intake-status.json)
# the real binary would produce, controlled by examples_fixture_set_mode.
#
# Usage:
#   examples_fixture_setup
#   trap examples_fixture_teardown EXIT
#   examples_fixture_set_mode done   # or: nodone | reject | local-commit | hang
#   ... run an examples/*.sh script ...
#   examples_fixture_argv            # every `conduct-ts ...` invocation, one per line
#   examples_fixture_claude_invoked  # 0 (true) if the fake `claude` ran
#   examples_fixture_gh_invoked      # 0 (true) if the fake `gh` ran

EXAMPLES_FIXTURE_MODES="done nodone reject local-commit hang"

examples_fixture_setup() {
  EXAMPLES_FIXTURE_ROOT=$(mktemp -d)
  EXAMPLES_FIXTURE_BIN="$EXAMPLES_FIXTURE_ROOT/bin"
  EXAMPLES_FIXTURE_ARGV_LOG="$EXAMPLES_FIXTURE_ROOT/conduct-ts.argv.log"
  EXAMPLES_FIXTURE_MODE_FILE="$EXAMPLES_FIXTURE_ROOT/conduct-ts.mode"
  EXAMPLES_FIXTURE_CLAUDE_MARKER="$EXAMPLES_FIXTURE_ROOT/claude.invoked"
  EXAMPLES_FIXTURE_GH_MARKER="$EXAMPLES_FIXTURE_ROOT/gh.invoked"
  mkdir -p "$EXAMPLES_FIXTURE_BIN"
  : > "$EXAMPLES_FIXTURE_ARGV_LOG"
  echo "done" > "$EXAMPLES_FIXTURE_MODE_FILE"

  EXAMPLES_FIXTURE_ORIG_PATH="$PATH"

  cat > "$EXAMPLES_FIXTURE_BIN/conduct-ts" <<'CONDUCTEOF'
#!/usr/bin/env bash
set -uo pipefail
ARGV_LOG="__ARGV_LOG__"
MODE_FILE="__MODE_FILE__"
printf '%s\n' "$*" >> "$ARGV_LOG"
mode="$(cat "$MODE_FILE" 2>/dev/null || echo done)"

if [ "$mode" = "hang" ]; then
  sleep 300
  exit 0
fi

case "${1:-}" in
  inline|daemon)
    if [ "$mode" = "done" ]; then
      mkdir -p .pipeline
      printf '{"type":"feature_complete","prUrl":"https://example.invalid/pr/fixture"}\n' >> .pipeline/events.jsonl
    fi
    exit 0
    ;;
  intake-loop)
    if [ "$mode" = "done" ]; then
      : "${AI_CONDUCTOR_ENGINEER_DIR:?AI_CONDUCTOR_ENGINEER_DIR not set}"
      mkdir -p "$AI_CONDUCTOR_ENGINEER_DIR"
      printf '{"newIdeas":0}\n' > "$AI_CONDUCTOR_ENGINEER_DIR/intake-status.json"
    fi
    exit 0
    ;;
  engineer)
    sub="${2:-}"
    case "$sub" in
      worktree)
        echo '{"kind":"worktree","project":"fixture","idea":"fixture-idea","worktree":"/tmp/examples-fixture-worktree"}'
        exit 0
        ;;
      land)
        if [ "$mode" = "reject" ]; then
          echo "land: rejected — DRAFT ADR present" >&2
          exit 1
        fi
        echo '{"kind":"land"}'
        exit 0
        ;;
      handoff)
        if [ "$mode" = "local-commit" ]; then
          echo '{"kind":"local-commit"}'
        else
          echo '{"kind":"pr-opened","url":"https://example.invalid/pr/fixture"}'
        fi
        exit 0
        ;;
      *)
        exit 0
        ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac
CONDUCTEOF
  rewrite_with_sed "$EXAMPLES_FIXTURE_BIN/conduct-ts" \
    -e "s#__ARGV_LOG__#${EXAMPLES_FIXTURE_ARGV_LOG}#g" \
    -e "s#__MODE_FILE__#${EXAMPLES_FIXTURE_MODE_FILE}#g"
  chmod +x "$EXAMPLES_FIXTURE_BIN/conduct-ts"

  cat > "$EXAMPLES_FIXTURE_BIN/claude" <<CLAUDEEOF
#!/usr/bin/env bash
: > "${EXAMPLES_FIXTURE_CLAUDE_MARKER}"
exit 0
CLAUDEEOF
  chmod +x "$EXAMPLES_FIXTURE_BIN/claude"

  cat > "$EXAMPLES_FIXTURE_BIN/gh" <<GHEOF
#!/usr/bin/env bash
: > "${EXAMPLES_FIXTURE_GH_MARKER}"
exit 0
GHEOF
  chmod +x "$EXAMPLES_FIXTURE_BIN/gh"

  export PATH="$EXAMPLES_FIXTURE_BIN:$PATH"
}

# examples_fixture_set_mode <done|nodone|reject|local-commit|hang>
examples_fixture_set_mode() {
  echo "$1" > "$EXAMPLES_FIXTURE_MODE_FILE"
}

# examples_fixture_argv — every `conduct-ts <args>` invocation recorded so far.
examples_fixture_argv() {
  cat "$EXAMPLES_FIXTURE_ARGV_LOG" 2>/dev/null || true
}

examples_fixture_claude_invoked() {
  [ -f "$EXAMPLES_FIXTURE_CLAUDE_MARKER" ]
}

examples_fixture_gh_invoked() {
  [ -f "$EXAMPLES_FIXTURE_GH_MARKER" ]
}

examples_fixture_teardown() {
  if [ -n "${EXAMPLES_FIXTURE_ORIG_PATH+x}" ]; then
    export PATH="$EXAMPLES_FIXTURE_ORIG_PATH"
  fi
  if [ -n "${EXAMPLES_FIXTURE_ROOT:-}" ] && [ -d "$EXAMPLES_FIXTURE_ROOT" ]; then
    rm -rf "$EXAMPLES_FIXTURE_ROOT"
  fi
  unset EXAMPLES_FIXTURE_ROOT EXAMPLES_FIXTURE_BIN EXAMPLES_FIXTURE_ARGV_LOG
  unset EXAMPLES_FIXTURE_MODE_FILE EXAMPLES_FIXTURE_CLAUDE_MARKER EXAMPLES_FIXTURE_GH_MARKER
  unset EXAMPLES_FIXTURE_ORIG_PATH
}
