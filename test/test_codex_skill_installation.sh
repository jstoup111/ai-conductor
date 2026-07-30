#!/usr/bin/env bash
set -uo pipefail

# RED public-entry-point acceptance coverage for #904's installation and
# migration stories. Every scenario invokes the real bin/install against an
# isolated HOME; no Codex plugin, prompt preamble, or per-skill copy is used.
# Covers: FR-1, FR-2, FR-3, FR-4, FR-13

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

CHECKOUT="$TMP_ROOT/checkout"
mkdir -p "$CHECKOUT"
cp -r "$HARNESS_DIR/bin" "$CHECKOUT/bin"
cp -r "$HARNESS_DIR/skills" "$CHECKOUT/skills"
cp -r "$HARNESS_DIR/hooks" "$CHECKOUT/hooks"
cp "$HARNESS_DIR/HARNESS.md" "$HARNESS_DIR/VERSION" "$CHECKOUT/"

STUBS="$TMP_ROOT/stubs"
mkdir -p "$STUBS"
for tool in rtk npm node claude codex uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS/$tool"
  chmod +x "$STUBS/$tool"
done
ln -s "$(python3 -c 'import sys; print(sys.executable)')" "$STUBS/python3"

run_install() {
  local fake_home=$1
  shift
  mkdir -p "$fake_home"
  (
    cd "$CHECKOUT" || exit 1
    HOME="$fake_home" PATH="$STUBS:/usr/bin:/bin" \
      timeout 15s "$CHECKOUT/bin/install" "$@" --allow-worktree-root </dev/null
  )
}

owned_catalog_is_current() {
  local fake_home=$1
  local skill source target
  local expected=0
  local found=0

  for source in "$CHECKOUT"/skills/*/SKILL.md; do
    [ -f "$source" ] || continue
    skill=$(basename "$(dirname "$source")")
    expected=$((expected + 1))
    target="$fake_home/.agents/skills/$skill"
    [ -L "$target" ] || return 1
    [ "$(readlink -f "$target")" = "$CHECKOUT/skills/$skill" ] || return 1
    [ -r "$target/SKILL.md" ] || return 1
    found=$((found + 1))
  done

  [ "$found" -eq "$expected" ] \
    && [ -L "$fake_home/.agents/skills/HARNESS.md" ] \
    && [ "$(readlink -f "$fake_home/.agents/skills/HARNESS.md")" = "$CHECKOUT/HARNESS.md" ]
}

snapshot_current_catalog() {
  local fake_home=$1
  local output=$2
  local catalog="$fake_home/.agents/skills"
  local entry name raw_target canonical_target content_hash

  printf 'entry-count %s\n' \
    "$(find "$catalog" -mindepth 1 -maxdepth 1 -printf . | wc -c)" > "$output"
  while IFS= read -r entry; do
    name=$(basename "$entry")
    if [ -L "$entry" ]; then
      raw_target=$(readlink "$entry")
      canonical_target=$(readlink -f "$entry")
      printf 'link %s raw=%s canonical=%s\n' \
        "$name" "$raw_target" "$canonical_target" >> "$output"
    elif [ -f "$entry" ]; then
      content_hash=$(sha256sum "$entry" | awk '{print $1}')
      printf 'file %s sha256=%s\n' "$name" "$content_hash" >> "$output"
    else
      printf 'other %s\n' "$name" >> "$output"
    fi
  done < <(find "$catalog" -mindepth 1 -maxdepth 1 -print | sort)
}

install_complete_prior_catalog() {
  local fake_home=$1
  local catalog=$2
  local source skill

  mkdir -p "$fake_home/$catalog"
  ln -s "$OLD_CHECKOUT/HARNESS.md" "$fake_home/$catalog/HARNESS.md"
  for source in "$OLD_CHECKOUT"/skills/*/SKILL.md; do
    [ -f "$source" ] || continue
    skill=$(basename "$(dirname "$source")")
    ln -s "$OLD_CHECKOUT/skills/$skill" "$fake_home/$catalog/$skill"
  done
}

