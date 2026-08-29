#!/usr/bin/env bash
set -euo pipefail

# Legacy CLI reference guard. The retired binary may appear only where this
# deprecation window explicitly documents its alias relationship.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

failures=0
if ! command -v rg >/dev/null 2>&1; then
  printf 'legacy CLI reference guard: required scanner rg is unavailable\n' >&2
  exit 1
fi

set +e
scan_output=$(cd "$HARNESS_DIR" && rg -n --no-heading --fixed-strings 'conduct-ts' \
  src/conductor/src hooks skills bin/lib README.md HARNESS.md docs/reference/cli.md docs/reference/skills.md)
scan_exit=$?
set -e

case "$scan_exit" in
  0) ;;
  1) scan_output='' ;;
  *)
    printf 'legacy CLI reference guard: rg scan failed (exit %s)\n' "$scan_exit" >&2
    exit "$scan_exit"
    ;;
esac

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  path=${hit%%:*}
  remainder=${hit#*:}
  text=${remainder#*:}

  case "$path:$text" in
    # Installed binary alias symlink chain.
    'src/conductor/src/index.ts:// installed layout can be a symlink chain (~/.local/bin/conduct-ts →')
      ;;
    # Installed binary alias symlink chain target.
    'src/conductor/src/index.ts:// <harness>/bin/conduct-ts → <harness>/src/conductor/dist/index.js).')
      ;;
    # Direct-execution guard names the deprecated launcher path.
    'src/conductor/src/index.ts:// bin/conduct-ts) — NOT when imported (e.g. by tests importing `deriveMode`).')
      ;;
    # The compatibility `engineer` verb remains explicitly documented as an alias.
    src/conductor/src/engine/engineer-cli.ts:*'conduct-ts engineer'*'deprecated alias.'*)
      ;;
    *)
      printf 'non-allowlisted conduct-ts reference: %s\n' "$hit" >&2
      failures=1
      ;;
  esac
done <<< "$scan_output"

if [ "$failures" -ne 0 ]; then
  exit 1
fi

printf 'legacy CLI reference guard: PASS\n'
