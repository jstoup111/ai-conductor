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
  TTY_OUT=$(cd "$CONSUMER" && printf '%s' "$input" | HOME="$HOME_DIR" PATH="$TEST_PATH" script -qec "$HARNESS/bin/migrate" /dev/null 2>&1)
  TTY_CODE=$?
  set -e
}

if ! command -v script >/dev/null 2>&1; then
  printf 'FAIL scripted TTY utility is required for migration approval coverage\n'
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

make_fixture invalid
run_tty $'wat\ny\ns\n'
PROMPT_COUNT=$(printf '%s\n' "$TTY_OUT" | rg -ic 'accept.*skip.*all.*stop' || true)
assert 'an invalid response is rejected and re-prompts before executing' "$(
  [ "$TTY_CODE" -eq 0 ] && [ "$PROMPT_COUNT" -ge 2 ] && contains "$TTY_OUT" 'Unrecognized response' && [ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = 'first' ] && echo 0 || echo 1
)"

printf '\n%d passed, %d failed, %d total\n' "$PASS" "$FAIL" "$TOTAL"
[ "$FAIL" -eq 0 ]
