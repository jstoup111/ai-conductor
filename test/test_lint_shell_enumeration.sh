#!/usr/bin/env bash
# Focused regression coverage for the shared shell-script enumerator.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINTER_SOURCE="$REPO_ROOT/test/lint_shell.sh"
INTEGRITY_SOURCE="$REPO_ROOT/test/test_harness_integrity.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description" >&2
    FAIL=$((FAIL + 1))
  fi
}

fixture_root() {
  local name=$1
  local root="$TMP_ROOT/$name"
  mkdir -p "$root/test" "$root/bin/nested/deeper" "$root/hooks" "$root/.github/scripts"
  cp "$LINTER_SOURCE" "$root/test/lint_shell.sh"
  chmod +x "$root/test/lint_shell.sh"
  printf '%s\n' "$root"
}

list_scripts() {
  local root=$1
  "$root/test/lint_shell.sh" --list
}

assert_list_has() {
  local description=$1 list=$2 expected=$3
  if grep -qx "$expected" <<<"$list"; then
    assert "$description" 0
  else
    assert "$description" 1
  fi
}

assert_list_lacks() {
  local description=$1 list=$2 unwanted=$3
  if grep -qx "$unwanted" <<<"$list"; then
    assert "$description" 1
  else
    assert "$description" 0
  fi
}

assert_integrity_uses_shared_list() {
  local file=$1 syntax_section
  syntax_section="$(sed -n '/^# ── 1\. Bash syntax/,/^# ── 1b\./p' "$file")"
  if ! grep -q 'test/lint_shell.sh" --list' <<<"$syntax_section"; then
    echo "syntax-check section must invoke test/lint_shell.sh --list" >&2
    return 1
  fi
  if grep -qE '"\$\{HARNESS_DIR\}"/(bin|hooks|test|\.github/scripts)/\*' <<<"$syntax_section"; then
    echo "syntax-check section must not enumerate directory globs" >&2
    return 1
  fi
}

root="$(fixture_root nested)"
printf '#!/usr/bin/env bash\necho nested\n' > "$root/bin/nested/deeper/tool"
printf '#!/usr/bin/env bash\necho sibling\n' > "$root/bin/sibling"
ln -s ../sibling "$root/bin/nested/linked-tool"
printf '#!/usr/bin/env python3\nprint("python")\n' > "$root/bin/nested/deeper/python.sh"
printf 'echo no-shebang\n' > "$root/bin/nested/deeper/no-shebang.sh"
list="$(list_scripts "$root")"
assert_list_has 'nested bin shell file is listed' "$list" "$root/bin/nested/deeper/tool"
assert_list_has 'symlinked bin shell file is listed' "$list" "$root/bin/nested/linked-tool"
assert_list_lacks 'nested Python file is excluded' "$list" "$root/bin/nested/deeper/python.sh"
assert_list_lacks 'nested shebang-less file is excluded' "$list" "$root/bin/nested/deeper/no-shebang.sh"

empty_root="$(fixture_root empty)"
mv "$empty_root/test/lint_shell.sh" "$empty_root/test/lint_shell"
set +e
"$empty_root/test/lint_shell" >/dev/null 2>&1
empty_exit=$?
set -e
assert 'empty enumeration refuses success' "$([ "$empty_exit" -eq 2 ] && echo 0 || echo 1)"

excluded_root="$(fixture_root excluded)"
printf '#!/usr/bin/env bash\necho keep\n' > "$excluded_root/bin/keep"
printf '#!/usr/bin/env bash\necho omit\n' > "$excluded_root/bin/omit"
sed -i 's|^DECLARED_EXCLUSIONS=.*|DECLARED_EXCLUSIONS="bin/omit"|' "$excluded_root/test/lint_shell.sh"
excluded_list="$(list_scripts "$excluded_root")"
assert_list_lacks 'declared exclusion omits exactly its path' "$excluded_list" "$excluded_root/bin/omit"
assert_list_has 'declared exclusion retains other shell files' "$excluded_list" "$excluded_root/bin/keep"

real_list="$("$LINTER_SOURCE" --list)"
assert_list_has 'real tree lists shared bin library' "$real_list" "$REPO_ROOT/bin/lib/harness-common.sh"

if assert_integrity_uses_shared_list "$INTEGRITY_SOURCE"; then
  assert 'real syntax-check section uses shared list' 0
else
  assert 'real syntax-check section uses shared list' 1
fi

mutated_glob="$TMP_ROOT/integrity-glob.sh"
cp "$INTEGRITY_SOURCE" "$mutated_glob"
sed -i '/^# ── 1b\./i for script in "${HARNESS_DIR}"/bin/*; do :; done' "$mutated_glob"
set +e
assert_integrity_uses_shared_list "$mutated_glob"
glob_exit=$?
set -e
assert 'drift guard rejects a syntax-check glob' "$([ "$glob_exit" -ne 0 ] && echo 0 || echo 1)"

mutated_missing="$TMP_ROOT/integrity-missing.sh"
sed 's|"${HARNESS_DIR}/test/lint_shell.sh" --list|false|' "$INTEGRITY_SOURCE" > "$mutated_missing"
set +e
assert_integrity_uses_shared_list "$mutated_missing"
missing_exit=$?
set -e
assert 'drift guard rejects a missing shared list' "$([ "$missing_exit" -ne 0 ] && echo 0 || echo 1)"

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
