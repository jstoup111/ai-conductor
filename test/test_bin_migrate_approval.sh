#!/usr/bin/env bash
set -euo pipefail

# Acceptance coverage for Task 10's interactive per-candidate approval loop.
# The real migrate entry point runs in isolated local harness/consumer fixtures;
# only its install boundary is a local no-op.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SRC="$REPO_ROOT/bin/migrate"

PASS=0
FAIL=0
TOTAL=0

assert() {
  local description=$1 result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

contains() {
  case "$1" in
    *"$2"*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! command -v rg >/dev/null 2>&1; then
  printf 'SKIP ripgrep is required for migration approval coverage\n'
  exit 0
fi

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

STUBS_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUBS_DIR"
PY3=$(python3 -c 'import sys; print(sys.executable)')
ln -s "$PY3" "$STUBS_DIR/python3"
TEST_PATH="$STUBS_DIR:$PATH"

make_fixture() {
  local name=$1
  HARNESS="$TMP_ROOT/harness-$name"
  CONSUMER="$TMP_ROOT/consumer-$name"
  HOME_DIR="$TMP_ROOT/home-$name"
  mkdir -p "$HARNESS/bin" "$CONSUMER" "$HOME_DIR/.claude"
  cp "$MIGRATE_SRC" "$HARNESS/bin/migrate"
  chmod +x "$HARNESS/bin/migrate"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$HARNESS/bin/install"
  chmod +x "$HARNESS/bin/install"
  printf '1.2.0\n' > "$HARNESS/VERSION"
  cat > "$HARNESS/CHANGELOG.md" <<'EOF'
# Changelog

## [1.2.0]

## Migration

```bash migration
printf 'first\n' >> execution.log
```

```bash migration
printf 'second\n' >> execution.log
```
EOF
  printf '{"currentVersion": "v1.1.0"}\n' > "$HOME_DIR/.claude/ai-conductor.config.json"
  git -C "$CONSUMER" init -q -b main
  git -C "$CONSUMER" config user.email test@example.com
  git -C "$CONSUMER" config user.name Test
  touch "$CONSUMER/.gitkeep"
  git -C "$CONSUMER" add .gitkeep
  git -C "$CONSUMER" commit -q -m initial
}

run_tty() {
  local input=$1
  set +e
  # A broken approval loop must not leave this acceptance test running forever.
  # --foreground lets timeout also terminate the scripted pseudo-terminal group.
  TTY_OUT=$(cd "$CONSUMER" && printf '%s' "$input" | HOME="$HOME_DIR" PATH="$TEST_PATH" timeout --foreground 10s script -qec "$HARNESS/bin/migrate" /dev/null 2>&1)
  TTY_CODE=$?
  set -e
}

run_no_tty() {
  set +e
  NO_TTY_OUT=$(cd "$CONSUMER" && HOME="$HOME_DIR" PATH="$TEST_PATH" "$HARNESS/bin/migrate" "$@" </dev/null 2>&1)
  NO_TTY_CODE=$?
  set -e
}

ledger_applied_count() {
  python3 - "$HOME_DIR/.ai-conductor/migrations" <<'PY'
import json
import sys
from pathlib import Path

ledgers = list(Path(sys.argv[1]).glob("*.json"))
if not ledgers:
    print(0)
else:
    print(len(json.loads(ledgers[0].read_text())["appliedBlocks"]))
PY
}

ledger_path() {
  find "$HOME_DIR/.ai-conductor/migrations" -name '*.json' -print -quit 2>/dev/null || true
}

summary_has_count() {
  local output=$1 label=$2 expected=$3
  printf '%s\n' "$output" | rg -iq "(^|[^[:alnum:]-])${label}[[:space:]]*[:=][[:space:]]*${expected}([^0-9]|$)"
}

if ! command -v script >/dev/null 2>&1; then
  printf 'FAIL scripted TTY utility is required for migration approval coverage\n'
  exit 1
fi

if ! command -v timeout >/dev/null 2>&1; then
  printf 'FAIL timeout utility is required to bound migration approval coverage\n'
  exit 1
fi

make_fixture accept
run_tty $'y\ns\n'
assert 'accept executes only the previewed candidate before a later stop' "$(
  [ "$TTY_CODE" -eq 0 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = 'first' ] && echo 0 || echo 1
)"
assert 'per-candidate preview names its release and positional index' "$(
  contains "$TTY_OUT" '1.2.0' && contains "$TTY_OUT" 'candidate block 1' && echo 0 || echo 1
)"

