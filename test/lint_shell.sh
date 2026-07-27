#!/bin/bash
# ShellCheck gate for the harness's bash surface.
#
# Single source of truth for BOTH callers — CI (.github/workflows/ci.yml) and
# integrity check 1b (test/test_harness_integrity.sh) — so the enforced file set
# and severity threshold can never drift apart between them.
#
# THRESHOLD: `error` by default (override with SHELLCHECK_SEVERITY).
#
# `error` is a deliberately low bar: it is the bar the tree passes TODAY, which
# makes this gate enforcing from the moment it lands instead of advisory. It is a
# ratchet floor, not a claim that warnings are unimportant.
#
# Deferred, measured with shellcheck 0.11.0 over the 57 scripts enumerated here:
#   severity=warning ->  91 findings / 21 files
#   severity=info    -> 171 findings / 28 files
#   severity=style   -> 191 findings / 30 files
#
# Raising the floor to `warning` is a genuine follow-up but not a mechanical one:
# 45 of the 91 warnings are SC2319 fired against this repo's deliberate
# `assert "desc" "$(cmd; echo $?)"` idiom, where `$?` is precisely the value
# wanted. Clearing those means reworking the assertion helper across the bash
# suite — a refactor with its own review, not a lint sweep.
#
# Usage:
#   test/lint_shell.sh           # check; non-zero exit on any finding
#   test/lint_shell.sh --list    # print the enumerated file set, one per line
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEVERITY="${SHELLCHECK_SEVERITY:-error}"

# Enumerate the same surface integrity check 1 syntax-checks: every bash script
# under bin/, hooks/, test/, and .github/scripts/. bin/ holds extensionless
# executables, so it is selected by shebang rather than by suffix.
collect_scripts() {
  local script
  for script in "${HARNESS_DIR}"/bin/*; do
    [ -f "$script" ] || continue
    head -1 "$script" | grep -qE '^#!.*(bash|sh)' && printf '%s\n' "$script"
  done
  find "${HARNESS_DIR}/hooks" "${HARNESS_DIR}/test" "${HARNESS_DIR}/.github/scripts" \
    -type f -name '*.sh' 2>/dev/null
}

# Sort for stable, reviewable output ordering across machines.
SCRIPTS=()
while IFS= read -r line; do
  [ -n "$line" ] && SCRIPTS+=("$line")
done < <(collect_scripts | sort -u)

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "${SCRIPTS[@]}"
  exit 0
fi

# Guard against a silently-empty file set. An enumeration bug here would make the
# gate report success while checking nothing — the exact failure mode this repo
# has already been bitten by (an empty array guard deleting 74 worktrees).
if [ "${#SCRIPTS[@]}" -eq 0 ]; then
  echo "lint_shell: enumerated 0 scripts — enumeration is broken, refusing to report success" >&2
  exit 2
fi

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "lint_shell: shellcheck not installed" >&2
  exit 127
fi

shellcheck --severity="$SEVERITY" --format=gcc "${SCRIPTS[@]}"
