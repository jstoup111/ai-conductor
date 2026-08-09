#!/usr/bin/env bash
set -euo pipefail

# test_bin_update.sh — Real-binary acceptance tests for `bin/update`, the
# standalone self-update/channel CLI that replaces the update block ported
# out of `bin/conduct` (327-470). See .docs/stories/port-self-update-flow.md
# for the acceptance criteria this file encodes (Stories 1-9).
#
# Runs the ACTUAL bin/update (no mocks of the script under test) against a
# throwaway git repo standing in for the harness checkout, with HOME pointed
# at a disposable dir so the real ~/.ai-conductor/config.yml is never
# touched. bin/migrate is stubbed (its own behavior is out of scope for this
# feature) so tests assert *that* it was invoked, not what it does.
#
# Usage: ./test/test_bin_update.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UPDATE_SRC="$HARNESS_DIR/bin/update"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2 # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

# bin/update shells out to python3 for JSON/changelog handling. A
# version-manager shim (asdf/mise) resolves the interpreter via $HOME, which
# the throwaway HOME below breaks ("unknown command: python3 ... reshim").
# Pin the concrete interpreter, resolved now under the real HOME, onto PATH
# for every isolated-HOME invocation (same fix as test_install_worktree_guard.sh).
STUBS_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUBS_DIR"
PY3="$(python3 -c 'import sys; print(sys.executable)')"
ln -s "$PY3" "$STUBS_DIR/python3"
TEST_PATH="$STUBS_DIR:$PATH"
# A deliberately minimal PATH for missing-command scenarios. Do not inherit
# the operator PATH: it may contain a real ~/.local/bin/conduct-ts.
MISSING_CONDUCT_PATH="$STUBS_DIR:/usr/bin:/bin"

# ─── Fixtures ───────────────────────────────────────────────────────────────

# stub_migrate <repo_dir> <exit_code>
# Overwrites <repo_dir>/bin/migrate with a stub that records invocation and
# exits with the given code. bin/migrate's own behavior is covered elsewhere
# (bin/update must invoke it, not reimplement it).
stub_migrate() {
  local repo=$1 exit_code=$2
  mkdir -p "$repo/bin"
  cat > "$repo/bin/migrate" << EOF
#!/usr/bin/env bash
echo "invoked" >> "$repo/.migrate-calls"
exit ${exit_code}
EOF
  chmod +x "$repo/bin/migrate"
}

# make_repo <name>
# Creates a standalone git repo containing a copy of the real bin/update
# (and bin/lib/ if the implementation factored shared helpers there),
# a stubbed bin/migrate, and a CHANGELOG.md with real version blocks.
# Fails loudly (via a missing bin/update) until the feature is implemented —
# that failure IS this suite's RED signal.
make_repo() {
  local name=$1
  local dir="$TMP_ROOT/$name"
  mkdir -p "$dir/bin"
  if [ -f "$UPDATE_SRC" ]; then
    cp "$UPDATE_SRC" "$dir/bin/update"
    chmod +x "$dir/bin/update"
  fi
  if [ -d "$HARNESS_DIR/bin/lib" ]; then
    cp -r "$HARNESS_DIR/bin/lib" "$dir/bin/lib"
  fi
  # Normal update scenarios exercise the real script through this local
  # conduct-ts seam. It persists the scalar conductor fields in config.yml.
  cat > "$dir/bin/conduct-ts" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[ "$1" = "config" ] || exit 2
config="${HOME}/.ai-conductor/config.yml"
key="${3#conductor.}"
case "$2" in
  read)
    awk -F ': *' -v key="$key" '$1 == "  " key { print $2; exit }' "$config" 2>/dev/null || true
    ;;
  set)
    value=$4
    mkdir -p "$(dirname "$config")"
    if [ ! -f "$config" ]; then
      printf 'conductor:\n  %s: %s\n' "$key" "$value" > "$config"
      exit 0
    fi
    tmp=$(mktemp "${config}.XXXXXX")
    awk -v key="$key" -v value="$value" '
      $0 == "  " key ":" || index($0, "  " key ": ") == 1 {
        print "  " key ": " value
        found = 1
        next
      }
      { print }
      END { if (!found) print "  " key ": " value }
    ' "$config" > "$tmp"
    mv "$tmp" "$config"
    ;;
  *) exit 2 ;;
esac
EOF
  chmod +x "$dir/bin/conduct-ts"
  stub_migrate "$dir" 0

  cat > "$dir/CHANGELOG.md" << 'EOF'