make_fixture skip
run_tty $'n\ns\n'
assert 'skip leaves the candidate pending and continues to the next prompt' "$(
  [ ! -e "$CONSUMER/execution.log" ] && contains "$TTY_OUT" 'candidate block 2' && echo 0 || echo 1
)"

make_fixture skip-rerun
run_tty $'n\ns\n'
SKIP_LEDGER_COUNT=$(ledger_applied_count)
run_tty $'a\n'
assert 'skipped and stopped blocks have no applied ledger entries before rerun' "$(
  [ "$SKIP_LEDGER_COUNT" -eq 0 ] && echo 0 || echo 1
)"
assert 'skip then stop re-offers exactly both pending blocks on rerun' "$(
  [ "$TTY_CODE" -eq 0 ] && contains "$TTY_OUT" "printf 'first" && contains "$TTY_OUT" "printf 'second" && [ "$(printf '%s\n' "$TTY_OUT" | rg -c 'Executing migration' || true)" -eq 2 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && echo 0 || echo 1
)"

make_fixture accept-all
run_tty $'a\n'
assert 'accept-all executes every remaining candidate' "$(
  [ "$TTY_CODE" -eq 0 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && echo 0 || echo 1
)"

make_fixture stop
run_tty $'s\n'
assert 'stop leaves the current and remaining candidates pending' "$(
  [ "$TTY_CODE" -eq 0 ] && [ ! -e "$CONSUMER/execution.log" ] && echo 0 || echo 1
)"

make_fixture stop-partway
run_tty $'y\ns\n'
STOP_LEDGER_COUNT=$(ledger_applied_count)
run_tty $'a\n'
assert 'stop after an applied prefix records only that prefix in the ledger' "$(
  [ "$STOP_LEDGER_COUNT" -eq 1 ] && echo 0 || echo 1
)"
assert 'stop partway re-offers exactly the unreached suffix on rerun' "$(
  [ "$TTY_CODE" -eq 0 ] && ! contains "$TTY_OUT" "printf 'first" && contains "$TTY_OUT" "printf 'second" && [ "$(printf '%s\n' "$TTY_OUT" | rg -c 'Previewing migration' || true)" -eq 1 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && echo 0 || echo 1
)"

make_fixture invalid
run_tty $'wat\ny\ns\n'
assert 'an invalid response is rejected and re-prompts before executing' "$(
  [ "$TTY_CODE" -eq 0 ] && contains "$TTY_OUT" 'Unrecognized response' && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = 'first' ] && echo 0 || echo 1
)"

make_fixture exhausted-input
run_tty ''
EOF_PROMPT_COUNT=$(printf '%s\n' "$TTY_OUT" | rg -ic 'accept.*skip.*all.*stop' || true)
case "$EOF_PROMPT_COUNT" in
  ''|*[!0-9]*) EOF_PROMPT_COUNT=0 ;;
esac
assert 'exhausted operator input fails closed before executing the pending block' "$(
  [ "$TTY_CODE" -ne 0 ] && [ "$TTY_CODE" -ne 124 ] && [ ! -e "$CONSUMER/execution.log" ] && echo 0 || echo 1
)"
assert 'exhausted operator input does not spin the approval prompt' "$(
  [ "$EOF_PROMPT_COUNT" -le 1 ] && echo 0 || echo 1
)"

