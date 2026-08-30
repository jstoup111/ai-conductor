#!/usr/bin/env bash
# Covers: task:4, task:5
#
# Verifies the canonical ai-conductor launcher and the deprecated conduct-ts
# alias share one resolved dist entrypoint while keeping warnings off stdout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CANONICAL_LAUNCHER="$HARNESS_DIR/bin/ai-conductor"
LEGACY_LAUNCHER="$HARNESS_DIR/bin/conduct-ts"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0
FAIL=0
TOTAL=0

assert() {
  local description=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${description}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${description}"
    FAIL=$((FAIL + 1))
  fi
}

TMPDIR_ROOT=$(mktemp -d)
cleanup() {
  rm -rf "$TMPDIR_ROOT"
}
trap cleanup EXIT

if [ ! -f "$CANONICAL_LAUNCHER" ]; then
  echo "=== ai-conductor launcher ==="
  assert "canonical bin/ai-conductor launcher exists" 1
  echo ""
  echo "=== Summary: ${PASS}/${TOTAL} passed ==="
  exit 1
fi

assert "legacy launcher is a symlink to the canonical launcher" \
  "$([ -L "$LEGACY_LAUNCHER" ] && [ "$(readlink "$LEGACY_LAUNCHER")" = "ai-conductor" ] && echo 0 || echo 1)"

NODE_STUBS="$TMPDIR_ROOT/node-stubs"
mkdir -p "$NODE_STUBS"
cat > "$NODE_STUBS/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  echo 'v26.7.0'
  exit 0
fi
printf 'ENTRYPOINT:%s\n' "$1"
shift
printf 'ARGUMENTS:%s\n' "$*"
EOF
chmod +x "$NODE_STUBS/node"

cat > "$NODE_STUBS/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  ci|list) exit 0 ;;
  run)
    [ "${2:-}" = build ]
    exit
    ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$NODE_STUBS/npm"

for provider in claude codex; do
  printf '#!/usr/bin/env bash\necho 1.0.0\n' > "$NODE_STUBS/$provider"
  chmod +x "$NODE_STUBS/$provider"
done

CHECK_STUBS="$TMPDIR_ROOT/check-stubs"
mkdir -p "$CHECK_STUBS"
cat > "$CHECK_STUBS/conduct-ts" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = build-auth-status ]; then
  echo 'build-auth-status: valid'
fi
EOF
chmod +x "$CHECK_STUBS/conduct-ts"

# make_fake_harness <name> [valid|missing|broken]
make_fake_harness() {
  local name=$1
  local dist_state=${2:-valid}
  local directory="$TMPDIR_ROOT/$name"

  mkdir -p "$directory/bin" "$directory/src/conductor/dist-versions/v123"
  cp "$CANONICAL_LAUNCHER" "$directory/bin/ai-conductor"
  ln -s ai-conductor "$directory/bin/conduct-ts"

  case "$dist_state" in
    valid)
      : > "$directory/src/conductor/dist-versions/v123/index.js"
      ln -s dist-versions/v123 "$directory/src/conductor/dist"
      ;;
    broken)
      ln -s dist-versions/missing "$directory/src/conductor/dist"
      ;;
    missing)
      ;;
    *)
      echo "unknown dist state: $dist_state" >&2
      return 2
      ;;
  esac

  printf '%s\n' "$directory"
}

capture() {
  local output_file="$TMPDIR_ROOT/stdout"
  local error_file="$TMPDIR_ROOT/stderr"

  set +e
  PATH="$NODE_STUBS:/usr/bin:/bin" "$@" > "$output_file" 2> "$error_file"
  CAPTURE_STATUS=$?
  set -e
  CAPTURE_STDOUT=$(<"$output_file")
  CAPTURE_STDERR=$(<"$error_file")
}

assert_no_stdout_warning() {
  local description=$1
  local output=$2
  case "$output" in
    *deprecated*|*ai-conductor*) assert "$description" 1 ;;
    *) assert "$description" 0 ;;
  esac
}

echo "=== ai-conductor launcher: canonical and alias dispatch ==="

SUCCESS_DIR=$(make_fake_harness success)
capture "$SUCCESS_DIR/bin/ai-conductor" daemon status
CANONICAL_STATUS=$CAPTURE_STATUS
CANONICAL_STDOUT=$CAPTURE_STDOUT
CANONICAL_STDERR=$CAPTURE_STDERR