legacy_catalog_has_no_owned_entries() {
  local fake_home=$1
  local skill source target
  for source in "$CHECKOUT"/skills/*/SKILL.md; do
    [ -f "$source" ] || continue
    skill=$(basename "$(dirname "$source")")
    target="$fake_home/.codex/skills/$skill"
    if [ -L "$target" ] && [ "$(readlink -f "$target")" = "$CHECKOUT/skills/$skill" ]; then
      return 1
    fi
  done
  target="$fake_home/.codex/skills/HARNESS.md"
  if [ -L "$target" ] && [ "$(readlink -f "$target")" = "$CHECKOUT/HARNESS.md" ]; then
    return 1
  fi
  return 0
}

# ST-904-1/ST-904-2: normal built-in installation exposes the whole canonical
# catalog and linked resources through Codex's documented user scope.
FRESH_HOME="$TMP_ROOT/home-fresh"
if run_install "$FRESH_HOME" --providers codex >"$TMP_ROOT/fresh.out" 2>&1; then
  pass 'normal Codex installation completes without plugin or prompt setup'
else
  fail 'normal Codex installation completes without plugin or prompt setup'
fi
check 'every canonical skill is readable exactly once from ~/.agents/skills' \
  owned_catalog_is_current "$FRESH_HOME"
check 'a linked skill resource is readable from the installed Codex view' \
  test -r "$FRESH_HOME/.agents/skills/tdd/references/red.md"
check 'normal installation creates no Codex plugin dependency' \
  test ! -e "$FRESH_HOME/.codex/plugins"
check 'normal installation leaves no harness-owned duplicate catalog in the legacy scope' \
  legacy_catalog_has_no_owned_entries "$FRESH_HOME"

# ST-904-3/ST-904-4: update replaces an older harness-owned target, removes
# legacy duplication, and converges when repeated.
UPDATE_HOME="$TMP_ROOT/home-update"
OLD_CHECKOUT="$TMP_ROOT/old-checkout"
mkdir -p "$UPDATE_HOME/.agents/skills" "$UPDATE_HOME/.codex/skills" "$OLD_CHECKOUT"
cp -r "$CHECKOUT/skills" "$OLD_CHECKOUT/skills"
cp "$CHECKOUT/HARNESS.md" "$CHECKOUT/VERSION" "$OLD_CHECKOUT/"
printf '%s\n' 'old workflow revision' > "$OLD_CHECKOUT/skills/tdd/SKILL.md"
mkdir -p "$OLD_CHECKOUT/skills/retired-workflow"
printf '%s\n' 'retired workflow revision' > "$OLD_CHECKOUT/skills/retired-workflow/SKILL.md"
mkdir -p "$OLD_CHECKOUT/skills/test-suite"
printf '%s\n' 'obsolete test-suite revision' > "$OLD_CHECKOUT/skills/test-suite/SKILL.md"
ln -s "$OLD_CHECKOUT/HARNESS.md" "$UPDATE_HOME/.agents/skills/HARNESS.md"
ln -s "$OLD_CHECKOUT/skills/tdd" "$UPDATE_HOME/.agents/skills/tdd"
ln -s "$OLD_CHECKOUT/skills/retired-workflow" "$UPDATE_HOME/.agents/skills/retired-workflow"
ln -s "$CHECKOUT/skills/tdd" "$UPDATE_HOME/.codex/skills/tdd"
ln -s "$CHECKOUT/HARNESS.md" "$UPDATE_HOME/.codex/skills/HARNESS.md"

run_install "$UPDATE_HOME" --update --providers codex >"$TMP_ROOT/update-1.out" 2>&1
check 'update refreshes a stale current-scope harness skill to this checkout' \
  test "$(readlink -f "$UPDATE_HOME/.agents/skills/tdd")" = "$CHECKOUT/skills/tdd"
check 'update removes a recognized harness-owned legacy duplicate' \
  test ! -e "$UPDATE_HOME/.codex/skills/tdd"
check 'update removes recognized harness-owned legacy instructions' \
  test ! -e "$UPDATE_HOME/.codex/skills/HARNESS.md"
check 'updated catalog matches the complete current source catalog' \
  owned_catalog_is_current "$UPDATE_HOME"
check 'update removes an obsolete current-scope skill owned by the prior harness checkout' \
  test ! -e "$UPDATE_HOME/.agents/skills/retired-workflow"

# Task 17: the removed test-suite skill must be cleaned from both supported
# discovery catalogs only when a complete prior harness root proves ownership.
OBSOLETE_SKILL_HOME="$TMP_ROOT/home-obsolete-test-suite"
install_complete_prior_catalog "$OBSOLETE_SKILL_HOME" ".claude/skills"
install_complete_prior_catalog "$OBSOLETE_SKILL_HOME" ".agents/skills"
OBSOLETE_UPDATES_OK=1
run_install "$OBSOLETE_SKILL_HOME" --update --providers claude,codex \
  >"$TMP_ROOT/obsolete-test-suite-1.out" 2>&1 \
  || OBSOLETE_UPDATES_OK=0
check 'update removes the owned obsolete test-suite link from Claude discovery' \
  test ! -e "$OBSOLETE_SKILL_HOME/.claude/skills/test-suite"
check 'update removes the owned obsolete test-suite link from Codex discovery' \
  test ! -e "$OBSOLETE_SKILL_HOME/.agents/skills/test-suite"
check 'update preserves an unrelated current Claude skill while removing test-suite' \
  test -r "$OBSOLETE_SKILL_HOME/.claude/skills/tdd/SKILL.md"
check 'update preserves an unrelated current Codex skill while removing test-suite' \
  test -r "$OBSOLETE_SKILL_HOME/.agents/skills/tdd/SKILL.md"
run_install "$OBSOLETE_SKILL_HOME" --update --providers claude,codex \
  >"$TMP_ROOT/obsolete-test-suite-2.out" 2>&1 \
  || OBSOLETE_UPDATES_OK=0
check 'repeated update is idempotent when obsolete test-suite links are already absent' \
  test "$OBSOLETE_UPDATES_OK" -eq 1
check 'repeated update leaves obsolete test-suite absent from both catalogs' \
  bash -c 'test ! -e "$1/.claude/skills/test-suite" && test ! -e "$1/.agents/skills/test-suite"' \
  _ "$OBSOLETE_SKILL_HOME"

FOREIGN_OBSOLETE_HOME="$TMP_ROOT/home-foreign-test-suite"
install_complete_prior_catalog "$FOREIGN_OBSOLETE_HOME" ".claude/skills"
install_complete_prior_catalog "$FOREIGN_OBSOLETE_HOME" ".agents/skills"
FOREIGN_TEST_SUITE_ROOT="$TMP_ROOT/foreign-test-suite"
mkdir -p "$FOREIGN_TEST_SUITE_ROOT"
printf '%s\n' 'operator-owned test-suite skill' > "$FOREIGN_TEST_SUITE_ROOT/SKILL.md"
rm -f "$FOREIGN_OBSOLETE_HOME/.claude/skills/test-suite" \
  "$FOREIGN_OBSOLETE_HOME/.agents/skills/test-suite"
ln -s "$FOREIGN_TEST_SUITE_ROOT" "$FOREIGN_OBSOLETE_HOME/.claude/skills/test-suite"
printf '%s\n' 'operator-owned Codex test-suite file' \
  > "$FOREIGN_OBSOLETE_HOME/.agents/skills/test-suite"
FOREIGN_TEST_SUITE_LINK=$(readlink "$FOREIGN_OBSOLETE_HOME/.claude/skills/test-suite")
FOREIGN_TEST_SUITE_HASH=$(sha256sum "$FOREIGN_OBSOLETE_HOME/.agents/skills/test-suite" | awk '{print $1}')
FOREIGN_OBSOLETE_UPDATE_OK=1
run_install "$FOREIGN_OBSOLETE_HOME" --update --providers claude,codex \
  >"$TMP_ROOT/foreign-test-suite-update.out" 2>&1 \
  || FOREIGN_OBSOLETE_UPDATE_OK=0
check 'update completes while preserving foreign test-suite collisions' \
  test "$FOREIGN_OBSOLETE_UPDATE_OK" -eq 1
check 'update preserves a foreign test-suite symlink in Claude discovery' \
  test "$(readlink "$FOREIGN_OBSOLETE_HOME/.claude/skills/test-suite")" = "$FOREIGN_TEST_SUITE_LINK"
check 'update preserves a foreign test-suite regular file in Codex discovery' \
  test "$(sha256sum "$FOREIGN_OBSOLETE_HOME/.agents/skills/test-suite" | awk '{print $1}')" = \
  "$FOREIGN_TEST_SUITE_HASH"
check 'foreign test-suite collisions do not disturb unrelated current skills' \
  bash -c 'test -r "$1/.claude/skills/tdd/SKILL.md" && test -r "$1/.agents/skills/tdd/SKILL.md"' \
  _ "$FOREIGN_OBSOLETE_HOME"

SPLIT_ANCHOR_HOME="$TMP_ROOT/home-split-anchor-test-suite"
install_complete_prior_catalog "$SPLIT_ANCHOR_HOME" ".claude/skills"
mkdir -p "$CHECKOUT/skills/test-suite"
rm -f "$SPLIT_ANCHOR_HOME/.claude/skills/test-suite"
ln -s "$CHECKOUT/skills/test-suite" "$SPLIT_ANCHOR_HOME/.claude/skills/test-suite"
run_install "$SPLIT_ANCHOR_HOME" --update --providers claude \
  >"$TMP_ROOT/split-anchor-test-suite-update.out" 2>&1
check 'update preserves an obsolete link that does not match its catalog ownership anchor' \
  test "$(readlink "$SPLIT_ANCHOR_HOME/.claude/skills/test-suite")" = \
  "$CHECKOUT/skills/test-suite"

# Legacy ownership uses the same complete-prior-harness proof as the active
# catalog. An older, valid legacy catalog must converge, while the foreign
# legacy fixtures below remain untouched.
OLD_LEGACY_UPDATE_HOME="$TMP_ROOT/home-old-legacy-update"
mkdir -p "$OLD_LEGACY_UPDATE_HOME/.codex/skills"
ln -s "$OLD_CHECKOUT/skills/tdd" "$OLD_LEGACY_UPDATE_HOME/.codex/skills/tdd"
ln -s "$OLD_CHECKOUT/HARNESS.md" "$OLD_LEGACY_UPDATE_HOME/.codex/skills/HARNESS.md"
run_install "$OLD_LEGACY_UPDATE_HOME" --update --providers codex \
  >"$TMP_ROOT/old-legacy-update.out" 2>&1
check 'update converges a complete prior-harness legacy skill link' \
  test ! -e "$OLD_LEGACY_UPDATE_HOME/.codex/skills/tdd"
check 'update converges complete prior-harness legacy instructions' \
  test ! -e "$OLD_LEGACY_UPDATE_HOME/.codex/skills/HARNESS.md"

SAME_CHECKOUT_HOME="$TMP_ROOT/home-update-same-checkout"
mkdir -p "$SAME_CHECKOUT_HOME/.agents/skills"
ln -s "$CHECKOUT/HARNESS.md" "$SAME_CHECKOUT_HOME/.agents/skills/HARNESS.md"
ln -s "$CHECKOUT/skills/retired-same-checkout-workflow" \
  "$SAME_CHECKOUT_HOME/.agents/skills/retired-same-checkout-workflow"
run_install "$SAME_CHECKOUT_HOME" --update --providers codex \
  >"$TMP_ROOT/update-same-checkout.out" 2>&1
check 'update removes an obsolete current-scope skill anchored to the same checkout' \
  test ! -L "$SAME_CHECKOUT_HOME/.agents/skills/retired-same-checkout-workflow"

IDEMPOTENCY_HOME="$TMP_ROOT/home-idempotency"
IDEMPOTENCY_RUNS_OK=1
run_install "$IDEMPOTENCY_HOME" --providers codex >"$TMP_ROOT/idempotency-initial.out" 2>&1 \
  || IDEMPOTENCY_RUNS_OK=0
printf '%s\n' 'operator-owned current-scope content' \
  > "$IDEMPOTENCY_HOME/.agents/skills/operator-notes"
snapshot_current_catalog "$IDEMPOTENCY_HOME" "$TMP_ROOT/idempotency-initial.snapshot"

for iteration in 1 2; do
  run_install "$IDEMPOTENCY_HOME" --providers codex \
    >"$TMP_ROOT/idempotency-normal-$iteration.out" 2>&1 \
    || IDEMPOTENCY_RUNS_OK=0
  snapshot_current_catalog "$IDEMPOTENCY_HOME" \
    "$TMP_ROOT/idempotency-normal-$iteration.snapshot"
done

for iteration in 1 2; do
  run_install "$IDEMPOTENCY_HOME" --update --providers codex \
    >"$TMP_ROOT/idempotency-update-$iteration.out" 2>&1 \
    || IDEMPOTENCY_RUNS_OK=0
  snapshot_current_catalog "$IDEMPOTENCY_HOME" \
    "$TMP_ROOT/idempotency-update-$iteration.snapshot"
done

catalog_reinstall_is_idempotent() {
  local source skill
  local expected_count=2
  local unrelated_hash

  unrelated_hash=$(printf '%s\n' 'operator-owned current-scope content' | sha256sum | awk '{print $1}')
  for source in "$CHECKOUT"/skills/*/SKILL.md; do
    [ -f "$source" ] || continue
    skill=$(basename "$(dirname "$source")")
    expected_count=$((expected_count + 1))
    grep -Fxq \
      "link $skill raw=$CHECKOUT/skills/$skill canonical=$CHECKOUT/skills/$skill" \
      "$TMP_ROOT/idempotency-initial.snapshot" \
      || return 1
  done

  [ "$IDEMPOTENCY_RUNS_OK" -eq 1 ] \
    && grep -Fxq "entry-count $expected_count" \
      "$TMP_ROOT/idempotency-initial.snapshot" \
    && grep -Fxq \
      "link HARNESS.md raw=$CHECKOUT/HARNESS.md canonical=$CHECKOUT/HARNESS.md" \
      "$TMP_ROOT/idempotency-initial.snapshot" \
    && grep -Fxq "file operator-notes sha256=$unrelated_hash" \
      "$TMP_ROOT/idempotency-initial.snapshot" \
    && cmp -s "$TMP_ROOT/idempotency-initial.snapshot" \
      "$TMP_ROOT/idempotency-normal-1.snapshot" \
    && cmp -s "$TMP_ROOT/idempotency-initial.snapshot" \
      "$TMP_ROOT/idempotency-normal-2.snapshot" \
    && cmp -s "$TMP_ROOT/idempotency-initial.snapshot" \
      "$TMP_ROOT/idempotency-update-1.snapshot" \
    && cmp -s "$TMP_ROOT/idempotency-initial.snapshot" \
      "$TMP_ROOT/idempotency-update-2.snapshot"
}

