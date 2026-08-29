#!/usr/bin/env bash
set -euo pipefail

# Covers Task 13's scanner-backend contract for the legacy CLI reference guard.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_SOURCE="$HARNESS_DIR/test/test_no_legacy_cli_references.sh"
BASH_BIN="$(command -v bash)"
GREP_BIN="$(command -v grep)"
DIRNAME_BIN="$(command -v dirname)"

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

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

GREP_PATH="$TMP_ROOT/grep-path"
RG_PATH="$TMP_ROOT/rg-path"
NO_SCANNER_PATH="$TMP_ROOT/no-scanner-path"
SUPPORT_PATH="$TMP_ROOT/support-path"
mkdir -p "$GREP_PATH" "$RG_PATH" "$NO_SCANNER_PATH" "$SUPPORT_PATH"
ln -s "$GREP_BIN" "$GREP_PATH/grep"
ln -s "$DIRNAME_BIN" "$SUPPORT_PATH/dirname"

# A deterministic rg stand-in exercises the guard's preferred-backend branch
# without making this regression test itself require ripgrep. It preserves the
# guard's path:line:text hit shape by using the specified grep equivalent.
cat > "$RG_PATH/rg" <<EOF
#!$BASH_BIN
set -euo pipefail
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    -n|--no-heading|--fixed-strings) shift ;;
    --glob) shift 2 ;;
    *) break ;;
  esac
done
needle=\$1
shift
paths=()
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --glob) shift 2 ;;
    *) paths+=("\$1"); shift ;;
  esac
done
exec "$GREP_BIN" -rInH --fixed-strings --exclude-dir=node_modules "\$needle" "\${paths[@]}"
EOF
chmod +x "$RG_PATH/rg"

make_fixture() {
  local name=$1 planted_path=$2
  local fixture="$TMP_ROOT/$name"

  mkdir -p "$fixture/test" "$fixture/src/conductor/src" "$fixture/hooks" \
    "$fixture/skills" "$fixture/bin" "$fixture/docs/reference"
  cp "$GUARD_SOURCE" "$fixture/test/test_no_legacy_cli_references.sh"
  chmod +x "$fixture/test/test_no_legacy_cli_references.sh"
  : > "$fixture/README.md"
  : > "$fixture/HARNESS.md"
  : > "$fixture/docs/reference/cli.md"
  : > "$fixture/docs/reference/skills.md"
  printf 'non-allowlisted conduct-ts reference\n' > "$fixture/$planted_path"
  printf '%s\n' "$fixture"
}

run_guard() {
  local path=$1 fixture=$2
  set +e
  GUARD_OUTPUT=$(PATH="$path:$SUPPORT_PATH" "$BASH_BIN" "$fixture/test/test_no_legacy_cli_references.sh" 2>&1)
  GUARD_EXIT=$?
  set -e
}

echo '=== legacy CLI guard: scanner backends ==='

fixture=$(make_fixture missing-scanners 'src/conductor/src/planted.txt')
run_guard "$NO_SCANNER_PATH" "$fixture"
assert 'missing rg and grep exits non-zero and names both scanners' "$(
  [ "$GUARD_EXIT" -ne 0 ] && [[ "$GUARD_OUTPUT" == *rg* ]] && [[ "$GUARD_OUTPUT" == *grep* ]] && echo 0 || echo 1
)"

for planted_path in \
  'src/conductor/src/planted.txt' \
  'hooks/planted.txt' \
  'skills/planted.txt' \
  'bin/planted.txt' \
  'README.md' \
  'HARNESS.md' \
  'docs/reference/cli.md' \
  'docs/reference/skills.md'; do
  fixture=$(make_fixture "$(tr '/' '-' <<<"$planted_path")" "$planted_path")

  run_guard "$RG_PATH" "$fixture"
  rg_exit=$GUARD_EXIT
  rg_output=$GUARD_OUTPUT

  run_guard "$GREP_PATH" "$fixture"
  grep_exit=$GUARD_EXIT
  grep_output=$GUARD_OUTPUT

  expected_hit="$planted_path:1:non-allowlisted conduct-ts reference"
  assert "grep fallback rejects planted reference in $planted_path" "$(
    [ "$grep_exit" -ne 0 ] && [[ "$grep_output" == *"$expected_hit"* ]] && echo 0 || echo 1
  )"
  assert "both backends agree for planted reference in $planted_path" "$(
    [ "$rg_exit" -eq "$grep_exit" ] && [ "$rg_output" = "$grep_output" ] && echo 0 || echo 1
  )"
done

printf '\n=== Summary: %s/%s passed ===\n' "$PASS" "$TOTAL"
[ "$FAIL" -eq 0 ]