capture "$SUCCESS_DIR/bin/conduct-ts" daemon status
LEGACY_STATUS=$CAPTURE_STATUS
LEGACY_STDOUT=$CAPTURE_STDOUT
LEGACY_STDERR=$CAPTURE_STDERR

ln -s "$SUCCESS_DIR/bin/ai-conductor" "$SUCCESS_DIR/bin/conduct"
capture "$SUCCESS_DIR/bin/conduct" daemon status
CONDUCT_STATUS=$CAPTURE_STATUS
CONDUCT_STDOUT=$CAPTURE_STDOUT
CONDUCT_STDERR=$CAPTURE_STDERR

assert "canonical launcher exits successfully" "$([ "$CANONICAL_STATUS" -eq 0 ] && echo 0 || echo 1)"
assert "legacy alias keeps the canonical exit contract" "$([ "$LEGACY_STATUS" -eq "$CANONICAL_STATUS" ] && echo 0 || echo 1)"
assert "conduct alias keeps the canonical exit contract" "$([ "$CONDUCT_STATUS" -eq "$CANONICAL_STATUS" ] && echo 0 || echo 1)"
assert "both names execute the same resolved dist entrypoint" "$([ "$LEGACY_STDOUT" = "$CANONICAL_STDOUT" ] && echo 0 || echo 1)"
assert "conduct alias executes the canonical resolved dist entrypoint" "$([ "$CONDUCT_STDOUT" = "$CANONICAL_STDOUT" ] && echo 0 || echo 1)"
case "$CANONICAL_STDOUT" in
  *"ENTRYPOINT:"*"dist-versions/v123/index.js"*) assert "entrypoint is pinned below dist-versions" 0 ;;
  *) echo "$CANONICAL_STDOUT"; assert "entrypoint is pinned below dist-versions" 1 ;;
esac
if printf '%s\n' "$CANONICAL_STDOUT" | grep -Fqx 'ARGUMENTS:daemon status'; then
  assert "canonical launcher forwards the requested arguments" 0
else
  echo "$CANONICAL_STDOUT"
  assert "canonical launcher forwards the requested arguments" 1
fi
assert "canonical launcher emits no deprecation warning" "$([ -z "$CANONICAL_STDERR" ] && echo 0 || echo 1)"
WARNING_COUNT=$(printf '%s\n' "$LEGACY_STDERR" | grep -Fxc 'conduct-ts is deprecated; use ai-conductor instead' || true)
assert "legacy alias emits exactly one replacement warning" "$([ "$WARNING_COUNT" -eq 1 ] && echo 0 || echo 1)"
WARNING_COUNT=$(printf '%s\n' "$CONDUCT_STDERR" | grep -Fxc 'conduct is deprecated; use ai-conductor instead' || true)
assert "conduct alias emits exactly one replacement warning" "$([ "$WARNING_COUNT" -eq 1 ] && echo 0 || echo 1)"
assert_no_stdout_warning "canonical launcher never writes a warning to stdout" "$CANONICAL_STDOUT"
assert_no_stdout_warning "legacy alias never writes a warning to stdout" "$LEGACY_STDOUT"
assert_no_stdout_warning "conduct alias never writes a warning to stdout" "$CONDUCT_STDOUT"

echo ""
echo "=== ai-conductor launcher: installation ==="

INSTALL_HOME="$TMPDIR_ROOT/install-home"
INSTALL_PATH="$NODE_STUBS:$INSTALL_HOME/.local/bin:/usr/bin:/bin"

run_install() {
  local output_file="$TMPDIR_ROOT/install-output"
  local error_file="$TMPDIR_ROOT/install-error"

  set +e
  HOME="$INSTALL_HOME" PATH="$INSTALL_PATH" "$HARNESS_DIR/bin/install" \
    --update --providers codex --allow-worktree-root > "$output_file" 2> "$error_file"
  INSTALL_STATUS=$?
  set -e
  INSTALL_STDOUT=$(<"$output_file")
  INSTALL_STDERR=$(<"$error_file")
}

run_install
INSTALLED_CANONICAL="$INSTALL_HOME/.local/bin/ai-conductor"
INSTALLED_CONDUCT="$INSTALL_HOME/.local/bin/conduct"
assert "completed install creates the ai-conductor symlink" \
  "$([ "$INSTALL_STATUS" -eq 0 ] && [ -L "$INSTALLED_CANONICAL" ] && echo 0 || echo 1)"