check 'repeated normal install and update preserve the exact current catalog and unrelated content' \
  catalog_reinstall_is_idempotent

# Ownership boundary: foreign files, directories, and links survive update and
# uninstall byte-for-byte or target-for-target.
FOREIGN_HOME="$TMP_ROOT/home-foreign"
mkdir -p "$FOREIGN_HOME/.agents/skills/pipeline" "$FOREIGN_HOME/.codex/skills"
NEAR_MATCH_CHECKOUT="${CHECKOUT}-foreign"
mkdir -p "$NEAR_MATCH_CHECKOUT/skills/conduct" "$NEAR_MATCH_CHECKOUT/skills/tdd"
printf '%s\n' 'not this harness' > "$NEAR_MATCH_CHECKOUT/HARNESS.md"
printf '%s\n' 'operator-owned tdd file' > "$FOREIGN_HOME/.agents/skills/tdd"
printf '%s\n' 'operator-owned pipeline directory' > "$FOREIGN_HOME/.agents/skills/pipeline/data"
ln -s "$NEAR_MATCH_CHECKOUT/skills/conduct" "$FOREIGN_HOME/.agents/skills/conduct"
ln -s "$NEAR_MATCH_CHECKOUT/HARNESS.md" "$FOREIGN_HOME/.agents/skills/HARNESS.md"
ln -s "$NEAR_MATCH_CHECKOUT/skills/tdd" "$FOREIGN_HOME/.codex/skills/tdd"
printf '%s\n' 'operator-owned legacy harness instructions' > "$FOREIGN_HOME/.codex/skills/HARNESS.md"
# Exact harness-owned current link: update may retain it, uninstall must remove it.
ln -s "$CHECKOUT/skills/stories" "$FOREIGN_HOME/.agents/skills/stories"
FOREIGN_FILE_HASH=$(sha256sum "$FOREIGN_HOME/.agents/skills/tdd" | awk '{print $1}')
FOREIGN_DIR_HASH=$(sha256sum "$FOREIGN_HOME/.agents/skills/pipeline/data" | awk '{print $1}')
FOREIGN_CURRENT_LINK_TARGET=$(readlink "$FOREIGN_HOME/.agents/skills/conduct")
FOREIGN_CURRENT_HARNESS_TARGET=$(readlink "$FOREIGN_HOME/.agents/skills/HARNESS.md")
FOREIGN_LEGACY_LINK_TARGET=$(readlink "$FOREIGN_HOME/.codex/skills/tdd")
FOREIGN_HARNESS_HASH=$(sha256sum "$FOREIGN_HOME/.codex/skills/HARNESS.md" | awk '{print $1}')
run_install "$FOREIGN_HOME" --update --providers codex >"$TMP_ROOT/foreign-update.out" 2>&1
check 'update succeeds while preserving foreign collisions' \
  test "$?" -eq 0