make_fixture no-tty
run_no_tty
assert 'no-TTY execution leaves every pending block unexecuted and explains recovery' "$(
  [ "$NO_TTY_CODE" -eq 0 ] && [ ! -e "$CONSUMER/execution.log" ] && contains "$NO_TTY_OUT" 'pending' && contains "$NO_TTY_OUT" '--yes' && echo 0 || echo 1
)"
assert 'no-TTY summary counts pending blocks as skipped without applying or failing any' "$(
  summary_has_count "$NO_TTY_OUT" applied 0 && summary_has_count "$NO_TTY_OUT" skipped 2 && summary_has_count "$NO_TTY_OUT" failed 0 && summary_has_count "$NO_TTY_OUT" already-applied 0 && echo 0 || echo 1
)"

make_fixture no-tty-yes
run_no_tty --yes
assert '--yes applies and records every pending block without a TTY' "$(
  [ "$NO_TTY_CODE" -eq 0 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && [ "$(ledger_applied_count)" -eq 2 ] && echo 0 || echo 1
)"
assert '--yes summary reports applied blocks with no skipped or failed outcomes' "$(
  summary_has_count "$NO_TTY_OUT" applied 2 && summary_has_count "$NO_TTY_OUT" skipped 0 && summary_has_count "$NO_TTY_OUT" failed 0 && summary_has_count "$NO_TTY_OUT" already-applied 0 && echo 0 || echo 1
)"

make_fixture dry-run
run_no_tty --yes
DRY_LEDGER=$(ledger_path)
DRY_LEDGER_BEFORE=$(cat "$DRY_LEDGER")
cat >> "$HARNESS/CHANGELOG.md" <<'EOF'

```bash migration
printf 'third\n' >> execution.log
```
EOF
run_no_tty --dry-run
assert '--dry-run leaves an existing ledger byte-for-byte unchanged' "$(
  [ "$NO_TTY_CODE" -eq 0 ] && [ "$(cat "$DRY_LEDGER")" = "$DRY_LEDGER_BEFORE" ] && echo 0 || echo 1
)"
assert '--dry-run executes no newly pending migration block' "$(
  [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && echo 0 || echo 1
)"
assert '--dry-run summary classifies every previewed block without applying or failing it' "$(
  summary_has_count "$NO_TTY_OUT" applied 0 && summary_has_count "$NO_TTY_OUT" skipped 1 && summary_has_count "$NO_TTY_OUT" failed 0 && summary_has_count "$NO_TTY_OUT" already-applied 2 && echo 0 || echo 1
)"

make_fixture version-advanced-rerun
run_no_tty
printf '{"currentVersion": "v1.2.0"}\n' > "$HOME_DIR/.claude/ai-conductor.config.json"
run_no_tty --yes
assert 'a version advance after a no-TTY run cannot make pending blocks unreachable' "$(
  [ "$NO_TTY_CODE" -eq 0 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && echo 0 || echo 1
)"
run_no_tty --yes
assert 'rerun summary reports already-applied blocks without re-executing them' "$(
  [ "$NO_TTY_CODE" -eq 0 ] && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = $'first\nsecond' ] && summary_has_count "$NO_TTY_OUT" applied 0 && summary_has_count "$NO_TTY_OUT" skipped 0 && summary_has_count "$NO_TTY_OUT" failed 0 && summary_has_count "$NO_TTY_OUT" already-applied 2 && echo 0 || echo 1
)"

make_fixture failure-summary
cat >> "$HARNESS/CHANGELOG.md" <<'EOF'

```bash migration
false
```
EOF
run_no_tty --yes
assert 'a failed block produces a four-way summary with the failed count' "$(
  [ "$NO_TTY_CODE" -ne 0 ] && summary_has_count "$NO_TTY_OUT" applied 2 && summary_has_count "$NO_TTY_OUT" skipped 0 && summary_has_count "$NO_TTY_OUT" failed 1 && summary_has_count "$NO_TTY_OUT" already-applied 0 && echo 0 || echo 1
)"

printf '\n%d passed, %d failed, %d total\n' "$PASS" "$FAIL" "$TOTAL"
[ "$FAIL" -eq 0 ]
