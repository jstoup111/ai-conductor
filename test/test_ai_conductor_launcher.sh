#!/usr/bin/env bash
# Covers: task:4
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
printf 'ENTRYPOINT:%s\n' "$1"
shift
printf 'ARGUMENTS:%s\n' "$*"
EOF
chmod +x "$NODE_STUBS/node"

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

assert "canonical launcher exits successfully" "$([ "$CANONICAL_STATUS" -eq 0 ] && echo 0 || echo 1)"
assert "legacy alias keeps the canonical exit contract" "$([ "$LEGACY_STATUS" -eq "$CANONICAL_STATUS" ] && echo 0 || echo 1)"
assert "both names execute the same resolved dist entrypoint" "$([ "$LEGACY_STDOUT" = "$CANONICAL_STDOUT" ] && echo 0 || echo 1)"
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
assert_no_stdout_warning "canonical launcher never writes a warning to stdout" "$CANONICAL_STDOUT"
assert_no_stdout_warning "legacy alias never writes a warning to stdout" "$LEGACY_STDOUT"

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
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