# Changelog

## [Unreleased]

### Added
- placeholder

## [0.4.0] - 2026-07-01

### Added
- Feature D

## [0.3.0] - 2026-06-01

### Added
- Feature C
EOF
  echo "0.4.0" > "$dir/VERSION"

  (
    cd "$dir"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git add -A
    git commit -q -m "v0.3.0"
    git tag v0.3.0
  )
  echo "$dir"
}

# make_isolated_home
# A throwaway HOME so tests never read/write the operator's real
# ~/.ai-conductor/config.yml.
make_isolated_home() {
  local home="$TMP_ROOT/home-$$-${RANDOM}"
  mkdir -p "$home"
  echo "$home"
}

# conductor_cfg_key <legacyField>
conductor_cfg_key() {
  case "$1" in
    updateChannel) echo "update_channel" ;;
    autoCheck) echo "auto_check" ;;
    currentVersion) echo "current_version" ;;
    lastCheckedAt) echo "last_checked_at" ;;
  esac
}

# set_current_version <home> <version>
set_current_version() {
  local home=$1 version=$2
  set_conductor_cfg "$home" currentVersion "$version"
}

cfg_get() {
  local home=$1 field=$2
  awk -F ': *' -v key="$(conductor_cfg_key "$field")" '$1 == "  " key { print $2; exit }' \
    "$home/.ai-conductor/config.yml" 2>/dev/null || true
}

set_conductor_cfg() {
  local home=$1 field=$2 value=$3 key config tmp
  key=$(conductor_cfg_key "$field")
  config="$home/.ai-conductor/config.yml"
  mkdir -p "$(dirname "$config")"
  if [ ! -f "$config" ]; then
    printf 'conductor:\n  %s: %s\n' "$key" "$value" > "$config"
    return
  fi
  tmp=$(mktemp "$TMP_ROOT/config.XXXXXX")
  awk -v key="$key" -v value="$value" '
    $0 == "  " key ":" || index($0, "  " key ": ") == 1 {
      print "  " key ": " value
      found = 1
      next
    }
    { print }
    END { if (!found) print "  " key ": " value }
  ' "$config" > "$tmp"
  mv "$tmp" "$config"
}

# run_conductor_cfg_accessors <home> <field> <value> <default>
# Sources the shared accessors directly so this contract stays focused on the
# update configuration boundary, rather than depending on an update scenario
# to happen to reach each field. The conduct-ts stub is the CLI boundary:
# tests inspect its argv log instead of parsing the YAML configuration file.
CONDUCTOR_CFG_STUBS="$TMP_ROOT/conductor-cfg-stubs"
mkdir -p "$CONDUCTOR_CFG_STUBS"
cat > "$CONDUCTOR_CFG_STUBS/conduct-ts" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CONDUCTOR_CFG_CALLS"
if [ "$1" = "config" ] && [ "$2" = "read" ]; then
  printf '%s\n' "$CONDUCTOR_CFG_READ_VALUE"
fi
EOF
chmod +x "$CONDUCTOR_CFG_STUBS/conduct-ts"

run_conductor_cfg_accessors() {
  local home=$1 field=$2 value=$3 default=$4
  CONDUCTOR_CFG_CALLS="$home/conductor-cfg-calls" \
    CONDUCTOR_CFG_READ_VALUE="$value" \
    HOME="$home" PATH="$CONDUCTOR_CFG_STUBS:$TEST_PATH" \
    bash -c 'source "$1"; conductor_cfg_set "$2" "$3"; conductor_cfg_get "$2" "$4"' \
      _ "$HARNESS_DIR/bin/lib/harness-common.sh" "$field" "$value" "$default"
}

# run_update <repo> <home> [args...] — no TTY on stdin.
run_update() {
  local repo=$1 home=$2
  shift 2
  set +e
  OUT=$(cd "$repo" && HOME="$home" PATH="$repo/bin:$TEST_PATH" "$repo/bin/update" "$@" < /dev/null 2>&1)
  CODE=$?
  set -e
}

# run_update_without_conduct <repo> <home> [args...]
# Deliberately leaves the repo's local conduct-ts seam off PATH.
run_update_without_conduct() {
  local repo=$1 home=$2
  shift 2
  set +e
  OUT=$(cd "$repo" && HOME="$home" PATH="$MISSING_CONDUCT_PATH" "$repo/bin/update" "$@" < /dev/null 2>&1)
  CODE=$?
  set -e
}

