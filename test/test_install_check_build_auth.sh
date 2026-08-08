#!/usr/bin/env bash
set -euo pipefail

# test_install_check_build_auth.sh — `bin/install --check` build-auth delegate
# (Task 10, FR-1/FR-3).
#
# `bin/install --check` must surface build-auth state by calling
# `conduct-ts build-auth-status` and formatting ok/fail from its exit code —
# no token path/mode derivation logic in bash. If conduct-ts is absent/stale,
# it must warn, not crash, mirroring the existing conduct-ts staleness
# warning already in check_installation.
#
# Runs the REAL bin/install --check with a stubbed conduct-ts on PATH so the
# assertions are proven against the actual script, not a sourced fragment.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

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

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

FAKE_HOME="${TMP_ROOT}/home"
mkdir -p "$FAKE_HOME"
mkdir -p "$FAKE_HOME/.claude/skills" "$FAKE_HOME/.agents/skills"
for skill_file in "$HARNESS_DIR"/skills/*/SKILL.md; do
  skill_dir=$(dirname "$skill_file")
  skill_name=$(basename "$skill_dir")
  ln -s "$skill_dir" "$FAKE_HOME/.claude/skills/$skill_name"
  ln -s "$skill_dir" "$FAKE_HOME/.agents/skills/$skill_name"
done
ln -s "$HARNESS_DIR/HARNESS.md" "$FAKE_HOME/.claude/skills/HARNESS.md"
ln -s "$HARNESS_DIR/HARNESS.md" "$FAKE_HOME/.agents/skills/HARNESS.md"

STUB_BIN="${TMP_ROOT}/stubbin"
mkdir -p "$STUB_BIN"
cat > "${STUB_BIN}/claude" <<'EOF'
#!/usr/bin/env bash
echo "1.0.0 (Claude Code)"
EOF
cat > "${STUB_BIN}/conduct" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${STUB_BIN}/claude" "${STUB_BIN}/conduct"

run_check() {
  # $1 = path to a directory to prepend to PATH (contains the conduct-ts stub,
  #      or is empty/absent to simulate conduct-ts missing from PATH).
  local extra_path=$1
  local check_path="${STUB_BIN}:/usr/bin:/bin"
  if [ -n "$extra_path" ]; then
    check_path="${extra_path}:${check_path}"
  fi
  HOME="$FAKE_HOME" PATH="$check_path" "${HARNESS_DIR}/bin/install" --check
}

# ─── Case 1: conduct-ts reports a clean state (exit 0) → ok line, overall pass ──

CLEAN_BIN="${TMP_ROOT}/clean-bin"
mkdir -p "$CLEAN_BIN"
cat > "${CLEAN_BIN}/conduct-ts" <<'EOF'
#!/usr/bin/env bash
echo "build-auth-status: mode=daemon-token state=valid path=/fake/token"
exit 0
EOF
chmod +x "${CLEAN_BIN}/conduct-ts"

out=$(run_check "$CLEAN_BIN" 2>&1) && rc=0 || rc=$?
echo "$out" | grep -qi "build-auth" && r=0 || r=1
assert "clean state: emits a build-auth status line" "$r"
echo "$out" | grep -qE "✓.*build-auth" && r=0 || r=1
assert "clean state: line is formatted as ok (✓)" "$r"
[ "$rc" -eq 0 ] && r=0 || r=1
assert "clean state: overall --check exits 0" "$r"

# ─── Case 1b: configured viewer/renderer keep their successful output ────────

CONFIG_BIN="${TMP_ROOT}/config-bin"
CONFIG_READ_CALLS="${TMP_ROOT}/config-read-calls"
mkdir -p "$CONFIG_BIN" "$FAKE_HOME/.ai-conductor"
printf '%s\n' 'markdown_viewer: {command: glow}' 'mermaid_renderer: {preset: mmdc-png, command: mmdc}' \
  > "$FAKE_HOME/.ai-conductor/config.yml"
cat > "${CONFIG_BIN}/conduct-ts" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  build-auth-status) echo 'build-auth-status: mode=daemon-token state=valid'; exit 0 ;;
  config\ read\ markdown_viewer.command) echo 'glow' ;;
  config\ read\ mermaid_renderer.preset) echo 'mmdc-png' ;;
  config\ read\ mermaid_renderer.command) echo 'mmdc' ;;
  *) exit 91 ;;
esac
printf '%s\n' "$*" >> "$CONFIG_READ_CALLS"
EOF
for tool in glow mmdc; do
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${CONFIG_BIN}/${tool}"
  chmod +x "${CONFIG_BIN}/${tool}"
done
chmod +x "${CONFIG_BIN}/conduct-ts"

out=$(CONFIG_READ_CALLS="$CONFIG_READ_CALLS" run_check "$CONFIG_BIN" 2>&1) && rc=0 || rc=$?
printf '%s\n' "$out" | grep -q 'markdown viewer: glow (artifact review)' && r=0 || r=1
assert "configured viewer: preserves the successful artifact-review output" "$r"
printf '%s\n' "$out" | grep -q 'mermaid renderer: mmdc-png (diagram approval gates)' && r=0 || r=1
assert "configured renderer: preserves the successful diagram-gate output" "$r"
[ "$(cat "$CONFIG_READ_CALLS")" = $'config read markdown_viewer.command\nconfig read mermaid_renderer.preset\nconfig read mermaid_renderer.command' ] && r=0 || r=1
assert "configured dependencies: reads viewer and renderer fields through conduct-ts" "$r"
[ "$rc" -eq 0 ] && r=0 || r=1
assert "configured dependencies: overall --check remains successful" "$r"

# ─── Case 2: conduct-ts reports a non-clean state (exit 1) → fail line, fail counter increments ──

FAIL_BIN="${TMP_ROOT}/fail-bin"
mkdir -p "$FAIL_BIN"
cat > "${FAIL_BIN}/conduct-ts" <<'EOF'
#!/usr/bin/env bash
echo "build-auth-status: mode=daemon-token state=missing path=/fake/token"
exit 1
EOF
chmod +x "${FAIL_BIN}/conduct-ts"

out=$(run_check "$FAIL_BIN" 2>&1) && rc=0 || rc=$?
echo "$out" | grep -qE "✗.*build-auth" && r=0 || r=1
assert "non-clean state: line is formatted as fail (✗)" "$r"
[ "$rc" -ne 0 ] && r=0 || r=1
assert "non-clean state: overall --check exit reflects the failure (FR-3)" "$r"
[ "$rc" -eq 2 ] && r=0 || r=1
assert "build-auth-only failure: exits 2 so install drift remains distinguishable" "$r"
printf '%s\n' "$out" | tail -n 1 | grep -qi "build authentication" && r=0 || r=1
assert "build-auth-only failure: terminal summary names build authentication" "$r"

# ─── Case 3: install drift takes precedence over a build-auth failure ─────────

unlink "$FAKE_HOME/.agents/skills/rebase"
out=$(run_check "$FAIL_BIN" 2>&1) && rc=0 || rc=$?
ln -s "$HARNESS_DIR/skills/rebase" "$FAKE_HOME/.agents/skills/rebase"
[ "$rc" -eq 1 ] && r=0 || r=1
assert "mixed install drift + build-auth failure: exits 1 for install drift" "$r"

# ─── Case 4: conduct-ts absent from PATH entirely → warn, not crash ──

out=$(run_check "" 2>&1) && rc=0 || rc=$?
echo "$out" | grep -qE "⚠.*build-auth" && r=0 || r=1
assert "conduct-ts absent: warns (does not crash) about build-auth check" "$r"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "----------------------------------------"
echo "Total: ${TOTAL}  Pass: ${PASS}  Fail: ${FAIL}"

if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
