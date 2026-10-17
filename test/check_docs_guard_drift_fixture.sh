#!/usr/bin/env bash
# Covers: task:6
# Covers: task:7
set -uo pipefail

# check_docs_guard_drift_fixture.sh — proves the docs-guard generator detects
# drift using only a disposable copy of the committed hook.
#
# Exit: 0 = generator detected the deliberate temporary-copy drift (exit 1)
#       1 = fixture setup failed or generator did not report that drift

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK="${HARNESS_DIR}/hooks/claude/docs-guard.sh"
GENERATOR="${HARNESS_INTEGRITY_DOCS_GUARD_GENERATOR:-${HARNESS_DIR}/bin/generate-docs-guard-hook}"

# A full-suite child can intentionally carry only the Vitest run-root marker.
# Keep this fixture inside that scope rather than falling back to the real
# operator tmpdir when TMPDIR was scrubbed on the way to the child.
fixture_tmpdir="${TMPDIR:-${AI_CONDUCTOR_TEST_TMP_ROOT:-/tmp}}"
fixture_dir=$(mktemp -d "${fixture_tmpdir}/docs-guard-drift-fixture-XXXXXX") || {
  echo "docs-guard drift fixture: temporary-copy failure: unable to create temporary copy directory" >&2
  exit 1
}
cleanup() { rm -rf "$fixture_dir"; }
trap cleanup EXIT

fixture_hook="${fixture_dir}/docs-guard.sh"
if ! cp "$HOOK" "$fixture_hook"; then
  echo "docs-guard drift fixture: temporary-copy failure: unable to copy hook to temporary fixture" >&2
  exit 1
fi

printf '\n# deliberately corrupted for drift-detection fixture test\n' >> "$fixture_hook"

set +e
GENERATE_DOCS_GUARD_HOOK_OUT="$fixture_hook" "$GENERATOR" --check
generator_exit=$?
set -e

if [ "$generator_exit" -eq 1 ]; then
  echo "docs-guard drift fixture: generator detected drift in temporary copy (exit 1)"
  exit 0
fi

echo "docs-guard drift fixture: expected generator exit 1 for temporary copy, got ${generator_exit}" >&2
exit 1
