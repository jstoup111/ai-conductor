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
  mkdir -p "$root/test" "$root/bin/nested/deeper" "$root/hooks" "$root/.github/scripts" \
    "$root/skills/demo/scripts"
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
  if ! grep -q 'test/lint_shell.sh" --syntax' <<<"$syntax_section"; then
    echo "syntax-check section must invoke test/lint_shell.sh --syntax" >&2
    return 1
  fi
  if ! grep -q 'while IFS= read -r script' <<<"$syntax_section" || \
    ! grep -q 'assert "\${name}"' <<<"$syntax_section" || \
    ! grep -q 'syntax_script_count' <<<"$syntax_section"; then
    echo "syntax-check section must retain per-file assertions and empty enumeration guard" >&2
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
printf '#!/usr/bin/env bash\necho hook\n' > "$root/hooks/hook.sh"
printf '#!/usr/bin/env bash\necho test\n' > "$root/test/helper.sh"
printf '#!/usr/bin/env bash\necho github\n' > "$root/.github/scripts/helper.sh"
printf '#!/usr/bin/env bash\necho skill helper\n' > "$root/skills/demo/scripts/tool"
printf '#!/usr/bin/env bash\nif then\n' > "$root/skills/demo/scripts/broken"
printf '#!/usr/bin/env bash\necho excluded\n' > "$root/skills/demo/scripts/excluded"
printf 'skill instructions\n' > "$root/skills/demo/SKILL.md"
mkdir -p "$root/skills/demo/references" "$root/skills/demo/agents"
printf 'notes\n' > "$root/skills/demo/references/notes.md"
printf 'interface: {}\n' > "$root/skills/demo/agents/openai.yaml"
printf 'fixture data\n' > "$root/skills/demo/scripts/data"
ln -s ../sibling "$root/bin/nested/linked-tool"
printf '#!/usr/bin/env python3\nprint("python")\n' > "$root/bin/nested/deeper/python.sh"
printf 'echo no-shebang\n' > "$root/bin/nested/deeper/no-shebang.sh"
list="$(list_scripts "$root")"
assert_list_has 'nested bin shell file is listed' "$list" "$root/bin/nested/deeper/tool"
assert_list_has 'symlinked bin shell file is listed' "$list" "$root/bin/nested/linked-tool"
assert_list_has 'hooks shell file is listed' "$list" "$root/hooks/hook.sh"
assert_list_has 'test shell file is listed' "$list" "$root/test/helper.sh"
assert_list_has 'GitHub shell file is listed' "$list" "$root/.github/scripts/helper.sh"
assert_list_has 'bundled skill shell helper is listed' "$list" "$root/skills/demo/scripts/tool"
assert_list_has 'syntax-broken bundled helper is listed' "$list" "$root/skills/demo/scripts/broken"
assert_list_lacks 'nested Python file is excluded' "$list" "$root/bin/nested/deeper/python.sh"
assert_list_lacks 'nested shebang-less file is excluded' "$list" "$root/bin/nested/deeper/no-shebang.sh"
assert_list_lacks 'skill instructions are excluded' "$list" "$root/skills/demo/SKILL.md"
assert_list_lacks 'skill references are excluded' "$list" "$root/skills/demo/references/notes.md"
assert_list_lacks 'skill agent metadata is excluded' "$list" "$root/skills/demo/agents/openai.yaml"
assert_list_lacks 'bundled helper data without a shebang is excluded' "$list" "$root/skills/demo/scripts/data"

set +e
syntax_output="$("$root/test/lint_shell.sh" --syntax 2>&1)"
syntax_exit=$?
set -e
assert 'syntax mode rejects a syntax-broken bundled helper' "$( [ "$syntax_exit" -ne 0 ] && echo 0 || echo 1 )"
assert 'syntax mode reports the syntax-broken bundled helper' "$(grep -qx "$root/skills/demo/scripts/broken" <<<"$syntax_output" && echo 0 || echo 1)"

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
printf '#!/usr/bin/env bash\necho exclude helper\n' > "$excluded_root/skills/demo/scripts/excluded"
sed -i 's|^DECLARED_EXCLUSIONS=.*|DECLARED_EXCLUSIONS="bin/omit\nskills/demo/scripts/excluded"|' "$excluded_root/test/lint_shell.sh"
excluded_list="$(list_scripts "$excluded_root")"
assert_list_lacks 'declared exclusion omits exactly its path' "$excluded_list" "$excluded_root/bin/omit"
assert_list_has 'declared exclusion retains other shell files' "$excluded_list" "$excluded_root/bin/keep"
assert_list_lacks 'declared exclusion omits bundled helper path' "$excluded_list" "$excluded_root/skills/demo/scripts/excluded"

real_list="$("$LINTER_SOURCE" --list)"
assert_list_has 'real tree lists shared bin library' "$real_list" "$REPO_ROOT/bin/lib/harness-common.sh"
assert_list_has 'real tree lists bundled intake helper' "$real_list" "$REPO_ROOT/skills/intake/scripts/intake-file"

if assert_integrity_uses_shared_list "$INTEGRITY_SOURCE"; then
  assert 'real syntax-check section uses shared list' 0
else
  assert 'real syntax-check section uses shared list' 1
fi

mutated_glob="$TMP_ROOT/integrity-glob.sh"
cp "$INTEGRITY_SOURCE" "$mutated_glob"
sed -i '/^# ── 1b\./i for script in "${HARNESS_DIR}"/bin/*; do :; done' "$mutated_glob"
set +e
glob_output="$(assert_integrity_uses_shared_list "$mutated_glob" 2>&1)"
glob_exit=$?
set -e
assert 'drift guard rejects a syntax-check glob' "$([ "$glob_exit" -ne 0 ] && echo 0 || echo 1)"
assert 'glob rejection names the syntax-check section' "$(grep -q 'syntax-check section' <<<"$glob_output" && echo 0 || echo 1)"

mutated_missing="$TMP_ROOT/integrity-missing.sh"
sed 's|"${HARNESS_DIR}/test/lint_shell.sh" --syntax|false|' "$INTEGRITY_SOURCE" > "$mutated_missing"
set +e
missing_output="$(assert_integrity_uses_shared_list "$mutated_missing" 2>&1)"
missing_exit=$?
set -e
assert 'drift guard rejects a missing shared list' "$([ "$missing_exit" -ne 0 ] && echo 0 || echo 1)"
assert 'missing-syntax rejection names the syntax-check section' "$(grep -q 'syntax-check section' <<<"$missing_output" && echo 0 || echo 1)"

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
