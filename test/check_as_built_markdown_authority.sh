#!/usr/bin/env bash
set -euo pipefail

# The typed as-built envelope is the sole routing authority. Markdown is an
# engine-rendered view: only its writer may name the path, while pair cleanup
# reaches it through the exported constant.
ROOT=${1:-"$(cd "$(dirname "$0")/.." && pwd)"}
ENGINE="$ROOT/src/conductor/src/engine"
REPORT_PATH='.pipeline/architecture-review-as-built.md'
FAIL=0

while IFS= read -r file; do
  case "$file" in
    "$ENGINE/as-built-verdict-store.ts") ;;
    *) printf 'as-built Markdown authority violation: %s reads %s\n' "$file" "$REPORT_PATH" >&2; FAIL=1 ;;
  esac
done < <(rg -l -F "$REPORT_PATH" "$ENGINE" --glob '*.ts' || true)

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  printf 'as-built Markdown authority violation: %s\n' "$hit" >&2
  FAIL=1
done < <(rg -n '/([^/]|\\.)*(Verdict:|Governing clause)([^/]|\\.)*/[a-z]*' "$ENGINE" --glob '*.ts' || true)

exit "$FAIL"
