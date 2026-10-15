#!/usr/bin/env bash
set -uo pipefail

# Public installer coverage for frontmatter-keyed skill links. Each scenario
# invokes bin/install against a copied checkout and isolated HOME.
# Covers: task:9, task:10

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

PASS=0
FAIL=0

pass() {
  printf 'PASS %s\n' "$1"
  PASS=$((PASS + 1))
}

fail() {
  printf 'FAIL %s\n' "$1"
  FAIL=$((FAIL + 1))
}

check() {
  local description=$1
  shift
  if "$@"; then
    pass "$description"
  else
    fail "$description"
  fi
}

copy_checkout() {
  local destination=$1
  mkdir -p "$destination"
  cp -R "$HARNESS_DIR/bin" "$HARNESS_DIR/skills" "$HARNESS_DIR/hooks" "$destination/"
  cp "$HARNESS_DIR/HARNESS.md" "$HARNESS_DIR/ARCHITECTURE.md" "$HARNESS_DIR/VERSION" "$destination/"
  mkdir -p "$destination/src/conductor/dist"
  : > "$destination/src/conductor/dist/index.js"
}

STUBS="$TMP_ROOT/stubs"
mkdir -p "$STUBS"
for tool in npm node claude codex uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS/$tool"
  chmod +x "$STUBS/$tool"
done
ln -s "$(command -v python3)" "$STUBS/python3"

run_install() {
  local checkout=$1
  local fake_home=$2
  shift 2
  mkdir -p "$fake_home"
  (
    cd "$checkout" || exit 1
    HOME="$fake_home" PATH="$STUBS:/usr/bin:/bin" \
      timeout 15s "$checkout/bin/install" "$@" --allow-worktree-root </dev/null
  )
}

run_check() {
  local checkout=$1
  local fake_home=$2
  shift 2
  (
    cd "$checkout" || exit 1
    HOME="$fake_home" PATH="$fake_home/.local/bin:$STUBS:/usr/bin:/bin" \
      timeout 15s "$checkout/bin/install" --check "$@" </dev/null
  )
}

catalog_listing() {
  local catalog=$1
  find "$catalog" -mindepth 1 -maxdepth 1 -type l -printf '%f -> %l\n' | sort
}

