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

# ─── Test 4: matching primary node_modules are copied into a worktree ────────

test_matching_primary_node_modules_copied() {
  local repo="${TMPDIR_ROOT}/test_dependency_reuse"
  setup_mock_repo "$repo"

  cat > "$repo/src/conductor/package-lock.json" << 'JSON'
{
  "name": "conductor",
  "version": "0.99.19",
  "lockfileVersion": 3,
  "packages": {}
}
JSON
  mkdir -p "$repo/src/conductor/node_modules/reuse-probe"
  printf '%s\n' 'primary dependency tree' > "$repo/src/conductor/node_modules/reuse-probe/marker"

  git -C "$repo" init -q -b main
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add bin/setup src/conductor/package.json src/conductor/package-lock.json
  git -C "$repo" commit -q -m 'seed setup fixture'

  local worktree="$repo/worktree"
  git -C "$repo" worktree add -q -b feature/reuse "$worktree"

  local shim_dir="$repo/shim"
  mkdir -p "$shim_dir"
  cat > "$shim_dir/npm" << 'SHIM'
#!/usr/bin/env bash
if [ "$1" = "install" ]; then
  echo "npm install should not run when matching primary dependencies exist" >&2
  exit 9
fi
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  test -f node_modules/reuse-probe/marker
  mkdir -p dist
  printf '%s\n' 'built in worktree' > dist/index.js
  exit 0
fi
exit 1
SHIM
  chmod +x "$shim_dir/npm"

  local exit_code=0
  PATH="$shim_dir:$PATH" "$worktree/bin/setup" > /dev/null 2>&1 || exit_code=$?

  assert "matching primary node_modules let worktree setup skip npm install" \
    "$([ "$exit_code" -eq 0 ] && echo 0 || echo 1)"
  assert "worktree node_modules is an independent copy" \
    "$([ -d "$worktree/src/conductor/node_modules" ] && \
       [ ! -L "$worktree/src/conductor/node_modules" ] && \
       [ "$(ls -di "$worktree/src/conductor/node_modules" | awk '{print $1}')" != \
         "$(ls -di "$repo/src/conductor/node_modules" | awk '{print $1}')" ] && echo 0 || echo 1)"
  assert "worktree build output remains local" \
    "$([ -f "$worktree/src/conductor/dist/index.js" ] && \
       [ ! -f "$repo/src/conductor/dist/index.js" ] && echo 0 || echo 1)"

  cat > "$worktree/src/conductor/package.json" << 'JSON'
{
  "name": "conductor",
  "version": "0.99.20",
  "type": "module"
}
JSON
  cat > "$shim_dir/npm" << 'SHIM'
#!/usr/bin/env bash
if [ "$1" = "install" ]; then
  test ! -L node_modules || exit 8
  mkdir -p node_modules/local-probe
  printf '%s\n' 'worktree dependency tree' > node_modules/local-probe/marker
  exit 0
fi
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  test -f node_modules/local-probe/marker
  exit 0
fi
exit 1
SHIM
  chmod +x "$shim_dir/npm"

  exit_code=0
  PATH="$shim_dir:$PATH" "$worktree/bin/setup" > /dev/null 2>&1 || exit_code=$?

  assert "manifest drift runs npm install against the worktree-local copy" \
    "$([ "$exit_code" -eq 0 ] && [ -d "$worktree/src/conductor/node_modules" ] && \
       [ ! -L "$worktree/src/conductor/node_modules" ] && echo 0 || echo 1)"
  assert "manifest-drift fallback leaves primary node_modules unchanged" \
    "$([ -f "$repo/src/conductor/node_modules/reuse-probe/marker" ] && echo 0 || echo 1)"
}
test_matching_primary_node_modules_copied

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
