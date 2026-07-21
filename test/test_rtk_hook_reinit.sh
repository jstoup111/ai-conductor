#!/usr/bin/env bash
set -euo pipefail

# test_rtk_hook_reinit.sh — RED-phase tests for issue #608 (RTK hook
# preservation across install/update).
#
# bin/install today only runs `rtk init -g --auto-patch` inside
# install_dependencies(), which is skipped in --update mode. This means an
# operator whose Claude Code settings.json lost its rtk hook entry (e.g. a
# settings reset, a merge conflict, manual edit) has no way to recover it via
# `bin/install --update` — only a full (non-update) install re-runs rtk init.
#
# This suite exercises the REAL bin/install as a subprocess (matching the
# precedent in test_install_worktree_guard.sh) with a mocked `rtk` on PATH
# (test_helpers.sh's rtk_fixture_*) and a throwaway $HOME. It never touches
# the real ~/.claude or requires the real rtk binary.
#
# Expected RED state (before T3 lands the fix):
#   S1 PASS, S2 FAIL (the bug), S3 PASS, S4 PASS, S5 PASS, S6 PASS.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_BIN="$HARNESS_DIR/bin/install"

source "$SCRIPT_DIR/test_helpers.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2 # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

# Run bin/install hermetically against whatever HOME/PATH are currently
# exported (rtk_fixture_setup exports both). Captures combined output to
# $OUT and exit code to $CODE. Stdin closed so no prompt can hang the test.
OUT=""
CODE=0
run_install() {
  set +e
  OUT=$("$INSTALL_BIN" "$@" --allow-worktree-root < /dev/null 2>&1)
  CODE=$?
  set -e
}

# Writes a settings.json under the fixture HOME with the given python dict
# literal merged in as "hooks".PreToolUse entries (used to seed
# pre-existing / custom hook state before running install).
seed_settings_hooks() {
  local pretooluse_entries_json=$1
  local settings_dir="${RTK_FIXTURE_HOME}/.claude"
  local settings_file="${settings_dir}/settings.json"
  mkdir -p "$settings_dir"
  python3 - "$settings_file" "$pretooluse_entries_json" << 'PYEOF'
import json, sys
settings_path, entries_json = sys.argv[1], sys.argv[2]
entries = json.loads(entries_json)
settings = {"hooks": {"PreToolUse": entries}}
with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
PYEOF
}

CUSTOM_HOOK_COMMAND="__OPERATOR_CUSTOM_HOOK__"

# ═══════════════════════════════════════════════════════════════════════════
# S1 — lost-entry restore on plain install
# ═══════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}S1 — lost-entry restore on plain install${NC}"

rtk_fixture_setup
trap rtk_fixture_teardown EXIT

# settings.json missing entirely (simulates a lost/reset settings file).
run_install
assert "S1: plain install exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
init_count="$(rtk_fixture_init_count)"
assert "S1: rtk init was invoked at least once" \
  "$([ "${init_count:-0}" -ge 1 ] 2>/dev/null; echo $?)"
assert "S1: rtk hook entry present after install" \
  "$(rtk_fixture_hook_present; echo $?)"

rtk_fixture_teardown
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# S2 — lost-entry restore on `bin/install --update` (no binary bootstrap)
# ═══════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}S2 — lost-entry restore on --update (THE BUG)${NC}"

rtk_fixture_setup
trap rtk_fixture_teardown EXIT

# settings.json missing entirely; rtk already "installed" (on PATH). Today,
# rtk init lives only inside install_dependencies(), which --update skips —
# so this is expected to FAIL until T3 lands.
run_install --update
assert "S2: --update install exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
init_count="$(rtk_fixture_init_count)"
assert "S2: rtk init was invoked under --update (currently fails — the bug)" \
  "$([ "${init_count:-0}" -ge 1 ] 2>/dev/null; echo $?)"
assert "S2: rtk hook entry present after --update (currently fails — the bug)" \
  "$(rtk_fixture_hook_present; echo $?)"

