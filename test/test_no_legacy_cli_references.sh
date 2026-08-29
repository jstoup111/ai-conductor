#!/usr/bin/env bash
set -euo pipefail

# Legacy CLI reference guard. The retired binary may appear only where this
# deprecation window explicitly documents its alias relationship.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

failures=0
while IFS= read -r hit; do
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
done < <(
  cd "$HARNESS_DIR"
  rg -n --no-heading --fixed-strings 'conduct-ts' src/conductor/src hooks skills || true
)

if [ "$failures" -ne 0 ]; then
  exit 1
fi

printf 'legacy CLI reference guard: PASS\n'
