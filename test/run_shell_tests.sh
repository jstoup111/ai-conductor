#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/shell_tests.manifest"
TEST_DIR="$SCRIPT_DIR"

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
      # Accepted now so callers can use the final runner interface. Per-script
      # timeout enforcement is added with the negative-path behavior.
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

source "$SCRIPT_DIR/shell_test_manifest.sh"

SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/shell-tests.XXXXXX")"
cleanup() {
  local status=$?
  rm -rf -- "$SANDBOX_ROOT"
  exit "$status"
}
trap cleanup EXIT

while IFS=$'\t' read -r name class _parent _reason; do
  [ "$class" = 'shell-runner' ] || continue

  sandbox="$SANDBOX_ROOT/$name"
  mkdir -p "$sandbox/home" "$sandbox/tmp" "$sandbox/xdg-config" \
    "$sandbox/xdg-cache" "$sandbox/xdg-data"

  env \
    HOME="$sandbox/home" \
    TMPDIR="$sandbox/tmp" \
    XDG_CONFIG_HOME="$sandbox/xdg-config" \
    XDG_CACHE_HOME="$sandbox/xdg-cache" \
    XDG_DATA_HOME="$sandbox/xdg-data" \
    GIT_CONFIG_GLOBAL="$sandbox/gitconfig" \
    bash "$TEST_DIR/$name"
  printf 'PASS %s\n' "$name"
done < <(shell_test_manifest_entries "$MANIFEST")