# run_update_tty <repo> <home> <answer> [args...] — pty-backed stdin via
# `script`, feeding <answer> so `[ -t 0 ]` checks see a real terminal
# (Stories 3/4's interactive prompts can't be exercised over a pipe).
run_update_tty() {
  local repo=$1 home=$2 answer=$3
  shift 3
  local log="$TMP_ROOT/tty-$$-${RANDOM}.log"
  set +e
  OUT=$(cd "$repo" && printf '%s\n' "$answer" | HOME="$home" PATH="$repo/bin:$TEST_PATH" script -qec "$repo/bin/update $*" "$log" 2>&1)
  CODE=$?
  set -e
}

if [ ! -f "$UPDATE_SRC" ]; then
  echo -e "${RED}${BOLD}bin/update does not exist yet (RED phase) — failing every acceptance criterion explicitly${NC}"
  echo -e "${BOLD}instead of running detailed assertions, which would trivially pass for the wrong reason${NC}"
  echo -e "${BOLD}(nothing happening looks identical to a correct no-op) once the script under test is missing.${NC}"
  echo ""
  for desc in \
    "Story 1 — force update check (happy: writes lastCheckedAt at latest)" \
    "Story 1 (negative) — non-git dir exits 0 without error" \
    "Story 2 — --set-channel main/tagged persist the channel" \
    "Story 2 (negative) — --set-channel bogus exits 2 naming valid values" \
    "Story 3 — tagged update: accept checks out tags/vX.Y.Z, runs bin/migrate, advances currentVersion" \
    "Story 3 — tagged update: decline makes no changes" \
    "Story 3 (negative) — bin/migrate failure rolls back and does not advance currentVersion" \
    "Story 4 — main-channel update: accept fast-forward-pulls, runs bin/migrate, advances currentVersion" \
    "Story 4 (negative) — diverged HEAD makes no changes" \
    "Story 5 — no-TTY prints manual command and exits 0 without checking out" \
    "Story 6 — first-run seeding writes currentVersion silently, no prompt" \
    "Story 9 — HARNESS.md/README.md/src/conductor/README.md mention bin/update" \
    ; do
    assert "$desc" 1
  done
  echo ""
  echo -e "${BOLD}Summary: ${PASS}/${TOTAL} passed${NC}"
  exit 1
fi

# ─── Update config accessors: canonical conductor YAML ownership ───────────

echo ""
echo -e "${BOLD}Update config accessors — conductor YAML${NC}"

# The legacy accessor names remain the update flow's two-argument interface,
# but every field must translate its camelCase name to the schema-owned
# conductor.<snake_case_key> path at the conduct-ts boundary.
for ACCESSOR_CASE in \
  'updateChannel|main|tagged|update_channel' \
  'autoCheck|false|true|auto_check' \
  'currentVersion|v0.4.0||current_version' \
  'lastCheckedAt|2026-08-09T12:00:00Z||last_checked_at'
do
  IFS='|' read -r FIELD VALUE DEFAULT SCHEMA_KEY <<< "$ACCESSOR_CASE"
  HOME_DIR=$(make_isolated_home)
  ACCESSOR_OUT=$(run_conductor_cfg_accessors "$HOME_DIR" "$FIELD" "$VALUE" "$DEFAULT")
  ACCESSOR_CALLS=$(cat "$HOME_DIR/conductor-cfg-calls" 2>/dev/null || true)

  assert "${FIELD}: two-argument set resolves conductor.${SCHEMA_KEY}" \
    "$(printf '%s\n' "$ACCESSOR_CALLS" | grep -qx "config set conductor.${SCHEMA_KEY} ${VALUE}" && echo 0 || echo 1)"
  assert "${FIELD}: two-argument get resolves conductor.${SCHEMA_KEY}" \
    "$(printf '%s\n' "$ACCESSOR_CALLS" | grep -qx "config read conductor.${SCHEMA_KEY}" && echo 0 || echo 1)"
  assert "${FIELD}: get returns conduct-ts config read output" \
    "$( [ "$ACCESSOR_OUT" = "$VALUE" ] && echo 0 || echo 1 )"
done

# A config read is authoritative: a missing conduct-ts must not turn into the
# caller's default. The update command names its declined reason, while its
# automatic entry remains advisory for startup callers.
HOME_DIR=$(make_isolated_home)
set +e
ACCESSOR_OUT=$(HOME="$HOME_DIR" PATH="$MISSING_CONDUCT_PATH" bash -c 'source "$1"; conductor_cfg_get updateChannel tagged' \
  _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>&1)