check 'update preserves a foreign regular file colliding with a current skill name' \
  test "$(sha256sum "$FOREIGN_HOME/.agents/skills/tdd" | awk '{print $1}')" = "$FOREIGN_FILE_HASH" && \
    test ! -e "$FOREIGN_HOME/.agents/skills/tdd.bak"
check 'update preserves a foreign directory colliding with a current skill name' \
  test -d "$FOREIGN_HOME/.agents/skills/pipeline" && \
    test "$(sha256sum "$FOREIGN_HOME/.agents/skills/pipeline/data" | awk '{print $1}')" = "$FOREIGN_DIR_HASH" && \
    test ! -e "$FOREIGN_HOME/.agents/skills/pipeline.bak"
check 'update preserves a foreign symlink colliding with a current skill name' \
  test "$(readlink "$FOREIGN_HOME/.agents/skills/conduct")" = "$FOREIGN_CURRENT_LINK_TARGET" && \
    test ! -e "$FOREIGN_HOME/.agents/skills/conduct.bak"
check 'update preserves a foreign current-scope HARNESS.md symlink' \
  test "$(readlink "$FOREIGN_HOME/.agents/skills/HARNESS.md")" = "$FOREIGN_CURRENT_HARNESS_TARGET" && \
    test ! -e "$FOREIGN_HOME/.agents/skills/HARNESS.md.bak"
