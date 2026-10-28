#!/usr/bin/env bash
set -euo pipefail

# test_conductor_npm_no_audit.sh — install paths never wait on npm's automatic
# audit or funding lookups (#3344).
#
# bin/install runs `npm ci` and bin/setup runs `npm install`, both from
# src/conductor. The project-level src/conductor/.npmrc must resolve
# audit=false and fund=false there, even when the operator's user and global
# npm config enable them. Only `npm config get` runs: no registry call.
#
# Usage: ./test/test_conductor_npm_no_audit.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONDUCTOR_DIR="$HARNESS_DIR/src/conductor"

PASS=0
FAIL=0

TMPDIR_ROOT=$(mktemp -d)
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

# Operator-level config that turns both lookups on; the project file must win.
printf 'audit=true\nfund=true\n' > "$TMPDIR_ROOT/user-npmrc"
cp "$TMPDIR_ROOT/user-npmrc" "$TMPDIR_ROOT/global-npmrc"

resolve() {
  (cd "$CONDUCTOR_DIR" && env -u npm_config_audit -u npm_config_fund \
    -u NPM_CONFIG_AUDIT -u NPM_CONFIG_FUND \
    npm_config_userconfig="$TMPDIR_ROOT/user-npmrc" \
    npm_config_globalconfig="$TMPDIR_ROOT/global-npmrc" \
    npm config get "$1")
}

for key in audit fund; do
  actual=$(resolve "$key")
  if [ "$actual" = "false" ]; then
    echo "  PASS npm $key resolves false in src/conductor"
    PASS=$((PASS + 1))
  else
    echo "  FAIL npm $key resolves '$actual' in src/conductor (expected false)"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