ACCESSOR_CODE=$?
set -e
assert "missing conduct-ts: config read returns non-zero" "$([ "$ACCESSOR_CODE" -ne 0 ] && echo 0 || echo 1)"
assert "missing conduct-ts: config read names the prerequisite" "$(case "$ACCESSOR_OUT" in *"conduct-ts"*) echo 0;; *) echo 1;; esac)"
assert "missing conduct-ts: config read never echoes caller default" "$(case "$ACCESSOR_OUT" in *"tagged"*) echo 1;; *) echo 0;; esac)"

REPO=$(make_repo "missing-conduct-ts")
HOME_DIR=$(make_isolated_home)
run_update_without_conduct "$REPO" "$HOME_DIR"
assert "missing conduct-ts: forced update check declines" "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
assert "missing conduct-ts: forced update check states the reason" "$(case "$OUT" in *"conduct-ts"*) echo 0;; *) echo 1;; esac)"

run_update_without_conduct "$REPO" "$HOME_DIR" --auto
assert "missing conduct-ts: --auto remains advisory" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "missing conduct-ts: --auto states the declined reason" "$(case "$OUT" in *"conduct-ts"*) echo 0;; *) echo 1;; esac)"
assert "update config path does not import PyYAML" "$(rg -q 'import yaml|from yaml import' "$HARNESS_DIR/bin/update" && echo 1 || echo 0)"

# ─── ST-1400-2: one-time legacy JSON seed ─────────────────────────────────

echo ""
echo -e "${BOLD}ST-1400-2 — legacy JSON seed${NC}"

# The legacy JSON was live configuration before the conductor block existed.
# Its values must therefore replace stale YAML during the one-time migration.
REPO=$(make_repo "legacy-json-seed")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "updateChannel": "main",
  "currentVersion": "v0.100.0"
}
EOF
set_conductor_cfg "$HOME_DIR" updateChannel tagged
set_conductor_cfg "$HOME_DIR" currentVersion v0.99.12

run_legacy_seed() {
  local repo=$1 home=$2 path
  path="$repo/bin:$TEST_PATH"
  if [ -n "${SEED_PATH_PREFIX:-}" ]; then
    path="$SEED_PATH_PREFIX:$path"
  fi
  set +e
  SEED_OUT=$(HOME="$home" PATH="$path" \
    bash -c 'source "$1"; seed_conductor_config_from_legacy' \
    _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>&1)
  SEED_CODE=$?
  set -e
}

