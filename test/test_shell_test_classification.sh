#!/usr/bin/env bash
# Acceptance coverage for valid shell-test classification declarations.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="$REPO_ROOT/test/check_shell_test_classification.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

FIXTURE_TEST_DIR="$TMP_ROOT/test"
MANIFEST="$TMP_ROOT/shell_tests.manifest"
INTEGRITY="$FIXTURE_TEST_DIR/test_harness_integrity.sh"
mkdir -p "$FIXTURE_TEST_DIR"

for script in test_harness_integrity.sh test_integrity_case.sh parent.sh child.sh test_helpers.sh; do
  printf '#!/usr/bin/env bash\n' > "$FIXTURE_TEST_DIR/$script"
done
printf 'bash test_integrity_case.sh\nbash parent.sh\n' >> "$INTEGRITY"
printf 'bash child.sh\n' >> "$FIXTURE_TEST_DIR/parent.sh"

cat > "$MANIFEST" <<'MANIFEST'
test_harness_integrity.sh integrity is the integrity entry point
test_integrity_case.sh integrity invoked directly by integrity
parent.sh integrity invoked directly by integrity
child.sh invoked-by:parent.sh invoked by the integrity-run parent
test_helpers.sh sourced-helper shared fixture helpers are sourced
MANIFEST

set +e
output="$(bash "$CHECKER" --test-dir "$FIXTURE_TEST_DIR" --manifest "$MANIFEST" --integrity "$INTEGRITY" 2>&1)"
status=$?
set -e

if [ "$status" -ne 0 ]; then
  printf 'FAIL valid classification fixture exited %s\n%s\n' "$status" "$output" >&2
  exit 1
fi

if ! grep -Fxq 'shell-test classification: 5 scripts classified' <<<"$output"; then
  printf 'FAIL valid classification fixture missing count line\n%s\n' "$output" >&2
  exit 1
fi

printf 'PASS valid shell-test declarations classify all fixture scripts\n'
