#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR"
MANIFEST="$SCRIPT_DIR/shell_tests.manifest"
INTEGRITY="$SCRIPT_DIR/test_harness_integrity.sh"

usage() {
  printf 'usage: %s [--test-dir D] [--manifest F] [--integrity F]\n' "${0##*/}" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --test-dir) TEST_DIR=${2:?missing value for --test-dir}; shift 2 ;;
    --manifest) MANIFEST=${2:?missing value for --manifest}; shift 2 ;;
    --integrity) INTEGRITY=${2:?missing value for --integrity}; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

# shellcheck source=shell_test_manifest.sh
source "$SCRIPT_DIR/shell_test_manifest.sh"

declare -A CLASS_BY_NAME
declare -A PARENT_BY_NAME
declare -A REASON_BY_NAME

while IFS=$'\t' read -r name class parent reason; do
  [ -n "$name" ] || continue
  CLASS_BY_NAME["$name"]=$class
  PARENT_BY_NAME["$name"]=$parent
  REASON_BY_NAME["$name"]=$reason
done < <(shell_test_manifest_entries "$MANIFEST")

script_count=0
while IFS= read -r script; do
  name=${script##*/}
  class=${CLASS_BY_NAME[$name]-}
  case "$class" in
    integrity)
      if [ "$name" != "${INTEGRITY##*/}" ] && ! shell_test_parent_invokes_child "$INTEGRITY" "$name"; then
        printf 'UNVERIFIED integrity: %s\n' "$name" >&2
        exit 1
      fi
      ;;
    invoked-by:*)
      parent=${PARENT_BY_NAME[$name]}
      if ! shell_test_parent_invokes_child "$TEST_DIR/$parent" "$name"; then
        printf 'UNVERIFIED invoked-by: %s parent %s\n' "$name" "$parent" >&2
        exit 1
      fi
      ;;
    sourced-helper|shell-runner) ;;
    *)
      printf 'UNCLASSIFIED: %s\n' "$name" >&2
      exit 1
      ;;
  esac
  script_count=$((script_count + 1))
done < <(find "$TEST_DIR" -maxdepth 1 -type f -name '*.sh' -printf '%f\n' | LC_ALL=C sort)

printf 'shell-test classification: %s scripts classified\n' "$script_count"