run_legacy_seed "$REPO" "$HOME_DIR"
assert "legacy seed function is available" "$([ "$SEED_CODE" -eq 0 ] && echo 0 || echo 1)"
assert "legacy JSON overwrites stale update_channel" "$( [ "$(cfg_get "$HOME_DIR" updateChannel)" = "main" ] && echo 0 || echo 1 )"
assert "legacy JSON overwrites stale current_version" "$( [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.100.0" ] && echo 0 || echo 1 )"
assert "legacy JSON is renamed to its migration marker" \
  "$( [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json" ] && [ -f "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"

# Once the migration marker exists, a second seed must succeed without
# changing the conductor block or recreating the legacy file.
EXPECTED_SEED_CONFIG=$(cat "$HOME_DIR/.ai-conductor/config.yml")
run_legacy_seed "$REPO" "$HOME_DIR"
assert "second legacy seed is a no-op after migration" \
  "$( [ "$SEED_CODE" -eq 0 ] && [ "$(cat "$HOME_DIR/.ai-conductor/config.yml")" = "$EXPECTED_SEED_CONFIG" ] && [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json" ] && [ -f "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"

# A missing legacy file is an ordinary no-op: it must neither modify the
# schema-owned config nor create a migration marker.
REPO=$(make_repo "legacy-json-absent")
HOME_DIR=$(make_isolated_home)
set_conductor_cfg "$HOME_DIR" currentVersion v0.99.12
ABSENT_CONFIG=$(cat "$HOME_DIR/.ai-conductor/config.yml")
run_legacy_seed "$REPO" "$HOME_DIR"
assert "absent legacy JSON: seed is a successful no-op" "$([ "$SEED_CODE" -eq 0 ] && echo 0 || echo 1)"
assert "absent legacy JSON: leaves conductor block untouched" \
  "$( [ "$(cat "$HOME_DIR/.ai-conductor/config.yml")" = "$ABSENT_CONFIG" ] && echo 0 || echo 1 )"
assert "absent legacy JSON: creates no migration marker" \
  "$( [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"

# Empty and malformed JSON are not a seed. They must preserve the existing
# block and the source file so a repaired legacy config can be retried.
for LEGACY_CASE in empty malformed; do
  REPO=$(make_repo "legacy-json-${LEGACY_CASE}")
  HOME_DIR=$(make_isolated_home)
  mkdir -p "$HOME_DIR/.claude"
  if [ "$LEGACY_CASE" = empty ]; then
    : > "$HOME_DIR/.claude/ai-conductor.config.json"
  else
    printf '{ not valid json\n' > "$HOME_DIR/.claude/ai-conductor.config.json"
  fi
  set_conductor_cfg "$HOME_DIR" currentVersion v0.99.12
  INVALID_CONFIG=$(cat "$HOME_DIR/.ai-conductor/config.yml")
  run_legacy_seed "$REPO" "$HOME_DIR"
  assert "${LEGACY_CASE} legacy JSON: seed refuses invalid input" "$([ "$SEED_CODE" -ne 0 ] && echo 0 || echo 1)"
  assert "${LEGACY_CASE} legacy JSON: reports the invalid legacy JSON" \
    "$(case "$SEED_OUT" in *"legacy JSON"*) echo 0;; *) echo 1;; esac)"
  assert "${LEGACY_CASE} legacy JSON: leaves conductor block untouched" \
    "$( [ "$(cat "$HOME_DIR/.ai-conductor/config.yml")" = "$INVALID_CONFIG" ] && echo 0 || echo 1 )"
  assert "${LEGACY_CASE} legacy JSON: keeps source and creates no marker" \
    "$( [ -f "$HOME_DIR/.claude/ai-conductor.config.json" ] && [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"
done

# A partial valid legacy config must not invent the auto-check preference.
REPO=$(make_repo "legacy-json-missing-auto-check")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "currentVersion": "v0.100.0"
}
EOF
run_legacy_seed "$REPO" "$HOME_DIR"
assert "missing autoCheck: seed succeeds" "$([ "$SEED_CODE" -eq 0 ] && echo 0 || echo 1)"
assert "missing autoCheck: leaves conductor.auto_check unset" \
  "$( [ -z "$(cfg_get "$HOME_DIR" autoCheck)" ] && echo 0 || echo 1 )"
assert "missing autoCheck: carries forward supplied currentVersion" \
  "$( [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.100.0" ] && echo 0 || echo 1 )"

# Invalid channel data is individually dropped, with a warning, rather than
# poisoning the validated conductor block.
REPO=$(make_repo "legacy-json-invalid-channel")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "updateChannel": "nightly",
  "currentVersion": "v0.100.0"
}
EOF
run_legacy_seed "$REPO" "$HOME_DIR"
assert "invalid updateChannel: seed succeeds after dropping the key" "$([ "$SEED_CODE" -eq 0 ] && echo 0 || echo 1)"
assert "invalid updateChannel: reports a warning" \
  "$(case "$SEED_OUT" in *"updateChannel"*) echo 0;; *) echo 1;; esac)"
assert "invalid updateChannel: is not written" \
  "$( [ -z "$(cfg_get "$HOME_DIR" updateChannel)" ] && echo 0 || echo 1 )"

# The rename is the idempotence marker. A rename failure must be visible and
# leave the original source in place, never masquerading as a successful seed.
REPO=$(make_repo "legacy-json-rename-failure")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "currentVersion": "v0.100.0"
}
EOF
SEED_RENAME_STUBS="$TMP_ROOT/seed-rename-stubs"
mkdir -p "$SEED_RENAME_STUBS"
cat > "$SEED_RENAME_STUBS/mv" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$SEED_RENAME_STUBS/mv"
SEED_PATH_PREFIX="$SEED_RENAME_STUBS" run_legacy_seed "$REPO" "$HOME_DIR"
unset SEED_PATH_PREFIX
assert "legacy seed: failed rename returns failure" "$([ "$SEED_CODE" -ne 0 ] && echo 0 || echo 1)"
assert "legacy seed: failed rename reports the failure" \
  "$(case "$SEED_OUT" in *"rename"*) echo 0;; *) echo 1;; esac)"
