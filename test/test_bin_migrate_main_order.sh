#!/usr/bin/env bash
set -euo pipefail

# test_bin_migrate_main_order.sh — Covers bin/migrate's `# ─── Main` block,
# which the other test_bin_migrate_*.sh suites deliberately exclude (they
# `source` the script only up to that marker so they can exercise helpers
# without running an installation).
#
# The contract under test is an ordering one. run_install_update is the only
# step that rebuilds conduct-ts, and conduct-ts serves the `config read` that
# read_from_version depends on. Reading the installed version first therefore
# made the repair depend on the thing it repairs: a bundle predating the
# `config read` subcommand failed the read, migrate exited, and the refresh
# that would have rebuilt the bundle never ran — an install that could not
# migrate itself forward by any automatic path.
#
# bin/install and conduct-ts are stubbed: this asserts the order in which
# bin/migrate invokes them, not what they do.
#
# Usage: ./test/test_bin_migrate_main_order.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1 result=$2
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

# Pin the concrete interpreter: a version-manager shim resolves python3 via
# $HOME, which the throwaway HOME below breaks (same fix as test_bin_update.sh).
STUBS_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUBS_DIR"
PY3="$(python3 -c 'import sys; print(sys.executable)')"
ln -s "$PY3" "$STUBS_DIR/python3"
TEST_PATH="$STUBS_DIR:/usr/bin:/bin"

# make_repo <name> <conduct_ts_supports_config_read>
# A throwaway harness checkout carrying the real bin/migrate and bin/lib, a
# recording bin/install stub, and a conduct-ts stub that either serves
# `config read` or rejects everything the way a pre-`config read` bundle does.
make_repo() {
  local name=$1 supports_read=$2
  local dir="$TMP_ROOT/$name"
  mkdir -p "$dir/bin"
  cp "$HARNESS_DIR/bin/migrate" "$dir/bin/migrate"
  chmod +x "$dir/bin/migrate"
  cp -r "$HARNESS_DIR/bin/lib" "$dir/bin/lib"

  cat > "$dir/bin/install" <<EOF
#!/usr/bin/env bash
echo "install" >> "$dir/.calls"
exit 0
EOF
  chmod +x "$dir/bin/install"

  if [ "$supports_read" = "yes" ]; then
    cat > "$dir/bin/conduct-ts" <<EOF
#!/usr/bin/env bash
echo "conduct-ts \$*" >> "$dir/.calls"
[ "\$1" = "config" ] || exit 2
case "\$2" in
  read) echo "v0.100.0" ;;
  set) : ;;
  *) exit 2 ;;
esac
EOF
  else
    # A bundle older than the `config read` subcommand: the args fall through
    # to the inline-pipeline rejection, exactly as an unrebuilt dist does.
    cat > "$dir/bin/conduct-ts" <<EOF
#!/usr/bin/env bash
echo "conduct-ts \$*" >> "$dir/.calls"
echo "conduct: the inline SDLC pipeline now runs under the \\\`inline\\\` subcommand." >&2
exit 1
EOF
  fi
  chmod +x "$dir/bin/conduct-ts"

  echo "0.4.0" > "$dir/VERSION"
  printf '# Changelog\n\n## [Unreleased]\n' > "$dir/CHANGELOG.md"
  (
    cd "$dir"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git add -A
    git commit -q -m "init"
  )
  echo "$dir"
}

make_isolated_home() {
  local home="$TMP_ROOT/home-$$-${RANDOM}"
  mkdir -p "$home/.ai-conductor"
  printf 'conductor:\n  current_version: v0.100.0\n' > "$home/.ai-conductor/config.yml"
  echo "$home"
}

run_migrate() {
  local repo=$1 home=$2
  set +e
  MIGRATE_OUT=$(cd "$repo" && HOME="$home" PATH="$repo/bin:$TEST_PATH" \
    bash "$repo/bin/migrate" 2>&1)
  MIGRATE_CODE=$?
  set -e
  MIGRATE_CALLS=$(cat "$repo/.calls" 2>/dev/null || true)
}

echo -e "${BOLD}bin/migrate — Main block ordering${NC}"

# A bundle too old to serve `config read` must still get the install refresh
# that rebuilds it. Migrate may then decline the version-dependent work, but
# the repair must have already run — otherwise nothing can ever repair it.
REPO=$(make_repo "stale-conduct-ts" no)
HOME_DIR=$(make_isolated_home)
run_migrate "$REPO" "$HOME_DIR"
assert "stale conduct-ts: install refresh runs before the version read" \
  "$(case "$MIGRATE_CALLS" in install*) echo 0;; *) echo 1;; esac)"
assert "stale conduct-ts: migrate still fails closed on the unreadable version" \
  "$([ "$MIGRATE_CODE" -ne 0 ] && echo 0 || echo 1)"
assert "stale conduct-ts: the failure names the repair command" \
  "$(case "$MIGRATE_OUT" in *"bin/install --update"*) echo 0;; *) echo 1;; esac)"

# The ordinary path is unchanged: a working bundle migrates as before.
REPO=$(make_repo "working-conduct-ts" yes)
HOME_DIR=$(make_isolated_home)
run_migrate "$REPO" "$HOME_DIR"
assert "working conduct-ts: migrate succeeds" \
  "$([ "$MIGRATE_CODE" -eq 0 ] && echo 0 || echo 1)"
assert "working conduct-ts: install refresh still runs" \
  "$(case "$MIGRATE_CALLS" in *install*) echo 0;; *) echo 1;; esac)"
assert "working conduct-ts: reports the migration it performed" \
  "$(case "$MIGRATE_OUT" in *"Migrating harness"*) echo 0;; *) echo 1;; esac)"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${BOLD}Summary: ${PASS}/${TOTAL} passed${NC}"
  exit 0
fi
echo -e "${BOLD}Summary: ${PASS}/${TOTAL} passed, ${FAIL} failed${NC}"
exit 1