rtk_fixture_teardown
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# S3 — existing entry survives re-init (no duplication)
# ═══════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}S3 — existing entry survives re-init${NC}"

rtk_fixture_setup
trap rtk_fixture_teardown EXIT

seed_settings_hooks "[{\"matcher\": \"Bash\", \"hooks\": [{\"type\": \"command\", \"command\": \"${RTK_FIXTURE_MARKER_COMMAND}\", \"timeout\": 10}]}]"
run_install
assert "S3: install exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "S3: rtk hook entry still present after install" \
  "$(rtk_fixture_hook_present; echo $?)"
occurrences=$(grep -oF "$RTK_FIXTURE_MARKER_COMMAND" "${RTK_FIXTURE_HOME}/.claude/settings.json" | wc -l | tr -d ' ')
assert "S3: rtk hook entry not duplicated (exactly one occurrence)" \
  "$([ "$occurrences" -eq 1 ]; echo $?)"

rtk_fixture_teardown
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# S4 — operator custom hook preserved across install + update
# ═══════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}S4 — operator custom hook preserved${NC}"

rtk_fixture_setup
trap rtk_fixture_teardown EXIT

seed_settings_hooks "[{\"matcher\": \"Bash\", \"hooks\": [{\"type\": \"command\", \"command\": \"${CUSTOM_HOOK_COMMAND}\", \"timeout\": 10}]}]"
run_install
assert "S4: install exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "S4: custom hook entry present after install" \
  "$(grep -qF "$CUSTOM_HOOK_COMMAND" "${RTK_FIXTURE_HOME}/.claude/settings.json"; echo $?)"

run_install --update
assert "S4: --update exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "S4: custom hook entry still present after --update" \
  "$(grep -qF "$CUSTOM_HOOK_COMMAND" "${RTK_FIXTURE_HOME}/.claude/settings.json"; echo $?)"
custom_occurrences=$(grep -oF "$CUSTOM_HOOK_COMMAND" "${RTK_FIXTURE_HOME}/.claude/settings.json" | wc -l | tr -d ' ')
assert "S4: custom hook entry unchanged/not duplicated" \
  "$([ "$custom_occurrences" -eq 1 ]; echo $?)"

rtk_fixture_teardown
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# S5 — no-binary no-op (rtk NOT on PATH)
# ═══════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}S5 — no-binary no-op${NC}"

rtk_fixture_setup
# Remove the fake rtk from the fixture PATH entirely, but keep the fixture
# HOME + python3 shim, so we're testing "rtk absent" not "python3 absent".
rm -f "$RTK_FIXTURE_BIN/rtk"
trap rtk_fixture_teardown EXIT

run_install
assert "S5: install exits zero even with no rtk on PATH" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "S5: no rtk-related settings entry created" \
  "$(rtk_fixture_hook_present; [ $? -ne 0 ]; echo $?)"
assert "S5: output does not crash / mentions rtk not installed (best-effort)" \
  "$(echo "$OUT" | grep -qi "rtk"; echo $?)"

rtk_fixture_teardown
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# S6 — fresh-env init (brand new $HOME, no settings.json at all)
# ═══════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}S6 — fresh-env init${NC}"

rtk_fixture_setup
trap rtk_fixture_teardown EXIT

# rtk_fixture_setup already gives us a brand-new throwaway HOME with no
# .claude directory at all — assert that precondition explicitly.
assert "S6: precondition — no settings.json before install" \
  "$([ ! -f "${RTK_FIXTURE_HOME}/.claude/settings.json" ]; echo $?)"

run_install
assert "S6: install exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "S6: settings.json created" \
  "$([ -f "${RTK_FIXTURE_HOME}/.claude/settings.json" ]; echo $?)"
assert "S6: rtk hook entry present in freshly-created settings.json" \
  "$(rtk_fixture_hook_present; echo $?)"

rtk_fixture_teardown
trap - EXIT

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Results: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${FAIL} assertion(s) failed.${NC}"
  exit 1
fi
echo -e "${GREEN}All rtk hook reinit tests passed.${NC}"
exit 0