check 'update preserves a foreign symlink colliding with a legacy skill name' \
  test "$(readlink "$FOREIGN_HOME/.codex/skills/tdd")" = "$FOREIGN_LEGACY_LINK_TARGET"
check 'update preserves foreign legacy HARNESS.md content' \
  test "$(sha256sum "$FOREIGN_HOME/.codex/skills/HARNESS.md" | awk '{print $1}')" = "$FOREIGN_HARNESS_HASH"

FOREIGN_LEGACY_LINK_HOME="$TMP_ROOT/home-foreign-legacy-link"
mkdir -p "$FOREIGN_LEGACY_LINK_HOME/.codex/skills"
ln -s "$NEAR_MATCH_CHECKOUT/HARNESS.md" "$FOREIGN_LEGACY_LINK_HOME/.codex/skills/HARNESS.md"
FOREIGN_LEGACY_HARNESS_TARGET=$(readlink "$FOREIGN_LEGACY_LINK_HOME/.codex/skills/HARNESS.md")
run_install "$FOREIGN_LEGACY_LINK_HOME" --update --providers codex \
  >"$TMP_ROOT/foreign-legacy-link-update.out" 2>&1
check 'update preserves a foreign legacy HARNESS.md symlink without backup' \
  test "$(readlink "$FOREIGN_LEGACY_LINK_HOME/.codex/skills/HARNESS.md")" = "$FOREIGN_LEGACY_HARNESS_TARGET" && \
    test ! -e "$FOREIGN_LEGACY_LINK_HOME/.codex/skills/HARNESS.md.bak"

# Check mode must diagnose the documented active scope, including missing and
# duplicate current/legacy views, rather than accepting the old scope alone.
CHECK_HOME="$TMP_ROOT/home-check"
run_install "$CHECK_HOME" --providers codex >"$TMP_ROOT/check-install.out" 2>&1
mkdir -p "$CHECK_HOME/.local/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$CHECK_HOME/.local/bin/conduct-ts"
chmod +x "$CHECK_HOME/.local/bin/conduct-ts"
rm -f "$CHECK_HOME/.agents/skills/tdd"
HOME="$CHECK_HOME" PATH="$STUBS:$CHECK_HOME/.local/bin:/usr/bin:/bin" \
  "$CHECKOUT/bin/install" --check --providers codex --allow-worktree-root \
  >"$TMP_ROOT/check-missing.out" 2>&1
