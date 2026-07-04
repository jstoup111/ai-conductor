#!/usr/bin/env bash
set -euo pipefail

# test_conduct_ts_launcher.sh — Tests for bin/conduct-ts realpath pinning:
# the launcher must exec the resolved dist-versions/<id>/index.js path (not
# the `dist` symlink itself), and must fail loudly with actionable guidance
# when the `dist` symlink is dangling/broken.
#
# Usage: ./test/test_conduct_ts_launcher.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCHER="$HARNESS_DIR/bin/conduct-ts"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

TMPDIR_ROOT=$(mktemp -d)
cleanup() {
  rm -rf "$TMPDIR_ROOT"
}
trap cleanup EXIT

# make_fake_conductor <name>
# Builds a fake src/conductor tree with dist-versions/<id>/index.js and a
# `dist` symlink pointing to it, plus a bin/conduct-ts copy pointed at it.
make_fake_conductor() {
  local dir="$TMPDIR_ROOT/$1"
  mkdir -p "$dir/bin" "$dir/src/conductor/dist-versions/v123"
  cat > "$dir/src/conductor/dist-versions/v123/index.js" <<'EOF'
console.log("RESOLVED_URL:" + import.meta.url);
EOF
  ln -s "dist-versions/v123" "$dir/src/conductor/dist"
  cp "$LAUNCHER" "$dir/bin/conduct-ts"
  echo "$dir"
}

echo "=== conduct-ts launcher: realpath pinning ==="

DIR1=$(make_fake_conductor "pinned")
if command -v node >/dev/null 2>&1; then
  OUT=$("$DIR1/bin/conduct-ts" 2>&1) || true
  case "$OUT" in
    *"RESOLVED_URL:"*"dist-versions/v123/index.js"*)
      assert "execs resolved dist-versions/<id>/index.js path" 0
      ;;
    *)
      echo "$OUT"
      assert "execs resolved dist-versions/<id>/index.js path" 1
      ;;
  esac
  case "$OUT" in
    *"/dist/index.js"*)
      assert "does not reference the dist symlink path" 1
      ;;
    *)
      assert "does not reference the dist symlink path" 0
      ;;
  esac
else
  echo "  (skipping: node not available)"
fi

echo ""
echo "=== conduct-ts launcher: broken dist symlink ==="

DIR2=$(make_fake_conductor "broken")
rm "$DIR2/src/conductor/dist"
ln -s "dist-versions/does-not-exist" "$DIR2/src/conductor/dist"

set +e
OUT2=$("$DIR2/bin/conduct-ts" 2>&1)
STATUS2=$?
set -e

assert "exits non-zero on dangling dist symlink" "$([ "$STATUS2" -ne 0 ] && echo 0 || echo 1)"

case "$OUT2" in
  *"rebuild"*|*"republish"*)
    assert "error message names rebuild/republish fix" 0
    ;;
  *)
    echo "$OUT2"
    assert "error message names rebuild/republish fix" 1
    ;;
esac

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
