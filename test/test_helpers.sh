#!/usr/bin/env bash
# test_helpers.sh — shared fixtures for bash tests.
#
# rtk_fixture_setup / rtk_fixture_teardown:
#   Creates a fake `rtk` executable on a temp PATH and points $HOME at a
#   throwaway directory, so tests can exercise bin/install's rtk-init
#   handling without touching the real ~/.claude or requiring the real rtk
#   binary to be present.
#
# Usage in a test script:
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   source "$SCRIPT_DIR/test_helpers.sh"
#   rtk_fixture_setup
#   trap rtk_fixture_teardown EXIT
#   # ... exercise bin/install; it will pick up the fake rtk from PATH and
#   # the throwaway HOME automatically since rtk_fixture_setup exports both ...
#   rtk_fixture_init_count      # number of `rtk init` invocations so far
#   rtk_fixture_hook_present    # 0 if the marker hook entry is in settings.json
#
# The fake rtk, when invoked as `rtk init -g --auto-patch` (the exact
# invocation bin/install uses) or any other `rtk init ...` form, writes a
# known marker hook entry into $HOME/.claude/settings.json under
# hooks.PreToolUse, simulating what the real `rtk init` does to a Claude
# Code settings file, and increments a call counter. Non-`init` rtk
# invocations are silent no-ops (exit 0).

RTK_FIXTURE_MARKER_COMMAND="__RTK_INIT_HOOK_MARKER__"

# rtk_fixture_setup — create the fake rtk + throwaway HOME and export both.
rtk_fixture_setup() {
  RTK_FIXTURE_ROOT=$(mktemp -d)
  RTK_FIXTURE_BIN="$RTK_FIXTURE_ROOT/bin"
  RTK_FIXTURE_HOME="$RTK_FIXTURE_ROOT/home"
  RTK_FIXTURE_INIT_COUNT="$RTK_FIXTURE_ROOT/rtk_init_count"
  mkdir -p "$RTK_FIXTURE_BIN" "$RTK_FIXTURE_HOME"
  : > "$RTK_FIXTURE_INIT_COUNT"

  RTK_FIXTURE_ORIG_HOME="${HOME:-}"
  RTK_FIXTURE_ORIG_PATH="$PATH"

  cat > "$RTK_FIXTURE_BIN/rtk" << 'RTKEOF'
#!/usr/bin/env bash
set -euo pipefail

COUNT_FILE="__RTK_FIXTURE_INIT_COUNT__"
MARKER="__RTK_FIXTURE_MARKER_COMMAND__"

if [ "${1:-}" = "init" ]; then
  count=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
  echo $((count + 1)) > "$COUNT_FILE"

  settings_dir="${HOME}/.claude"
  settings_file="${settings_dir}/settings.json"
  mkdir -p "$settings_dir"

  python3 - "$settings_file" "$MARKER" << 'PYEOF'
import json, os, sys

settings_path, marker = sys.argv[1], sys.argv[2]

if os.path.exists(settings_path):
    with open(settings_path) as f:
        settings = json.load(f)
else:
    settings = {}

settings.setdefault("hooks", {}).setdefault("PreToolUse", [])

entries = settings["hooks"]["PreToolUse"]
already_present = any(
    h.get("command") == marker
    for entry in entries
    for h in entry.get("hooks", [])
)

if not already_present:
    entries.append({
        "matcher": "Bash",
        "hooks": [
            {"type": "command", "command": marker, "timeout": 10}
        ]
    })

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
PYEOF

  exit 0
fi

exit 0
RTKEOF

  # Bake the concrete paths/values into the fake rtk script. Placeholders
  # (rather than direct interpolation in the outer heredoc) keep the inner
  # python3 heredoc's quoting simple and avoid any escaping surprises.
  sed -i \
    -e "s#__RTK_FIXTURE_INIT_COUNT__#${RTK_FIXTURE_INIT_COUNT}#g" \
    -e "s#__RTK_FIXTURE_MARKER_COMMAND__#${RTK_FIXTURE_MARKER_COMMAND}#g" \
    "$RTK_FIXTURE_BIN/rtk"
  chmod +x "$RTK_FIXTURE_BIN/rtk"

  # python3 must stay REAL (settings.json is written via the json module),
  # but a version-manager shim (asdf/mise) resolves via $HOME, which the
  # throwaway HOME below breaks. Pin the concrete interpreter path, resolved
  # now under the real HOME, onto the fixture PATH.
  local py3
  py3="$(python3 -c 'import sys; print(sys.executable)')"
  ln -sf "$py3" "$RTK_FIXTURE_BIN/python3"

  export HOME="$RTK_FIXTURE_HOME"
  export PATH="$RTK_FIXTURE_BIN:$PATH"
}

# rtk_fixture_teardown — restore HOME/PATH and remove the throwaway root.
# Safe to call multiple times (e.g. via trap + explicit call at end of test).
rtk_fixture_teardown() {
  if [ -n "${RTK_FIXTURE_ORIG_HOME+x}" ]; then
    export HOME="$RTK_FIXTURE_ORIG_HOME"
  fi
  if [ -n "${RTK_FIXTURE_ORIG_PATH+x}" ]; then
    export PATH="$RTK_FIXTURE_ORIG_PATH"
  fi
  if [ -n "${RTK_FIXTURE_ROOT:-}" ] && [ -d "$RTK_FIXTURE_ROOT" ]; then
    rm -rf "$RTK_FIXTURE_ROOT"
  fi
  unset RTK_FIXTURE_ROOT RTK_FIXTURE_BIN RTK_FIXTURE_HOME RTK_FIXTURE_INIT_COUNT
  unset RTK_FIXTURE_ORIG_HOME RTK_FIXTURE_ORIG_PATH
}

# rtk_fixture_init_count — print the number of `rtk init` invocations so far.
rtk_fixture_init_count() {
  cat "$RTK_FIXTURE_INIT_COUNT" 2>/dev/null || echo 0
}

# rtk_fixture_hook_present — 0 (true) if the marker hook entry is present in
# the throwaway HOME's settings.json, 1 otherwise.
rtk_fixture_hook_present() {
  local settings_file="${RTK_FIXTURE_HOME}/.claude/settings.json"
  [ -f "$settings_file" ] || return 1
  grep -qF "$RTK_FIXTURE_MARKER_COMMAND" "$settings_file"
}

# examples_fixture_setup / examples_fixture_teardown — fake conduct-ts (and
# claude/gh) executables on PATH for the examples/ acceptance specs
# (.docs/stories/flow-examples.md). This is the SAME boundary-stub pattern as
# rtk_fixture_setup above: the real conduct-ts drives live Claude Code
# sessions, which an acceptance run cannot invoke (cost, latency,
# credentials) — so the fake stands in at the PATH boundary, records what it
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
  sed -i \
    -e "s#__ARGV_LOG__#${EXAMPLES_FIXTURE_ARGV_LOG}#g" \
    -e "s#__MODE_FILE__#${EXAMPLES_FIXTURE_MODE_FILE}#g" \
    "$EXAMPLES_FIXTURE_BIN/conduct-ts"
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