assert "legacy seed: failed rename leaves original file in place" \
  "$( [ -f "$HOME_DIR/.claude/ai-conductor.config.json" ] && [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"

# ─── Story 2: set the update channel ───────────────────────────────────────

echo ""
echo -e "${BOLD}Story 2 — set-channel${NC}"

REPO=$(make_repo "s2")
HOME_DIR=$(make_isolated_home)

run_update "$REPO" "$HOME_DIR" --set-channel main
assert "--set-channel main exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "--set-channel main prints confirmation" "$(case "$OUT" in *"Update channel set to: main"*) echo 0;; *) echo 1;; esac)"
assert "--set-channel main persists updateChannel=main" "$([ "$(cfg_get "$HOME_DIR" updateChannel)" = "main" ] && echo 0 || echo 1)"

run_update "$REPO" "$HOME_DIR" --set-channel tagged
assert "--set-channel tagged exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "--set-channel tagged persists updateChannel=tagged" "$([ "$(cfg_get "$HOME_DIR" updateChannel)" = "tagged" ] && echo 0 || echo 1)"

run_update "$REPO" "$HOME_DIR" --set-channel bogus
assert "--set-channel bogus exits 2" "$([ "$CODE" -eq 2 ] && echo 0 || echo 1)"
assert "--set-channel bogus names valid channels" "$(case "$OUT" in *"tagged"*"main"*|*"main"*"tagged"*) echo 0;; *) echo 1;; esac)"

# ─── Story 1: force an update check ────────────────────────────────────────

echo ""
echo -e "${BOLD}Story 1 — force update check${NC}"

REPO=$(make_repo "s1-uptodate")
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
set_current_version "$HOME_DIR" v0.4.0

run_update "$REPO" "$HOME_DIR"
assert "already at latest: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "already at latest: writes lastCheckedAt" "$([ -n "$(cfg_get "$HOME_DIR" lastCheckedAt)" ] && echo 0 || echo 1)"

REPO_NOGIT="$TMP_ROOT/s1-nogit"
mkdir -p "$REPO_NOGIT/bin"
cp "$UPDATE_SRC" "$REPO_NOGIT/bin/update" 2>/dev/null || true
chmod +x "$REPO_NOGIT/bin/update" 2>/dev/null || true
HOME_DIR2=$(make_isolated_home)
if [ -f "$REPO_NOGIT/bin/update" ]; then
  run_update "$REPO_NOGIT" "$HOME_DIR2"
  assert "non-git dir: exits 0 without error" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
else
  assert "non-git dir: exits 0 without error" 1
fi

# ─── Story 7: --auto gating + -h/--help usage (T4 argument dispatch) ──────

echo ""
echo -e "${BOLD}Story 7 — --auto gating and usage${NC}"

REPO=$(make_repo "s7-auto-disabled")
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
set_conductor_cfg "$HOME_DIR" autoCheck false
set_conductor_cfg "$HOME_DIR" currentVersion v0.3.0

run_update "$REPO" "$HOME_DIR" --auto
assert "--auto with autoCheck=false: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "--auto with autoCheck=false: silent no-op (no lastCheckedAt)" "$([ -z "$(cfg_get "$HOME_DIR" lastCheckedAt)" ] && echo 0 || echo 1)"

REPO=$(make_repo "s7-auto-enabled")
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.4.0
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0

run_update "$REPO" "$HOME_DIR" --auto
assert "--auto with autoCheck!=false: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "--auto with autoCheck!=false: runs the check (writes lastCheckedAt)" "$([ -n "$(cfg_get "$HOME_DIR" lastCheckedAt)" ] && echo 0 || echo 1)"

REPO=$(make_repo "s7-help")
HOME_DIR=$(make_isolated_home)

run_update "$REPO" "$HOME_DIR" -h
assert "-h: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "-h: prints usage" "$(case "$OUT" in *"Usage: update"*) echo 0;; *) echo 1;; esac)"

run_update "$REPO" "$HOME_DIR" --help
assert "--help: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "--help: prints usage" "$(case "$OUT" in *"Usage: update"*) echo 0;; *) echo 1;; esac)"

run_update "$REPO" "$HOME_DIR" --bogus-flag
assert "unrecognized arg: exits 2" "$([ "$CODE" -eq 2 ] && echo 0 || echo 1)"
assert "unrecognized arg: prints usage" "$(case "$OUT" in *"Usage: update"*) echo 0;; *) echo 1;; esac)"