prechange_catalog_listing() {
  local checkout=$1
  local skill source
  for source in "$checkout"/skills/*/SKILL.md; do
    [ -f "$source" ] || continue
    skill=$(basename "$(dirname "$source")")
    printf '%s -> %s/skills/%s\n' "$skill" "$checkout" "$skill"
  done
  printf 'ARCHITECTURE.md -> %s/ARCHITECTURE.md\n' "$checkout"
  printf 'HARNESS.md -> %s/HARNESS.md\n' "$checkout"
}

PRISTINE_CHECKOUT="$TMP_ROOT/pristine-checkout"
copy_checkout "$PRISTINE_CHECKOUT"
prechange_catalog_listing "$PRISTINE_CHECKOUT" | sort > "$TMP_ROOT/prechange-claude.list"
cp "$TMP_ROOT/prechange-claude.list" "$TMP_ROOT/prechange-codex.list"

SHIPPED_HOME="$TMP_ROOT/shipped-home"
if run_install "$PRISTINE_CHECKOUT" "$SHIPPED_HOME" --providers claude,codex >"$TMP_ROOT/shipped.out" 2>&1; then
  catalog_listing "$SHIPPED_HOME/.claude/skills" > "$TMP_ROOT/shipped-claude.list"
  catalog_listing "$SHIPPED_HOME/.agents/skills" > "$TMP_ROOT/shipped-codex.list"
  if cmp -s "$TMP_ROOT/prechange-claude.list" "$TMP_ROOT/shipped-claude.list" \
    && cmp -s "$TMP_ROOT/prechange-codex.list" "$TMP_ROOT/shipped-codex.list"; then
    pass 'shipped checkout preserves the pre-change Claude and Codex link listings'
  else
    fail 'shipped checkout preserves the pre-change Claude and Codex link listings'
  fi
else
  fail 'shipped checkout preserves the pre-change Claude and Codex link listings'
fi

RENAMED_CHECKOUT="$TMP_ROOT/renamed-checkout"
copy_checkout "$RENAMED_CHECKOUT"
sed -i 's/^name: plan$/name: ac-plan/' "$RENAMED_CHECKOUT/skills/plan/SKILL.md"
RENAMED_HOME="$TMP_ROOT/renamed-home"
if run_install "$RENAMED_CHECKOUT" "$RENAMED_HOME" --providers claude,codex >"$TMP_ROOT/renamed.out" 2>&1; then
  check 'frontmatter-named Claude link resolves to its source directory' \
    test "$(readlink -f "$RENAMED_HOME/.claude/skills/ac-plan")" = "$RENAMED_CHECKOUT/skills/plan"
  check 'frontmatter-named Codex link resolves to its source directory' \
    test "$(readlink -f "$RENAMED_HOME/.agents/skills/ac-plan")" = "$RENAMED_CHECKOUT/skills/plan"
else
  fail 'frontmatter-named Claude link resolves to its source directory'
  fail 'frontmatter-named Codex link resolves to its source directory'
fi

FALLBACK_CHECKOUT="$TMP_ROOT/fallback-checkout"
copy_checkout "$FALLBACK_CHECKOUT"
sed -i '/^name: plan$/d' "$FALLBACK_CHECKOUT/skills/plan/SKILL.md"
FALLBACK_HOME="$TMP_ROOT/fallback-home"
if run_install "$FALLBACK_CHECKOUT" "$FALLBACK_HOME" --providers claude,codex >"$TMP_ROOT/fallback.out" 2>&1; then
  check 'missing frontmatter name falls back to the skill directory for both catalogs' \
    bash -c 'test "$(readlink -f "$1/.claude/skills/plan")" = "$2/skills/plan" && test "$(readlink -f "$1/.agents/skills/plan")" = "$2/skills/plan"' \
    _ "$FALLBACK_HOME" "$FALLBACK_CHECKOUT"
else
  fail 'missing frontmatter name falls back to the skill directory for both catalogs'
fi

UNCLOSED_CHECKOUT="$TMP_ROOT/unclosed-checkout"
copy_checkout "$UNCLOSED_CHECKOUT"
mkdir -p "$UNCLOSED_CHECKOUT/skills/unclosed"
printf '%s\n' '---' 'name: ac-unclosed' > "$UNCLOSED_CHECKOUT/skills/unclosed/SKILL.md"
UNCLOSED_HOME="$TMP_ROOT/unclosed-home"
set +e
run_install "$UNCLOSED_CHECKOUT" "$UNCLOSED_HOME" --providers claude,codex >"$TMP_ROOT/unclosed.out" 2>&1
UNCLOSED_STATUS=$?
set -e
if [ "$UNCLOSED_STATUS" -ne 0 ] \
  && grep -Fq "$UNCLOSED_CHECKOUT/skills/unclosed/SKILL.md" "$TMP_ROOT/unclosed.out" \
  && [ ! -e "$UNCLOSED_HOME/.claude/skills/ac-unclosed" ] \
  && [ ! -e "$UNCLOSED_HOME/.agents/skills/ac-unclosed" ]; then
  pass 'unclosed frontmatter is reported, skipped, and makes install fail'
else
  fail 'unclosed frontmatter is reported, skipped, and makes install fail'
fi

CHECK_CHECKOUT="$TMP_ROOT/check-checkout"
copy_checkout "$CHECK_CHECKOUT"
sed -i 's/^name: plan$/name: ac-plan/' "$CHECK_CHECKOUT/skills/plan/SKILL.md"
CHECK_HOME="$TMP_ROOT/check-home"
if run_install "$CHECK_CHECKOUT" "$CHECK_HOME" --providers claude,codex >"$TMP_ROOT/check-install.out" 2>&1 \
  && run_check "$CHECK_CHECKOUT" "$CHECK_HOME" --providers claude,codex >"$TMP_ROOT/check-fresh.out" 2>&1; then
  pass '--check accepts frontmatter-named links'
else
  fail '--check accepts frontmatter-named links'
fi

rm "$CHECK_HOME/.claude/skills/ac-plan" "$CHECK_HOME/.agents/skills/ac-plan"
ln -s "$CHECK_CHECKOUT/skills/plan" "$CHECK_HOME/.claude/skills/plan"
ln -s /tmp/foreign-skill "$CHECK_HOME/.agents/skills/plan"
set +e
run_check "$CHECK_CHECKOUT" "$CHECK_HOME" --providers claude,codex >"$TMP_ROOT/check-bare.out" 2>&1
CHECK_BARE_STATUS=$?
set -e
if [ "$CHECK_BARE_STATUS" -ne 0 ] \
  && grep -Fq 'Claude skill: ac-plan' "$TMP_ROOT/check-bare.out" \
  && grep -Fq 'Codex active skill: ac-plan' "$TMP_ROOT/check-bare.out"; then
  pass '--check reports directory-named links as missing frontmatter names'
else
  fail '--check reports directory-named links as missing frontmatter names'
fi

if run_install "$CHECK_CHECKOUT" "$CHECK_HOME" --update --providers claude,codex >"$TMP_ROOT/check-reconcile.out" 2>&1 \
  && [ ! -e "$CHECK_HOME/.claude/skills/plan" ] \
  && [ -L "$CHECK_HOME/.agents/skills/plan" ] \
  && [ "$(readlink "$CHECK_HOME/.agents/skills/plan")" = /tmp/foreign-skill ] \
  && [ -L "$CHECK_HOME/.claude/skills/ac-plan" ] \
  && [ -L "$CHECK_HOME/.agents/skills/ac-plan" ]; then
  pass 'update reconciles harness-owned stale bare links and preserves foreign entries'
else
  fail 'update reconciles harness-owned stale bare links and preserves foreign entries'
fi

rm "$CHECK_HOME/.agents/skills/ac-plan"
set +e
run_check "$CHECK_CHECKOUT" "$CHECK_HOME" --providers claude,codex >"$TMP_ROOT/check-one-missing.out" 2>&1
CHECK_ONE_MISSING_STATUS=$?
set -e
if [ "$CHECK_ONE_MISSING_STATUS" -ne 0 ] \
  && grep -Fq 'Codex active skill: ac-plan' "$TMP_ROOT/check-one-missing.out"; then
  pass '--check identifies the catalog missing ac-plan'
else
  fail '--check identifies the catalog missing ac-plan'
fi

ln -s "$CHECK_CHECKOUT/skills/plan" "$CHECK_HOME/.agents/skills/ac-plan"
printf 'foreign entry\n' > "$CHECK_HOME/.claude/skills/foreign-entry"
if run_install "$CHECK_CHECKOUT" "$CHECK_HOME" --uninstall >"$TMP_ROOT/check-uninstall.out" 2>&1 \
  && [ ! -e "$CHECK_HOME/.claude/skills/ac-plan" ] \
  && [ ! -e "$CHECK_HOME/.agents/skills/ac-plan" ] \
  && [ "$(cat "$CHECK_HOME/.claude/skills/foreign-entry")" = 'foreign entry' ]; then
  pass '--uninstall removes frontmatter-named links and preserves foreign entries'
else
  fail '--uninstall removes frontmatter-named links and preserves foreign entries'
fi

printf '\nInstall skill-name coverage: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
