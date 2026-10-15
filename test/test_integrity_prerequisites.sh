#!/usr/bin/env bash
# Covers: task:5
set -uo pipefail

# test_integrity_prerequisites.sh — Focused fixture spec for
# test/check_integrity_prerequisites.sh. It drives the prerequisite checker
# through its conductor-directory and PATH seams.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="${SCRIPT_DIR}/check_integrity_prerequisites.sh"
BASH_BIN="${BASH:-$(command -v bash)}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${description}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${description}"
    FAIL=$((FAIL + 1))
  fi
}

if [ ! -f "$CHECKER" ]; then
  echo "Missing checker: $CHECKER"
  exit 1
fi

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/integrity-prerequisites-XXXXXX")
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

MISSING_CONDUCTOR="${WORKDIR}/missing-conductor"
READY_CONDUCTOR="${WORKDIR}/ready-conductor"
mkdir -p "${READY_CONDUCTOR}/node_modules"

run_checker() {
  HARNESS_INTEGRITY_CONDUCTOR_DIR=$1 \
    "$BASH_BIN" "$CHECKER" "$2" 2>&1
}

echo ""
echo "Integrity prerequisites — fixture spec"

OUT=$(run_checker "$MISSING_CONDUCTOR" node)
CODE=$?
assert "node prerequisite missing node_modules fails and names src/conductor/node_modules plus npm ci" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'src/conductor/node_modules' && printf '%s\n' "$OUT" | grep -Fq 'npm ci' && echo 0 || echo 1)"

OUT=$(run_checker "$READY_CONDUCTOR" node)
CODE=$?
assert "node prerequisite passes when node_modules exists" \
  "$( [ "$CODE" -eq 0 ] && echo 0 || echo 1)"

PATH_BIN="${WORKDIR}/path-without-jq"
mkdir -p "$PATH_BIN"
ln -s "$(command -v dirname)" "${PATH_BIN}/dirname"
OUT=$(PATH="$PATH_BIN" HARNESS_INTEGRITY_CONDUCTOR_DIR="$READY_CONDUCTOR" "$BASH_BIN" "$CHECKER" jq 2>&1)
CODE=$?
assert "jq prerequisite missing from PATH fails and names jq while node with node_modules passes" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'jq' && echo 0 || echo 1)"

JQ_BIN="${WORKDIR}/path-with-jq"
mkdir -p "$JQ_BIN"
ln -s "$(command -v dirname)" "${JQ_BIN}/dirname"
ln -s "$(command -v jq)" "${JQ_BIN}/jq"
OUT=$(PATH="$JQ_BIN" HARNESS_INTEGRITY_CONDUCTOR_DIR="$READY_CONDUCTOR" "$BASH_BIN" "$CHECKER" jq 2>&1)
CODE=$?
assert "both prerequisite modes pass when node_modules exists and jq is on PATH" \
  "$( [ "$CODE" -eq 0 ] && echo 0 || echo 1)"

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