# ─── Story 6: first-run version seeding ────────────────────────────────────

echo ""
echo -e "${BOLD}Story 6 — first-run seeding${NC}"

REPO=$(make_repo "s6")
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
HOME_DIR=$(make_isolated_home)
# currentVersion intentionally unset.

run_update "$REPO" "$HOME_DIR"
assert "seeds currentVersion silently" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.4.0" ] && echo 0 || echo 1)"
assert "no update prompt on first-run seed" "$(case "$OUT" in *"Update to"*) echo 1;; *) echo 0;; esac)"

# ─── #1005: tagged installs use installed release identity ─────────────────

echo ""
echo -e "${BOLD}#1005 — tagged install identity${NC}"

# The post-release VERSION is intentionally ahead of the installed v0.3.0
# checkout. A stale forward-looking config must not suppress the v0.4.0
# update: the exact checked-out tag is the authority for tagged installs.
REPO=$(make_repo "i17-installed-tag")
OLD_RELEASE_SHA=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" checkout -q "$OLD_RELEASE_SHA"
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.4.0

run_update "$REPO" "$HOME_DIR"
assert "checked-out tag wins over forward-looking recorded version" "$(case "$OUT" in *"v0.3.0 → v0.4.0"*) echo 0;; *) echo 1;; esac)"
assert "checked-out tag repairs recorded tagged identity" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && echo 0 || echo 1)"

# A checkout between release tags with neither an exact tag nor a previously
# recorded tagged identity cannot safely compare releases. It must report that
# status as unverifiable instead of seeding from the latest remote tag.
REPO=$(make_repo "i17-unknown-identity")
git -C "$REPO" commit -q --allow-empty -m "between releases"
BETWEEN_RELEASES_SHA=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" checkout -q "$BETWEEN_RELEASES_SHA"
HOME_DIR=$(make_isolated_home)

run_update "$REPO" "$HOME_DIR"
assert "unknown tagged identity does not offer an update" "$(case "$OUT" in *"Harness update available"*) echo 1;; *) echo 0;; esac)"
assert "unknown tagged identity reports an unverifiable installed version" "$(case "$OUT" in *"unverifiable"*) echo 0;; *) echo 1;; esac)"
assert "unknown tagged identity does not record the latest tag" "$([ -z "$(cfg_get "$HOME_DIR" currentVersion)" ] && echo 0 || echo 1)"

# A non-exact checkout can still be a tagged install when its prior successful
# update recorded the tag. That record is the fallback authority.
REPO=$(make_repo "i17-recorded-tag")
git -C "$REPO" commit -q --allow-empty -m "between releases"
BETWEEN_RELEASES_SHA=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" checkout -q "$BETWEEN_RELEASES_SHA"
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0

run_update "$REPO" "$HOME_DIR"
assert "recorded tagged identity remains update authority off-tag" "$(case "$OUT" in *"v0.3.0 → v0.4.0"*) echo 0;; *) echo 1;; esac)"

# ─── Story 5: no-TTY guidance ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}Story 5 — no-TTY guidance${NC}"

REPO=$(make_repo "s5")
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" checkout -q v0.3.0
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
BEFORE_SHA=$(git -C "$REPO" rev-parse HEAD)

run_update "$REPO" "$HOME_DIR"
assert "no-TTY: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "no-TTY: prints manual checkout+migrate command" "$(case "$OUT" in *"git checkout"*"bin/migrate"*) echo 0;; *) echo 1;; esac)"
assert "no-TTY: does not check out the new tag" "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$BEFORE_SHA" ] && echo 0 || echo 1)"

# ─── Story 3: tagged-channel update happy path + rollback ─────────────────

echo ""
echo -e "${BOLD}Story 3 — tagged update (TTY)${NC}"

REPO=$(make_repo "s3-accept")
# v0.4.0 must land on its own commit, not the same commit as v0.3.0 — two
# tags on one commit make `git describe --tags` pick whichever tag git's
# internal ref ordering favors (observed: the earlier-created tag), so the
# "checked out v0.4.0" assertion below would be unable to actually
# distinguish "checked out v0.3.0's commit" from "checked out v0.4.0's".
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
git -C "$REPO" checkout -q v0.3.0
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0