assert "installed ai-conductor resolves to the canonical launcher" \
  "$([ "$(readlink -f "$INSTALLED_CANONICAL")" = "$CANONICAL_LAUNCHER" ] && echo 0 || echo 1)"
assert "installed conduct resolves to the canonical launcher" \
  "$([ "$(readlink -f "$INSTALLED_CONDUCT")" = "$CANONICAL_LAUNCHER" ] && echo 0 || echo 1)"

CONDUCT_INODE=$(stat -c '%i' "$INSTALLED_CONDUCT")
run_install
assert "current conduct symlink remains untouched on reinstall" \
  "$([ "$(stat -c '%i' "$INSTALLED_CONDUCT")" = "$CONDUCT_INODE" ] && printf '%s\\n' "$INSTALL_STDOUT" | grep -Fq 'conduct script already current' && echo 0 || echo 1)"

rm -f "$INSTALLED_CANONICAL"
ln -s "$TMPDIR_ROOT/stale-ai-conductor" "$INSTALLED_CANONICAL"
run_install
assert "stale ai-conductor target updates in place" \
  "$([ -L "$INSTALLED_CANONICAL" ] && [ "$(readlink -f "$INSTALLED_CANONICAL")" = "$CANONICAL_LAUNCHER" ] && echo 0 || echo 1)"
if printf '%s\n' "$INSTALL_STDOUT" | grep -Fq 'Updated ai-conductor script symlink'; then
  assert "ai-conductor stale-target output matches conduct-ts update behavior" 0
else
  echo "$INSTALL_STDOUT"
  assert "ai-conductor stale-target output matches conduct-ts update behavior" 1
fi

if printf '%s\n' "$INSTALL_STDOUT" | grep -Fq 'ai-conductor compose --idea "your feature description"' && \
  printf '%s\n' "$INSTALL_STDOUT" | grep -Fq 'ai-conductor daemon start' && \
  printf '%s\n' "$INSTALL_STDOUT" | grep -Fq 'ai-conductor inline --interactive "your feature description"'; then
  assert "install quick start names canonical compose, daemon, and inline commands" 0
else
  echo "$INSTALL_STDOUT"
  assert "install quick start names canonical compose, daemon, and inline commands" 1
fi

CHECK_OUTPUT="$TMPDIR_ROOT/check-output"
set +e
HOME="$INSTALL_HOME" PATH="$CHECK_STUBS:$INSTALL_PATH" "$HARNESS_DIR/bin/install" \
  --check --providers codex > "$CHECK_OUTPUT" 2>&1
CHECK_STATUS=$?
set -e
if [ "$CHECK_STATUS" -eq 0 ] && grep -Fq 'ai-conductor built and on PATH' "$CHECK_OUTPUT"; then
  assert "install --check verifies the installed ai-conductor launcher" 0
else
  cat "$CHECK_OUTPUT"
  assert "install --check verifies the installed ai-conductor launcher" 1
fi

capture "$INSTALL_HOME/.local/bin/ai-conductor" daemon status
INSTALLED_CANONICAL_STATUS=$CAPTURE_STATUS
INSTALLED_CANONICAL_STDOUT=$CAPTURE_STDOUT
INSTALLED_CANONICAL_STDERR=$CAPTURE_STDERR
capture "$INSTALL_HOME/.local/bin/conduct-ts" daemon status
INSTALLED_LEGACY_STATUS=$CAPTURE_STATUS
INSTALLED_LEGACY_STDOUT=$CAPTURE_STDOUT
INSTALLED_LEGACY_STDERR=$CAPTURE_STDERR
assert "installed ai-conductor daemon status exits successfully" \
  "$([ "$INSTALLED_CANONICAL_STATUS" -eq 0 ] && echo 0 || echo 1)"
assert "installed ai-conductor and conduct-ts share the TS dist entrypoint" \
  "$([ "$INSTALLED_CANONICAL_STDOUT" = "$INSTALLED_LEGACY_STDOUT" ] && echo 0 || echo 1)"
assert "installed ai-conductor daemon status emits no warning" \
  "$([ -z "$INSTALLED_CANONICAL_STDERR" ] && echo 0 || echo 1)"
WARNING_COUNT=$(printf '%s\n' "$INSTALLED_LEGACY_STDERR" | grep -Fxc 'conduct-ts is deprecated; use ai-conductor instead' || true)
assert "installed conduct-ts retains its one replacement warning" \
  "$([ "$WARNING_COUNT" -eq 1 ] && echo 0 || echo 1)"

