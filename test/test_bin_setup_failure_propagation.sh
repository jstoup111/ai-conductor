#!/usr/bin/env bash
set -euo pipefail

# test_bin_setup_failure_propagation.sh — Tests that bin/setup properly propagates
# failures from npm install and npm run build, thanks to `set -euo pipefail`.
#
# Verifies:
# 1. npm install fails → bin/setup exits non-zero AND build step never ran
# 2. npm build fails → bin/setup exits non-zero
#
# Uses PATH shims to inject npm failures without modifying bin/setup.
#
# Usage: ./test/test_bin_setup_failure_propagation.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2  # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

# ─── Setup ─────────────────────────────────────────────────────────────────

TMPDIR_ROOT=$(mktemp -d)
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

# Create a mock repo structure with bin/setup and src/conductor
setup_mock_repo() {
  local repo_dir=$1
  mkdir -p "$repo_dir/bin"
  mkdir -p "$repo_dir/src/conductor"

  # Copy the actual bin/setup to the mock repo
  cp "$HARNESS_DIR/bin/setup" "$repo_dir/bin/setup"
  chmod +x "$repo_dir/bin/setup"

  # Create mock package.json in src/conductor for npm to find
  cat > "$repo_dir/src/conductor/package.json" << 'JSON'
{
  "name": "conductor",
  "version": "0.99.19",
  "type": "module"
}
JSON
}

# ─── Test 1: npm install fails → bin/setup exits non-zero ──────────────────

echo ""
echo -e "${BOLD}Test Suite: bin/setup Failure Propagation${NC}"
echo ""

test_npm_install_failure() {
  local repo="${TMPDIR_ROOT}/test_install_fail"
  setup_mock_repo "$repo"

  # Create a shim npm that fails on install, but would write a marker if build ran
  local shim_dir="${repo}/shim"
  mkdir -p "$shim_dir"

  cat > "$shim_dir/npm" << 'SHIM'
#!/usr/bin/env bash
# If called with 'install', fail immediately (exit 1)
if [ "$1" = "install" ]; then
  echo "mock npm: install failed" >&2
  exit 1
fi

# If called with 'run build', write a marker to prove build ran
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  touch "$(pwd)/build-ran.marker"
  exit 0
fi

exit 0
SHIM
  chmod +x "$shim_dir/npm"

  # Run bin/setup with the shim npm in PATH
  local exit_code=0
  PATH="$shim_dir:$PATH" "$repo/bin/setup" > /dev/null 2>&1 || exit_code=$?

  # Verify bin/setup exited non-zero
  assert "npm install failure causes bin/setup to exit non-zero" \
    "$([ "$exit_code" -ne 0 ] && echo 0 || echo 1)"

  # Verify the build step never ran (no marker file)
  assert "build step never ran when install failed (no marker file)" \
    "$([ ! -f "$repo/src/conductor/build-ran.marker" ] && echo 0 || echo 1)"
}
test_npm_install_failure

# ─── Test 2: npm build fails → bin/setup exits non-zero ────────────────────

test_npm_build_failure() {
  local repo="${TMPDIR_ROOT}/test_build_fail"
  setup_mock_repo "$repo"

  # Create a shim npm that succeeds on install, fails on run build
  local shim_dir="${repo}/shim"
  mkdir -p "$shim_dir"

  cat > "$shim_dir/npm" << 'SHIM'
#!/usr/bin/env bash
# install always succeeds (no-op)
if [ "$1" = "install" ]; then
  exit 0
fi

# run build fails
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  echo "mock npm: build failed" >&2
  exit 2
fi

exit 0
SHIM
  chmod +x "$shim_dir/npm"

  # Run bin/setup with the shim npm in PATH
  local exit_code=0
  PATH="$shim_dir:$PATH" "$repo/bin/setup" > /dev/null 2>&1 || exit_code=$?

  # Verify bin/setup exited non-zero
  assert "npm build failure causes bin/setup to exit non-zero" \
    "$([ "$exit_code" -ne 0 ] && echo 0 || echo 1)"
}
test_npm_build_failure

# ─── Test 3: npm install succeeds, build succeeds → bin/setup exits 0 ──────

test_npm_success() {
  local repo="${TMPDIR_ROOT}/test_success"
  setup_mock_repo "$repo"

  # Create a shim npm that succeeds on both install and run build
  local shim_dir="${repo}/shim"
  mkdir -p "$shim_dir"

  cat > "$shim_dir/npm" << 'SHIM'
#!/usr/bin/env bash
# Both install and run build succeed
exit 0
SHIM
  chmod +x "$shim_dir/npm"

  # Run bin/setup with the shim npm in PATH
  local exit_code=0
  PATH="$shim_dir:$PATH" "$repo/bin/setup" > /dev/null 2>&1 || exit_code=$?

  # Verify bin/setup exited 0
  assert "npm success causes bin/setup to exit 0" \
    "$([ "$exit_code" -eq 0 ] && echo 0 || echo 1)"
}
test_npm_success

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Results: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}${FAIL} test(s) failed${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
else
  echo -e "  ${GREEN}All tests passed${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
fi
