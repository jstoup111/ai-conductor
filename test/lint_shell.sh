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
#
# DECLARED_EXCLUSIONS is the only sanctioned way to keep a shell file out of
# both lint gates. Paths are repo-relative and exact; never rely on a glob
# failing to match to remove a file from coverage.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEVERITY="${SHELLCHECK_SEVERITY:-error}"
DECLARED_EXCLUSIONS=""

is_declared_exclusion() {
  local relative_path=$1
  [ -n "$DECLARED_EXCLUSIONS" ] && grep -Fxq "$relative_path" <<<"$DECLARED_EXCLUSIONS"
}

print_unless_excluded() {
  local script=$1
  local relative_path="${script#"${HARNESS_DIR}/"}"
  is_declared_exclusion "$relative_path" || printf '%s\n' "$script"
}

# Enumerate the same surface integrity check 1 syntax-checks: every bash script
# under bin/, hooks/, test/, and .github/scripts/. bin/ holds extensionless
# executables, so it is selected by shebang rather than by suffix.
collect_scripts() {
  local script
  while IFS= read -r -d '' script; do
    head -1 "$script" | grep -qE '^#!.*(bash|sh)' || continue
    print_unless_excluded "$script"
  done < <(find -L "${HARNESS_DIR}/bin" -type f -print0 2>/dev/null)
  while IFS= read -r -d '' script; do
    print_unless_excluded "$script"
  done < <(find "${HARNESS_DIR}/hooks" "${HARNESS_DIR}/test" "${HARNESS_DIR}/.github/scripts" \
    -type f -name '*.sh' -print0 2>/dev/null)
}

# Sort for stable, reviewable output ordering across machines.
SCRIPTS=()
while IFS= read -r line; do
  [ -n "$line" ] && SCRIPTS+=("$line")
done < <(collect_scripts | sort -u)

# Guard against a silently-empty file set. An enumeration bug here would make the
# gate report success while checking nothing — the exact failure mode this repo
# has already been bitten by (an empty array guard deleting 74 worktrees).
if [ "${#SCRIPTS[@]}" -eq 0 ]; then
  echo "lint_shell: enumerated 0 scripts — enumeration is broken, refusing to report success" >&2
  exit 2
fi

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "${SCRIPTS[@]}"
  exit 0
fi

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "lint_shell: shellcheck not installed" >&2
  exit 127
fi

shellcheck --severity="$SEVERITY" --format=gcc "${SCRIPTS[@]}"