rm "$INSTALLED_CANONICAL"
MISSING_AI_CHECK_OUTPUT="$TMPDIR_ROOT/missing-ai-check-output"
set +e
HOME="$INSTALL_HOME" PATH="$CHECK_STUBS:$INSTALL_PATH" "$HARNESS_DIR/bin/install" \
  --check --providers codex > "$MISSING_AI_CHECK_OUTPUT" 2>&1
MISSING_AI_CHECK_STATUS=$?
set -e
assert "install --check fails when ai-conductor is absent from PATH" \
  "$([ "$MISSING_AI_CHECK_STATUS" -ne 0 ] && echo 0 || echo 1)"
if grep -Fq 'ai-conductor bundle built but not on PATH — run ./bin/install' "$MISSING_AI_CHECK_OUTPUT"; then
  assert "missing ai-conductor check reports its recovery" 0
else
  cat "$MISSING_AI_CHECK_OUTPUT"
  assert "missing ai-conductor check reports its recovery" 1
fi

run_dist_failure_case() {
  local dist_state=$1
  local directory
  local canonical_error
  local legacy_error

  directory=$(make_fake_harness "$dist_state" "$dist_state")
  capture "$directory/bin/ai-conductor"
  assert "canonical launcher exits non-zero when dist is $dist_state" "$([ "$CAPTURE_STATUS" -ne 0 ] && echo 0 || echo 1)"
  assert "canonical launcher reports the $dist_state dist failure on stderr" "$([ -n "$CAPTURE_STDERR" ] && echo 0 || echo 1)"
  assert_no_stdout_warning "canonical $dist_state failure has no warning on stdout" "$CAPTURE_STDOUT"
  canonical_error=$CAPTURE_STDERR

  capture "$directory/bin/conduct-ts"
  assert "legacy alias exits non-zero when dist is $dist_state" "$([ "$CAPTURE_STATUS" -ne 0 ] && echo 0 || echo 1)"
  case "$CAPTURE_STDERR" in
    "conduct-ts is deprecated; use ai-conductor instead"$'\n'"$canonical_error")
      assert "legacy $dist_state failure keeps the error after one warning" 0
      ;;
    *)
      echo "$CAPTURE_STDERR"
      assert "legacy $dist_state failure keeps the error after one warning" 1
      ;;
  esac
  assert_no_stdout_warning "legacy $dist_state failure has no warning on stdout" "$CAPTURE_STDOUT"
}

echo ""
echo "=== ai-conductor launcher: dist failures ==="
run_dist_failure_case missing
run_dist_failure_case broken

echo ""
echo "=== ai-conductor launcher: uninstall ==="
INSTALL_HOME="$TMPDIR_ROOT/uninstall-home"
INSTALL_PATH="$NODE_STUBS:$INSTALL_HOME/.local/bin:/usr/bin:/bin"
run_install
set +e
HOME="$INSTALL_HOME" PATH="$INSTALL_PATH" "$HARNESS_DIR/bin/install" --uninstall --providers codex > "$TMPDIR_ROOT/uninstall-output" 2>&1
UNINSTALL_STATUS=$?
set -e
assert "uninstall removes all installer-owned entrypoint links" \
  "$([ "$UNINSTALL_STATUS" -eq 0 ] && [ ! -e "$INSTALL_HOME/.local/bin/conduct" ] && [ ! -e "$INSTALL_HOME/.local/bin/conduct-ts" ] && [ ! -e "$INSTALL_HOME/.local/bin/ai-conductor" ] && echo 0 || echo 1)"

run_install
rm "$INSTALL_HOME/.local/bin/conduct"
printf 'foreign conduct\n' > "$INSTALL_HOME/.local/bin/conduct"
set +e
HOME="$INSTALL_HOME" PATH="$INSTALL_PATH" "$HARNESS_DIR/bin/install" --uninstall --providers codex > "$TMPDIR_ROOT/foreign-uninstall-output" 2>&1
UNINSTALL_STATUS=$?
set -e
assert "uninstall preserves a foreign conduct entry with a warning" \
  "$([ "$UNINSTALL_STATUS" -eq 0 ] && [ -f "$INSTALL_HOME/.local/bin/conduct" ] && grep -Fq 'conduct script — foreign entry preserved' "$TMPDIR_ROOT/foreign-uninstall-output" && echo 0 || echo 1)"

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
