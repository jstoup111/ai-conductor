#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/shell_tests.manifest"
TEST_DIR="$SCRIPT_DIR"
TIMEOUT_SECONDS="${SHELL_TEST_TIMEOUT:-600}"

usage() {
  echo "usage: $0 [--manifest FILE] [--test-dir DIR] [--timeout SECONDS]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest)
      MANIFEST=${2:?--manifest requires a file path}
      shift 2
      ;;
    --test-dir)
      TEST_DIR=${2:?--test-dir requires a directory path}
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS=${2:?--timeout requires a number of seconds}
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

source "$SCRIPT_DIR/shell_test_manifest.sh"

if [ ! -r "$MANIFEST" ]; then
  printf 'UNREADABLE MANIFEST: %s\n' "$MANIFEST" >&2
  exit 1
fi

shell_runner_count=0
while IFS=$'\t' read -r _name class _parent _reason; do
  [ "$class" = 'shell-runner' ] && shell_runner_count=$((shell_runner_count + 1))
done < <(shell_test_manifest_entries "$MANIFEST")

if [ "$shell_runner_count" -eq 0 ]; then
  printf 'EMPTY MANIFEST: %s\n' "$MANIFEST" >&2
  exit 1
fi

SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/shell-tests.XXXXXX")"
cleanup() {
  local status=$?
  rm -rf -- "$SANDBOX_ROOT"
  return "$status"
}
trap cleanup EXIT

passed=0
failed=0
while IFS=$'\t' read -r name class _parent _reason; do
  [ "$class" = 'shell-runner' ] || continue

  sandbox="$SANDBOX_ROOT/$name"
  mkdir -p "$sandbox/home" "$sandbox/tmp" "$sandbox/xdg-config" \
    "$sandbox/xdg-cache" "$sandbox/xdg-data"

  set +e
  env \
    -u GH_TOKEN \
    -u GITHUB_TOKEN \
    -u CLAUDE_CODE_OAUTH_TOKEN \
    -u ANTHROPIC_API_KEY \
    -u OPENAI_API_KEY \
    -u CODEX_HOME \
    HOME="$sandbox/home" \
    TMPDIR="$sandbox/tmp" \
    XDG_CONFIG_HOME="$sandbox/xdg-config" \
    XDG_CACHE_HOME="$sandbox/xdg-cache" \
    XDG_DATA_HOME="$sandbox/xdg-data" \
    GIT_CONFIG_GLOBAL="$sandbox/gitconfig" \
    timeout --kill-after=10s "$TIMEOUT_SECONDS" bash "$TEST_DIR/$name"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    printf 'PASS %s\n' "$name"
    passed=$((passed + 1))
  elif [ "$status" -eq 124 ]; then
    printf 'TIMEOUT %s after %ss\n' "$name" "$TIMEOUT_SECONDS"
    failed=$((failed + 1))
  else
    printf 'FAIL %s (exit %s)\n' "$name" "$status"
    failed=$((failed + 1))
  fi
done < <(shell_test_manifest_entries "$MANIFEST")

printf 'shell tests: %s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