MISSING_CODE=$?
if [ "$MISSING_CODE" -ne 0 ] && grep -qiE 'tdd.*(missing|absent|unreadable)' "$TMP_ROOT/check-missing.out"; then
  pass 'check fails with a skill-named diagnostic for a missing current entry'
else
  fail 'check fails with a skill-named diagnostic for a missing current entry'
fi

mkdir -p "$CHECK_HOME/.agents/skills" "$CHECK_HOME/.codex/skills"
ln -s "$CHECKOUT/skills/tdd" "$CHECK_HOME/.agents/skills/tdd"
rm -f "$CHECK_HOME/.agents/skills/tdd"
ln -s "$TMP_ROOT/missing-tdd-target" "$CHECK_HOME/.agents/skills/tdd"
HOME="$CHECK_HOME" PATH="$STUBS:$CHECK_HOME/.local/bin:/usr/bin:/bin" \
  "$CHECKOUT/bin/install" --check --providers codex --allow-worktree-root \
  >"$TMP_ROOT/check-broken.out" 2>&1
BROKEN_CODE=$?
if [ "$BROKEN_CODE" -ne 0 ] \
  && grep -qiE 'codex.*(active|current).*tdd' "$TMP_ROOT/check-broken.out" \
  && grep -qi 'broken' "$TMP_ROOT/check-broken.out" \
  && [ "$(readlink "$CHECK_HOME/.agents/skills/tdd")" = "$TMP_ROOT/missing-tdd-target" ]; then
  pass 'check identifies a broken current Codex skill without repairing it'
else
  fail 'check identifies a broken current Codex skill without repairing it'
fi

rm -f "$CHECK_HOME/.agents/skills/tdd"
ln -s "$OLD_CHECKOUT/skills/tdd" "$CHECK_HOME/.agents/skills/tdd"
HOME="$CHECK_HOME" PATH="$STUBS:$CHECK_HOME/.local/bin:/usr/bin:/bin" \
  "$CHECKOUT/bin/install" --check --providers codex --allow-worktree-root \
  >"$TMP_ROOT/check-stale.out" 2>&1
STALE_CODE=$?
if [ "$STALE_CODE" -ne 0 ] \
  && grep -qiE 'codex.*(active|current).*tdd' "$TMP_ROOT/check-stale.out" \
  && grep -qiE 'stale|expected' "$TMP_ROOT/check-stale.out" \
  && [ "$(readlink "$CHECK_HOME/.agents/skills/tdd")" = "$OLD_CHECKOUT/skills/tdd" ]; then
  pass 'check identifies a stale current Codex skill without replacing it'
else
  fail 'check identifies a stale current Codex skill without replacing it'
fi

rm -f "$CHECK_HOME/.agents/skills/tdd"
printf '%s\n' 'operator-owned current tdd' > "$CHECK_HOME/.agents/skills/tdd"
NON_SYMLINK_HASH=$(sha256sum "$CHECK_HOME/.agents/skills/tdd" | awk '{print $1}')
HOME="$CHECK_HOME" PATH="$STUBS:$CHECK_HOME/.local/bin:/usr/bin:/bin" \
  "$CHECKOUT/bin/install" --check --providers codex --allow-worktree-root \
  >"$TMP_ROOT/check-non-symlink.out" 2>&1
NON_SYMLINK_CODE=$?
if [ "$NON_SYMLINK_CODE" -ne 0 ] \
  && grep -qiE 'codex.*(active|current).*tdd' "$TMP_ROOT/check-non-symlink.out" \
  && grep -qiE 'not a symlink|non-symlink' "$TMP_ROOT/check-non-symlink.out" \
  && [ "$(sha256sum "$CHECK_HOME/.agents/skills/tdd" | awk '{print $1}')" = "$NON_SYMLINK_HASH" ]; then
  pass 'check identifies a non-symlink current Codex skill without mutating it'
else
  fail 'check identifies a non-symlink current Codex skill without mutating it'
fi

rm -f "$CHECK_HOME/.agents/skills/tdd"
ln -s "$CHECKOUT/skills/tdd" "$CHECK_HOME/.agents/skills/tdd"
ln -sfn "$CHECKOUT/skills/tdd" "$CHECK_HOME/.codex/skills/tdd"
HOME="$CHECK_HOME" PATH="$STUBS:$CHECK_HOME/.local/bin:/usr/bin:/bin" \
  "$CHECKOUT/bin/install" --check --providers codex --allow-worktree-root \
  >"$TMP_ROOT/check-duplicate.out" 2>&1
DUPLICATE_CODE=$?
if [ "$DUPLICATE_CODE" -ne 0 ] \
  && grep -qi 'tdd' "$TMP_ROOT/check-duplicate.out" \
  && grep -qiE 'duplicate|both.*locations|legacy' "$TMP_ROOT/check-duplicate.out"; then
  pass 'check rejects and identifies simultaneous current and legacy discovery'
else
  fail 'check rejects and identifies simultaneous current and legacy discovery'
fi

run_install "$FOREIGN_HOME" --uninstall >"$TMP_ROOT/foreign-uninstall.out" 2>&1
check 'uninstall removes current harness-owned catalog entries' \
  test ! -e "$FOREIGN_HOME/.agents/skills/stories"
