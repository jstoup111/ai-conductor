#!/usr/bin/env bash
set -euo pipefail

# test_generate_model_table_wrapper.sh — Real-binary smoke test for
# bin/generate-model-table (Task 11, .docs/plans/generated-model-table.md).
#
# Verifies:
#   - the wrapper contains no npx/tsup/npm-run-build references (source-run
#     only, no dist rebuild)
#   - with the local tsx binary present, the wrapper exits 0 against a
#     healthy fixture
#   - with the local tsx binary missing, the wrapper exits 2 and prints an
#     "npm install" remediation message
#   - src/conductor/dist mtimes are unchanged before/after both the success
#     and the error run (no dist rebuild ever happens)
#
# Usage: ./test/test_generate_model_table_wrapper.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPER="$HARNESS_DIR/bin/generate-model-table"
DIST_DIR="$HARNESS_DIR/src/conductor/dist"
TSX_BIN="$HARNESS_DIR/src/conductor/node_modules/.bin/tsx"

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

echo -e "${BOLD}generate-model-table wrapper smoke test${NC}"
echo ""

# ─── Static check: no npx/tsup/npm-run-build references ───────────────────
echo "Static checks:"
NPX_TSUP_COUNT=$(grep -c 'npx\|tsup\|npm run build' "$WRAPPER" || true)
assert "wrapper contains no npx/tsup/npm-run-build references" "$([ "$NPX_TSUP_COUNT" -eq 0 ] && echo 0 || echo 1)"

assert "bash -n passes on wrapper" "$(bash -n "$WRAPPER" >/dev/null 2>&1; echo $?)"

echo ""

# ─── dist mtime snapshot helper ────────────────────────────────────────────
dist_snapshot() {
  if [ -d "$DIST_DIR" ]; then
    find "$DIST_DIR" -type f -exec stat -c '%n %Y' {} \; 2>/dev/null | sort
  else
    echo "NO_DIST_DIR"
  fi
}

# ─── Happy path: tsx present -> exit 0, dist untouched ────────────────────
if [ -x "$TSX_BIN" ]; then
  echo "Happy path (tsx present):"

  TMP_HARNESS="$(mktemp -d)/HARNESS.md"
  mkdir -p "$(dirname "$TMP_HARNESS")"
  cat > "$TMP_HARNESS" <<'EOF'
# Fixture

<!-- BEGIN GENERATED: model-selection-table -->
stale
<!-- END GENERATED: model-selection-table -->
EOF

  BEFORE_SNAP="$(dist_snapshot)"
  set +e
  GENERATE_MODEL_TABLE_HARNESS_MD="$TMP_HARNESS" "$WRAPPER" >/tmp/gmt_ok_out.log 2>&1
  OK_EXIT=$?
  set -e
  AFTER_SNAP="$(dist_snapshot)"

  assert "wrapper exits 0 when tsx is present and fixture is well-formed" "$([ "$OK_EXIT" -eq 0 ] && echo 0 || echo 1)"
  assert "src/conductor/dist mtimes unchanged after success run" "$([ "$BEFORE_SNAP" = "$AFTER_SNAP" ] && echo 0 || echo 1)"

  rm -rf "$(dirname "$TMP_HARNESS")"
  echo ""
else
  echo -e "${YELLOW}SKIP${NC} happy path — ${TSX_BIN} not present (run 'npm install' in src/conductor/)"
  echo ""
fi

# ─── Negative path: tsx missing -> exit 2 + npm install message ───────────
echo "Negative path (tsx missing):"

FAKE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FAKE_ROOT"' EXIT

# Mirror just enough of the tree for the wrapper's path resolution to work,
# WITHOUT a node_modules/.bin/tsx binary, so the wrapper hits its own
# missing-tsx guard rather than a real environment already lacking tsx.
mkdir -p "$FAKE_ROOT/bin" "$FAKE_ROOT/src/conductor/src/tools" "$FAKE_ROOT/src/conductor/dist"
cp "$WRAPPER" "$FAKE_ROOT/bin/generate-model-table"
chmod +x "$FAKE_ROOT/bin/generate-model-table"
cp "$HARNESS_DIR/src/conductor/src/tools/generate-model-table.ts" \
  "$FAKE_ROOT/src/conductor/src/tools/generate-model-table.ts"
echo "sentinel" > "$FAKE_ROOT/src/conductor/dist/sentinel.js"

BEFORE_ERR_SNAP=$(find "$FAKE_ROOT/src/conductor/dist" -type f -exec stat -c '%n %Y' {} \; | sort)

set +e
"$FAKE_ROOT/bin/generate-model-table" >/tmp/gmt_err_out.log 2>&1
ERR_EXIT=$?
set -e
AFTER_ERR_SNAP=$(find "$FAKE_ROOT/src/conductor/dist" -type f -exec stat -c '%n %Y' {} \; | sort)

assert "wrapper exits 2 when tsx is missing (no npx fallback)" "$([ "$ERR_EXIT" -eq 2 ] && echo 0 || echo 1)"
assert "error message mentions 'npm install'" "$(grep -q 'npm install' /tmp/gmt_err_out.log && echo 0 || echo 1)"
assert "dist mtimes unchanged after error run" "$([ "$BEFORE_ERR_SNAP" = "$AFTER_ERR_SNAP" ] && echo 0 || echo 1)"

rm -rf "$FAKE_ROOT"
trap - EXIT

echo ""
echo "─────────────────────────────────────────"
echo -e "${BOLD}Results:${NC} ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC} (of ${TOTAL})"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