run_update_tty "$REPO" "$HOME_DIR" y
assert "accept: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "accept: renders changelog range" "$(case "$OUT" in *"Feature D"*) echo 0;; *) echo 1;; esac)"
assert "accept: checks out tags/v0.4.0" "$([ "$(git -C "$REPO" describe --tags 2>/dev/null)" = "v0.4.0" ] && echo 0 || echo 1)"
assert "accept: invokes bin/migrate" "$([ -f "$REPO/.migrate-calls" ] && echo 0 || echo 1)"
assert "accept: advances currentVersion" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.4.0" ] && echo 0 || echo 1)"

REPO=$(make_repo "s3-decline")
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" checkout -q v0.3.0
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
BEFORE_SHA=$(git -C "$REPO" rev-parse HEAD)

run_update_tty "$REPO" "$HOME_DIR" n
assert "decline: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "decline: logs skip" "$(case "$OUT" in *"Skipping update"*) echo 0;; *) echo 1;; esac)"
assert "decline: no checkout occurred" "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$BEFORE_SHA" ] && echo 0 || echo 1)"
assert "decline: currentVersion not advanced" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && echo 0 || echo 1)"

echo ""
echo -e "${BOLD}Story 3 (negative) — rollback on bin/migrate failure${NC}"

REPO=$(make_repo "s3-rollback")
stub_migrate "$REPO" 1
git -C "$REPO" add -A && git -C "$REPO" commit -q -m "restub" --allow-empty
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
git -C "$REPO" checkout -q v0.3.0
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
BEFORE_SHA=$(git -C "$REPO" rev-parse HEAD)

run_update_tty "$REPO" "$HOME_DIR" y
assert "migrate failure: returns non-zero" "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
assert "migrate failure: prints failure" "$(case "$OUT" in *"failed"*|*"Failed"*) echo 0;; *) echo 1;; esac)"
assert "migrate failure: rolls back to prior ref" "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$BEFORE_SHA" ] && echo 0 || echo 1)"
assert "migrate failure: currentVersion not advanced" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" != "v0.4.0" ] && echo 0 || echo 1)"

# ─── Story 4: main-channel update happy path + diverged guard ─────────────

echo ""
echo -e "${BOLD}Story 4 — main-channel update${NC}"

make_main_repo() {
  local name=$1
  local origin="$TMP_ROOT/${name}-origin.git"
  git init -q --bare "$origin"
  local clone
  clone=$(make_repo "$name")
  (
    cd "$clone"
    git remote add origin "$origin"
    git branch -M main
    git push -q origin main
    git --git-dir="$origin" symbolic-ref HEAD refs/heads/main
  )
  echo "$clone|$origin"
}

PAIR=$(make_main_repo "s4-accept")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
HOME_DIR=$(make_isolated_home)
# A tagged-channel record must not affect main-channel detection: main compares
# commits, not release tags or VERSION.
set_current_version "$HOME_DIR" v0.4.0
run_update "$REPO" "$HOME_DIR" --set-channel main

WORK="$TMP_ROOT/s4-accept-push"
git clone -q "$ORIGIN" "$WORK"
assert "main fixture: fresh clone checks out main" "$( [ "$(git -C "$WORK" branch --show-current)" = "main" ] && echo 0 || echo 1 )"
(cd "$WORK" && git config user.email t@t.com && git config user.name T && echo more >> CHANGELOG.md && git add -A && git commit -q -m "advance" && git push -q origin main)

run_update_tty "$REPO" "$HOME_DIR" y
assert "main accept: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "main accept: invokes bin/migrate" "$([ -f "$REPO/.migrate-calls" ] && echo 0 || echo 1)"
assert "main accept: currentVersion is main@<sha>" "$(case "$(cfg_get "$HOME_DIR" currentVersion)" in main@*) echo 0;; *) echo 1;; esac)"

PAIR=$(make_main_repo "s4-diverged")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" main@0000000
(cd "$REPO" && git commit -q --allow-empty -m "local-only divergent commit")
BEFORE_SHA=$(git -C "$REPO" rev-parse HEAD)

run_update "$REPO" "$HOME_DIR" --set-channel main
run_update "$REPO" "$HOME_DIR"
assert "diverged: exits 0 without pulling" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "diverged: HEAD unchanged" "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$BEFORE_SHA" ] && echo 0 || echo 1)"

assert "CHANGELOG carries a Migration block for the flag rename" \
  "$(awk '/^## \[Unreleased\]/{f=1} f&&/^## Migration/{print;exit}' "$HARNESS_DIR/CHANGELOG.md" | grep -q "Migration" && echo 0 || echo 1)"

echo ""
echo -e "${BOLD}Summary: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
