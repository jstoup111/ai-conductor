#!/usr/bin/env bash
set -euo pipefail

# The typed as-built envelope is the sole routing authority. Markdown is an
# engine-rendered view: only its writer may name the path, while pair cleanup
# reaches it through the exported constant.
ROOT=${1:-"$(cd "$(dirname "$0")/.." && pwd)"}
ENGINE="$ROOT/src/conductor/src/engine"
REPORT_PATH='.pipeline/architecture-review-as-built.md'
REPORT_PATH_IDENTIFIER='AS_BUILT_REPORT_PATH'
ALLOWED_MODULES="
$ENGINE/as-built-verdict-store.ts
$ENGINE/rewind.ts
$ENGINE/artifacts.ts
"
FAIL=0

while IFS= read -r file; do
  case "$file" in
    $ENGINE/*)
      if ! printf '%s\n' "$ALLOWED_MODULES" | rg -F -x "$file" >/dev/null; then
        printf 'as-built Markdown authority violation: %s reads %s\n' "$file" "$REPORT_PATH" >&2
        FAIL=1
      fi
      ;;
  esac
done < <(rg -l -F -e "$REPORT_PATH" -e "$REPORT_PATH_IDENTIFIER" "$ENGINE" --glob '*.ts' || true)

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  printf 'as-built Markdown authority violation: %s\n' "$hit" >&2
  FAIL=1
done < <(rg -n -e '/([^/]|\\.)*(Verdict:|Governing clause)([^/]|\\.)*/[a-z]*' -e "new[[:space:]]+RegExp\\([[:space:]]*['\"][^'\"]*(Verdict:|Governing clause)" "$ENGINE" --glob '*.ts' || true)

exit "$FAIL"
