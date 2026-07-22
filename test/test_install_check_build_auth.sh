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

STUB_BIN="${TMP_ROOT}/stubbin"
mkdir -p "$STUB_BIN"

run_check() {
  # $1 = path to a directory to prepend to PATH (contains the conduct-ts stub,
  #      or is empty/absent to simulate conduct-ts missing from PATH).
  local extra_path=$1
  HOME="$FAKE_HOME" PATH="${extra_path}:${PATH}" "${HARNESS_DIR}/bin/install" --check
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

# ─── Case 3: conduct-ts absent from PATH entirely → warn, not crash ──

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
