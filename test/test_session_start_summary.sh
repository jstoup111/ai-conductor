#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_ROOT=$(mktemp -d)
trap 'status=$?; rm -rf "$TMP_ROOT"; exit "$status"' EXIT

# The healthy cases need a real parser after the isolated shell runner changes
# HOME. The final case still shadows this fixture entry with its intentional
# failing python3 stub.
TEST_BIN="$TMP_ROOT/bin"
mkdir -p "$TEST_BIN"
ln -s "$(command -p -v python3)" "$TEST_BIN/python3"
PATH="$TEST_BIN:$PATH"

mkdir -p "$TMP_ROOT/.pipeline"
cat > "$TMP_ROOT/.pipeline/conduct-state.json" <<'JSON'
{"build":"done","notes":7,"ship":"skipped","literal":"$(touch should-not-run)"}
JSON
(cd "$TMP_ROOT" && bash "$HARNESS_DIR/hooks/claude/session-start-context.sh") > "$TMP_ROOT/out" 2> "$TMP_ROOT/err"
grep -Fq 'Pipeline: 2/3 steps done' "$TMP_ROOT/out"
[ ! -e "$TMP_ROOT/should-not-run" ]

rm "$TMP_ROOT/.pipeline/conduct-state.json"
(cd "$TMP_ROOT" && bash "$HARNESS_DIR/hooks/claude/session-start-context.sh") > "$TMP_ROOT/out" 2> "$TMP_ROOT/err"
[ "$?" -eq 0 ]
! grep -Fq 'Pipeline:' "$TMP_ROOT/out"
[ ! -s "$TMP_ROOT/err" ]

printf '{bad json' > "$TMP_ROOT/.pipeline/conduct-state.json"
(cd "$TMP_ROOT" && bash "$HARNESS_DIR/hooks/claude/session-start-context.sh") > "$TMP_ROOT/out" 2> "$TMP_ROOT/err"
grep -Fq 'WARNING: Could not summarize pipeline state' "$TMP_ROOT/err"
grep -Fq '=== End Harness Context ===' "$TMP_ROOT/out"
[ "$?" -eq 0 ]

printf '#!/bin/sh\nexit 42\n' > "$TMP_ROOT/python3"
chmod +x "$TMP_ROOT/python3"
printf '{"build":"done"}' > "$TMP_ROOT/.pipeline/conduct-state.json"
(cd "$TMP_ROOT" && PATH="$TMP_ROOT:$PATH" bash "$HARNESS_DIR/hooks/claude/session-start-context.sh") > "$TMP_ROOT/out" 2> "$TMP_ROOT/err"
[ "$?" -eq 0 ]
grep -Fq 'WARNING: Could not summarize pipeline state; continuing session context.' "$TMP_ROOT/err"
! grep -Fq 'Pipeline:' "$TMP_ROOT/out"
grep -Fq '=== End Harness Context ===' "$TMP_ROOT/out"
