#!/usr/bin/env bash
set -euo pipefail

# Regression coverage for executable migration content in the frozen 0.99.20
# release entry. It deliberately inspects only that entry, which is the bounded
# changelog exemption approved for this feature.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANGELOG="$SCRIPT_DIR/../CHANGELOG.md"
ENTRY=$(sed -n '/^## \[0\.99\.20\] /,/^## \[0\.99\.17\] /p' "$CHANGELOG")
BLOCKS=$(awk '
  /^```bash migration$/ { in_block = 1; next }
  /^```$/ { in_block = 0; next }
  in_block { print }
' <<<"$ENTRY")

PASS=0
FAIL=0

assert_absent() {
  local description=$1 pattern=$2
  if grep -Eq "$pattern" <<<"$BLOCKS"; then
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  else
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  fi
}

assert_present() {
  local description=$1 pattern=$2
  if grep -Fq "$pattern" <<<"$BLOCKS"; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

assert_absent '0.99.20 blocks do not invoke harness binaries through relative paths' \
  '(^|[[:space:]])\./bin/(install|conduct|conduct-ts)'
assert_absent '0.99.20 blocks do not force-remove consumer worktrees or branches' \
  'git (worktree remove --force|branch -D)'
assert_absent '0.99.20 blocks do not perform daemon lifecycle actions' \
  '(conduct-ts daemon (start|stop|restart)|kill "\$pid")'
assert_present 'the attribution config guard matches its commented template' \
  "grep -qF '# attribution_judge_cutover: \"2026-07-11T08:30:00Z\"' \"\$CONFIG_FILE\""

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
