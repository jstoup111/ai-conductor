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

run_fixture() {
  local fixture_name=$1
  local expected=$2
  local fixture_root="$TMP_ROOT/$fixture_name"
  local fixture_test_dir="$fixture_root/test"
  local fixture_manifest="$fixture_root/shell_tests.manifest"
  local fixture_integrity="$fixture_test_dir/test_harness_integrity.sh"
  local fixture_output fixture_status

  mkdir -p "$fixture_test_dir"
  printf '#!/usr/bin/env bash\n' > "$fixture_integrity"

  shift 2
  "$@" "$fixture_test_dir" "$fixture_manifest" "$fixture_integrity"

  set +e
  fixture_output="$(bash "$CHECKER" --test-dir "$fixture_test_dir" --manifest "$fixture_manifest" --integrity "$fixture_integrity" 2>&1)"
  fixture_status=$?
  set -e

  if [ "$fixture_status" -eq 0 ] || ! grep -Fxq "$expected" <<<"$fixture_output" || grep -Fq 'scripts classified' <<<"$fixture_output"; then
    printf 'FAIL %s: expected exit 1 and %s\n%s\n' "$fixture_name" "$expected" "$fixture_output" >&2
    exit 1
  fi
}

write_unlisted_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/unlisted.sh"
  printf 'test_harness_integrity.sh integrity entry point\n' > "$fixture_manifest"
}

write_stale_fixture() {
  local _fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf 'test_harness_integrity.sh integrity entry point\nstale.sh shell-runner runs in the shell runner\n' > "$fixture_manifest"
}

write_duplicate_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/duplicate.sh"
  printf 'test_harness_integrity.sh integrity entry point\nduplicate.sh shell-runner runs in the shell runner\nduplicate.sh shell-runner listed twice\n' > "$fixture_manifest"
}

write_invalid_class_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/invalid.sh"
  printf 'test_harness_integrity.sh integrity entry point\ninvalid.sh runs-sometimes an invalid class\n' > "$fixture_manifest"
}

write_reasonless_integrity_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/reasonless-integrity.sh"
  printf 'test_harness_integrity.sh integrity entry point\nreasonless-integrity.sh integrity\n' > "$fixture_manifest"
}

write_reasonless_invoked_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/reasonless-invoked.sh"
  printf 'test_harness_integrity.sh integrity entry point\nreasonless-invoked.sh invoked-by:parent.sh\n' > "$fixture_manifest"
}

write_reasonless_helper_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/reasonless-helper.sh"
  printf 'test_harness_integrity.sh integrity entry point\nreasonless-helper.sh sourced-helper\n' > "$fixture_manifest"
}

run_fixture unlisted 'UNCLASSIFIED: unlisted.sh' write_unlisted_fixture
run_fixture stale 'STALE ENTRY: stale.sh' write_stale_fixture
run_fixture duplicate 'DUPLICATE ENTRY: duplicate.sh' write_duplicate_fixture
run_fixture invalid-class 'INVALID CLASS: invalid.sh runs-sometimes' write_invalid_class_fixture
run_fixture reasonless-integrity 'MISSING REASON: reasonless-integrity.sh' write_reasonless_integrity_fixture
run_fixture reasonless-invoked 'MISSING REASON: reasonless-invoked.sh' write_reasonless_invoked_fixture
run_fixture reasonless-helper 'MISSING REASON: reasonless-helper.sh' write_reasonless_helper_fixture

printf 'PASS invalid shell-test declarations are rejected\n'

write_comment_only_integrity_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/comment-only.sh"
  printf '# bash comment-only.sh\n' >> "$fixture_integrity"
  printf 'test_harness_integrity.sh integrity entry point\ncomment-only.sh integrity comment-only reference\n' > "$fixture_manifest"
}

write_unverified_parent_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/parent.sh"
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/child.sh"
  printf 'test_harness_integrity.sh integrity entry point\nparent.sh integrity integrity invokes parent\nchild.sh invoked-by:parent.sh parent invokes child\n' > "$fixture_manifest"
}

write_unlisted_parent_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\nbash child.sh\n' > "$fixture_test_dir/parent.sh"
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/child.sh"
  printf 'test_harness_integrity.sh integrity entry point\nchild.sh invoked-by:parent.sh parent invokes child\n' > "$fixture_manifest"
}

write_helper_parent_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\nbash child.sh\n' > "$fixture_test_dir/helper.sh"
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/child.sh"
  printf 'test_harness_integrity.sh integrity entry point\nhelper.sh sourced-helper helper names child\nchild.sh invoked-by:helper.sh helper invokes child\n' > "$fixture_manifest"
}

write_cycle_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\nbash second.sh\n' > "$fixture_test_dir/first.sh"
  printf '#!/usr/bin/env bash\nbash first.sh\n' > "$fixture_test_dir/second.sh"
  printf 'test_harness_integrity.sh integrity entry point\nfirst.sh invoked-by:second.sh cycle member\nsecond.sh invoked-by:first.sh cycle member\n' > "$fixture_manifest"
}

write_empty_enumeration_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 fixture_integrity=$3
  rm -f "$fixture_integrity"
  printf 'test_harness_integrity.sh integrity entry point\n' > "$fixture_manifest"
}

write_unreadable_manifest_fixture() {
  local fixture_test_dir=$1 fixture_manifest=$2 _fixture_integrity=$3
  printf '#!/usr/bin/env bash\n' > "$fixture_test_dir/runner.sh"
  rm -f "$fixture_manifest"
}

run_fixture comment-only-integrity 'UNVERIFIED integrity: comment-only.sh' write_comment_only_integrity_fixture
run_fixture unverified-parent 'UNVERIFIED invoked-by: child.sh parent parent.sh' write_unverified_parent_fixture
run_fixture unlisted-parent 'UNVERIFIED invoked-by: child.sh parent parent.sh' write_unlisted_parent_fixture
run_fixture helper-parent 'UNVERIFIED invoked-by: child.sh parent helper.sh' write_helper_parent_fixture
run_fixture cycle 'UNVERIFIED invoked-by: first.sh parent second.sh' write_cycle_fixture
run_fixture empty-enumeration 'EMPTY ENUMERATION' write_empty_enumeration_fixture
run_fixture unreadable-manifest "UNREADABLE MANIFEST: $TMP_ROOT/unreadable-manifest/shell_tests.manifest" write_unreadable_manifest_fixture

printf 'PASS unverified invocations and unreadable inputs are rejected\n'