check 'uninstall preserves foreign current-scope files at skill names' \
  test -f "$FOREIGN_HOME/.agents/skills/tdd"
check 'uninstall preserves foreign current-scope harness instructions' \
  test "$(readlink "$FOREIGN_HOME/.agents/skills/HARNESS.md")" = "$FOREIGN_CURRENT_HARNESS_TARGET"
check 'uninstall preserves foreign legacy links' \
  test "$(readlink "$FOREIGN_HOME/.codex/skills/tdd")" = "$FOREIGN_LEGACY_LINK_TARGET"
check 'uninstall preserves foreign legacy harness instructions' \
  test "$(sha256sum "$FOREIGN_HOME/.codex/skills/HARNESS.md" | awk '{print $1}')" = "$FOREIGN_HARNESS_HASH"

OWNED_LEGACY_HOME="$TMP_ROOT/home-owned-legacy"
mkdir -p "$OWNED_LEGACY_HOME/.codex/skills"
ln -s "$CHECKOUT/skills/stories" "$OWNED_LEGACY_HOME/.codex/skills/stories"
ln -s "$CHECKOUT/HARNESS.md" "$OWNED_LEGACY_HOME/.codex/skills/HARNESS.md"
run_install "$OWNED_LEGACY_HOME" --uninstall >"$TMP_ROOT/owned-legacy-uninstall.out" 2>&1
check 'uninstall removes legacy harness-owned catalog entries' \
  test ! -e "$OWNED_LEGACY_HOME/.codex/skills/stories"
check 'uninstall removes legacy harness-owned instructions' \
  test ! -e "$OWNED_LEGACY_HOME/.codex/skills/HARNESS.md"

OLD_LEGACY_UNINSTALL_HOME="$TMP_ROOT/home-old-legacy-uninstall"
mkdir -p "$OLD_LEGACY_UNINSTALL_HOME/.codex/skills"
ln -s "$OLD_CHECKOUT/skills/tdd" "$OLD_LEGACY_UNINSTALL_HOME/.codex/skills/tdd"
ln -s "$OLD_CHECKOUT/HARNESS.md" "$OLD_LEGACY_UNINSTALL_HOME/.codex/skills/HARNESS.md"
run_install "$OLD_LEGACY_UNINSTALL_HOME" --uninstall \
  >"$TMP_ROOT/old-legacy-uninstall.out" 2>&1
check 'uninstall removes a complete prior-harness legacy skill link' \
  test ! -e "$OLD_LEGACY_UNINSTALL_HOME/.codex/skills/tdd"
check 'uninstall removes complete prior-harness legacy instructions' \
  test ! -e "$OLD_LEGACY_UNINSTALL_HOME/.codex/skills/HARNESS.md"

CODEX_UNRELEASED=$(awk '
  /^## \[Unreleased\]$/ { in_unreleased=1; next }
  in_unreleased && /^## / { exit }
  in_unreleased { print }
' "$HARNESS_DIR/CHANGELOG.md")
check 'Unreleased Codex installation notes name the active catalog, legacy scope, and migration command' \
  bash -c 'grep -q "~/.agents/skills" <<<"$1" \
    && grep -q "~/.codex/skills" <<<"$1" \
    && grep -qiE "legacy.*(not|no longer).*active" <<<"$1" \
    && grep -q "bash migration" "$2" \
    && grep -A 2 "bash migration" "$2" | grep -q "./bin/install --update"' \
  _ "$CODEX_UNRELEASED" "$HARNESS_DIR/CHANGELOG.md"

# Task 18: the published migration is executable, not merely descriptive.
# Execute only the Unreleased fenced migration in an isolated checkout/home.
MIGRATION_SCRIPT="$TMP_ROOT/unreleased-migration.sh"
awk '
  /^## \[Unreleased\]$/ { in_unreleased=1; next }
  in_unreleased && /^## \[/ { exit }
  in_unreleased && /^```bash migration$/ { in_migration=1; next }
  in_migration && /^```$/ { exit }
  in_migration { print }
' "$HARNESS_DIR/CHANGELOG.md" > "$MIGRATION_SCRIPT"

MIGRATION_HOME="$TMP_ROOT/home-changelog-migration"
install_complete_prior_catalog "$MIGRATION_HOME" ".claude/skills"
install_complete_prior_catalog "$MIGRATION_HOME" ".agents/skills"
MIGRATION_FOREIGN_ROOT="$TMP_ROOT/migration-foreign-skill"
mkdir -p "$MIGRATION_FOREIGN_ROOT"
printf '%s\n' 'operator-owned workflow' > "$MIGRATION_FOREIGN_ROOT/SKILL.md"
ln -s "$MIGRATION_FOREIGN_ROOT" "$MIGRATION_HOME/.claude/skills/operator-workflow"
printf '%s\n' 'operator-owned Codex workflow' \
  > "$MIGRATION_HOME/.agents/skills/operator-workflow"
MIGRATION_FOREIGN_LINK=$(readlink "$MIGRATION_HOME/.claude/skills/operator-workflow")
MIGRATION_FOREIGN_HASH=$(sha256sum \
  "$MIGRATION_HOME/.agents/skills/operator-workflow" | awk '{print $1}')
MIGRATION_VERSION_HASH=$(sha256sum "$CHECKOUT/VERSION" | awk '{print $1}')
MIGRATION_EXTERNAL_CALLS="$TMP_ROOT/migration-external-calls"
MIGRATION_STUBS="$TMP_ROOT/migration-stubs"
mkdir -p "$MIGRATION_STUBS"
for tool in curl wget; do
  printf '#!/usr/bin/env bash\nprintf "%s called\\n" >> %q\nexit 91\n' "$tool" \
    "$MIGRATION_EXTERNAL_CALLS" > "$MIGRATION_STUBS/$tool"
  chmod +x "$MIGRATION_STUBS/$tool"
done
printf '#!/usr/bin/env bash\nroot=%q\nlog=%q\nif [ "$1" = "-C" ] && [ "$2" = "$root" ] && [ "$3" = "describe" ] && [ "$4" = "--tags" ] && [ "$5" = "--exact-match" ] && [ "$6" = "HEAD" ] && [ "$#" -eq 6 ]; then\n  printf "allowed describe\\n" >> "$log"\n  exit 1\nfi\nif [ "$1" = "-C" ] && [ "$2" = "$root" ] && [ "$3" = "rev-parse" ] && [ "$4" = "--short" ] && [ "$5" = "HEAD" ] && [ "$#" -eq 5 ]; then\n  printf "allowed rev-parse\\n" >> "$log"\n  printf "deadbee\\n"\n  exit 0\nfi\nprintf "forbidden git %%s\\n" "$*" >> "$log"\nexit 91\n' \
  "$CHECKOUT" "$MIGRATION_EXTERNAL_CALLS" > "$MIGRATION_STUBS/git"
chmod +x "$MIGRATION_STUBS/git"

MIGRATION_RUNS_OK=1
grep -Eq '^[[:space:]]*\./bin/install --update([[:space:]]|$)' \
  "$MIGRATION_SCRIPT" || MIGRATION_RUNS_OK=0
(
  cd "$CHECKOUT" || exit 1
  HOME="$MIGRATION_HOME" PATH="$MIGRATION_STUBS:$STUBS:/usr/bin:/bin" \
    timeout 15s bash "$MIGRATION_SCRIPT" </dev/null
) >"$TMP_ROOT/changelog-migration-1.out" 2>&1 || MIGRATION_RUNS_OK=0
check 'Unreleased migration removes the exactly-owned Claude test-suite link' \
  test ! -e "$MIGRATION_HOME/.claude/skills/test-suite"
check 'Unreleased migration removes the exactly-owned Codex test-suite link' \
  test ! -e "$MIGRATION_HOME/.agents/skills/test-suite"
check 'Unreleased migration preserves a foreign Claude skill' \
  test "$(readlink "$MIGRATION_HOME/.claude/skills/operator-workflow")" = \
  "$MIGRATION_FOREIGN_LINK"
check 'Unreleased migration preserves a foreign Codex file' \
  test "$(sha256sum "$MIGRATION_HOME/.agents/skills/operator-workflow" | awk '{print $1}')" = \
  "$MIGRATION_FOREIGN_HASH"

ln -s "$MIGRATION_FOREIGN_ROOT" "$MIGRATION_HOME/.claude/skills/test-suite"
printf '%s\n' 'operator-owned Codex test-suite collision' \
  > "$MIGRATION_HOME/.agents/skills/test-suite"
MIGRATION_FOREIGN_TEST_SUITE_HASH=$(sha256sum \
  "$MIGRATION_HOME/.agents/skills/test-suite" | awk '{print $1}')
(
  cd "$CHECKOUT" || exit 1
  HOME="$MIGRATION_HOME" PATH="$MIGRATION_STUBS:$STUBS:/usr/bin:/bin" \
    timeout 15s bash "$MIGRATION_SCRIPT" </dev/null
) >"$TMP_ROOT/changelog-migration-2.out" 2>&1 || MIGRATION_RUNS_OK=0
check 'Unreleased migration is repeat-idempotent in the isolated home' \
  test "$MIGRATION_RUNS_OK" -eq 1
check 'repeated migration preserves a foreign Claude test-suite symlink' \
  test "$(readlink "$MIGRATION_HOME/.claude/skills/test-suite")" = \
  "$MIGRATION_FOREIGN_ROOT"
check 'repeated migration preserves a foreign Codex test-suite file' \
  test "$(sha256sum "$MIGRATION_HOME/.agents/skills/test-suite" | awk '{print $1}')" = \
  "$MIGRATION_FOREIGN_TEST_SUITE_HASH"
check 'migration uses only read-only git version detection and no network clients' \
  bash -c '[ "$(grep -c "^allowed describe$" "$1")" -eq 2 ] \
    && ! grep -qE "^(forbidden git|curl called|wget called)" "$1"' \
  _ "$MIGRATION_EXTERNAL_CALLS"
check 'migration leaves VERSION unchanged' \
  test "$(sha256sum "$CHECKOUT/VERSION" | awk '{print $1}')" = \
  "$MIGRATION_VERSION_HASH"

printf '\nCodex installation acceptance: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
