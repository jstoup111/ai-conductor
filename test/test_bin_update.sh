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

# run_identity_resolver <repo_dir>
# Calls the real shared-library binary against a disposable local Git checkout.
# The resolver's tab-separated contract is: kind, identity, baseline, distance,
# source.  Keep its invocation separate from bin/update so these tests pin the
# checkout-derived identity rule before any caller starts consuming it.
run_identity_resolver() {
  local repo=$1
  set +e
  RESOLVER_OUT=$(cd "$repo" && bash -c 'set -euo pipefail; source "$1"; resolve_harness_identity "$2"' \
    _ "$repo/bin/lib/harness-common.sh" "$repo" 2>&1)
  RESOLVER_CODE=$?
  set -e
}

# assert_resolved_identity <description> <kind> <identity> <baseline> <distance> <source>
assert_resolved_identity() {
  local desc=$1 expected_kind=$2 expected_identity=$3 expected_baseline=$4
  local expected_distance=$5 expected_source=$6
  local kind identity baseline distance source

  kind=$(printf '%s\n' "$RESOLVER_OUT" | cut -f1)
  identity=$(printf '%s\n' "$RESOLVER_OUT" | cut -f2)
  baseline=$(printf '%s\n' "$RESOLVER_OUT" | cut -f3)
  distance=$(printf '%s\n' "$RESOLVER_OUT" | cut -f4)
  source=$(printf '%s\n' "$RESOLVER_OUT" | cut -f5)
  assert "$desc: exits 0" "$([ "$RESOLVER_CODE" -eq 0 ] && echo 0 || echo 1)"
  assert "$desc: kind is $expected_kind" "$([ "$kind" = "$expected_kind" ] && echo 0 || echo 1)"
  assert "$desc: identity is $expected_identity" "$([ "$identity" = "$expected_identity" ] && echo 0 || echo 1)"
  assert "$desc: baseline is $expected_baseline" "$([ "$baseline" = "$expected_baseline" ] && echo 0 || echo 1)"
  assert "$desc: distance is $expected_distance" "$([ "$distance" = "$expected_distance" ] && echo 0 || echo 1)"
  assert "$desc: source is $expected_source" "$([ "$source" = "$expected_source" ] && echo 0 || echo 1)"
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

# run_install_configure_conductor <home> <update_mode>
# Loads the installer through its public configuration boundary, with the real
# shared accessor library available beside the copied script.  The conduct-ts
# fake persists the same scalar YAML fields that the production CLI owns.
run_install_configure_conductor() {
  local home=$1 update_mode=$2 installer_dir fragment stubs
  installer_dir="$TMP_ROOT/install-configure-${RANDOM}"
  fragment="$installer_dir/bin/install-configure-test"
  stubs="$installer_dir/stubs"
  mkdir -p "$installer_dir/bin/lib"
  ln -s "$HARNESS_DIR/skills" "$installer_dir/skills"
  ln -s "$HARNESS_DIR/HARNESS.md" "$installer_dir/HARNESS.md"
  cp "$HARNESS_DIR/VERSION" "$installer_dir/VERSION"
  cp "$HARNESS_DIR/bin/install" "$installer_dir/bin/install"
  cp "$HARNESS_DIR/bin/lib/harness-common.sh" "$installer_dir/bin/lib/harness-common.sh"
  mkdir -p "$stubs"
  cat > "$stubs/conduct-ts" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$INSTALL_CONFIG_CALLS"
[ "$1" = "config" ] || exit 2
config="${HOME}/.ai-conductor/config.yml"
key="${3#conductor.}"
case "$2" in
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
  read)
    awk -F ': *' -v key="$key" '$1 == "  " key { print $2; exit }' "$config" 2>/dev/null || true
    ;;
  *) exit 2 ;;
esac
EOF
  chmod +x "$stubs/conduct-ts"
  awk '/^# ─── Main /{exit} {print}' "$installer_dir/bin/install" > "$fragment"
  printf '%s\n' "UPDATE_MODE=$update_mode" 'configure_conductor' >> "$fragment"
  chmod +x "$fragment"
  : > "$home/install-config-calls"

  set +e
  INSTALL_CONFIG_OUT=$(INSTALL_CONFIG_CALLS="$home/install-config-calls" \
    HOME="$home" PATH="$stubs:$TEST_PATH" "$fragment" 2>&1)
  INSTALL_CONFIG_CODE=$?
  set -e
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

# ─── Checkout-derived identity resolver (Task 1 RED) ───────────────────────

echo ""
echo -e "${BOLD}Checkout-derived identity resolver${NC}"

REPO=$(make_repo "resolver-exact-tag")
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
run_identity_resolver "$REPO"
assert_resolved_identity "exact release tag" release v0.4.0 v0.4.0 0 "checked-out tag"

REPO=$(make_repo "resolver-three-commits-post-tag")
for commit_number in 1 2 3; do
  git -C "$REPO" commit -q --allow-empty -m "post-release ${commit_number}"
done
run_identity_resolver "$REPO"
assert_resolved_identity "three commits past a release" post-release v0.3.0+3 v0.3.0 3 checkout

# The stable release tag exists in the repository, but an orphan checkout can
# reach only a release candidate.  This is a genuine undeterminable identity,
# rather than a missing config record on a checkout with a stable ancestor.
REPO=$(make_repo "resolver-orphan-no-reachable-stable-tag")
git -C "$REPO" checkout -q --orphan no-release-history
git -C "$REPO" rm -qrf --cached .
git -C "$REPO" clean -qfd -e bin/lib/harness-common.sh
printf 'orphan checkout\n' > "$REPO/README.md"
git -C "$REPO" add README.md
git -C "$REPO" commit -q -m "orphan checkout"
git -C "$REPO" tag v0.4.0-rc1
run_identity_resolver "$REPO"
assert_resolved_identity "checkout without a reachable stable release" undeterminable unknown "" "" none
assert "checkout without a reachable stable release: leaks no diagnostic" \
  "$([ "$RESOLVER_OUT" = $'undeterminable\tunknown\t\t\tnone' ] && echo 0 || echo 1)"

# A real Git query failure has the same fail-closed contract as an empty
# result.  Keep the library present while making only its checkout argument
# non-Git, so a source/cd failure cannot accidentally stand in for the query.
REPO="$TMP_ROOT/resolver-git-query-failure"
mkdir -p "$REPO/bin/lib"
cp "$HARNESS_DIR/bin/lib/harness-common.sh" "$REPO/bin/lib/harness-common.sh"
run_identity_resolver "$REPO"
assert_resolved_identity "failed Git tag query" undeterminable unknown "" "" none
assert "failed Git tag query: leaks no Git diagnostic" \
  "$([ "$RESOLVER_OUT" = $'undeterminable\tunknown\t\t\tnone' ] && echo 0 || echo 1)"

# v0.4.0 is one commit from HEAD while the higher reachable v0.5.0 is two.
# A nearest-tag implementation therefore chooses v0.4.0; the resolver must
# deliberately select the higher reachable release instead.
REPO=$(make_repo "resolver-highest-reachable-not-nearest")
git -C "$REPO" commit -q --allow-empty -m "v0.5.0"
git -C "$REPO" tag v0.5.0
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" commit -q --allow-empty -m "post-release head"
LOWER_TAG_DISTANCE=$(git -C "$REPO" rev-list --count v0.4.0..HEAD)
HIGHER_TAG_DISTANCE=$(git -C "$REPO" rev-list --count v0.5.0..HEAD)
NEAREST_TAG=$(git -C "$REPO" describe --tags --abbrev=0 HEAD)
assert "highest-vs-nearest fixture: lower tag is strictly nearer" \
  "$([ "$LOWER_TAG_DISTANCE" -lt "$HIGHER_TAG_DISTANCE" ] && echo 0 || echo 1)"
assert "highest-vs-nearest fixture: Git describes the lower tag as nearest" \
  "$([ "$NEAREST_TAG" = "v0.4.0" ] && echo 0 || echo 1)"
run_identity_resolver "$REPO"
assert_resolved_identity "highest reachable release beats nearest release" post-release v0.5.0+2 v0.5.0 2 checkout

# `git describe` silently considers only ten candidates by default.  Exercise
# more than twice that many reachable releases to pin the unbounded lookup.
REPO=$(make_repo "resolver-twenty-two-reachable-tags")
for tag_number in $(seq 1 22); do
  git -C "$REPO" commit -q --allow-empty -m "v0.4.${tag_number}"
  git -C "$REPO" tag "v0.4.${tag_number}"
done
git -C "$REPO" commit -q --allow-empty -m "post twenty-second release"
run_identity_resolver "$REPO"
assert_resolved_identity "twenty-two reachable release tags" post-release v0.4.22+1 v0.4.22 1 checkout

# Long lightweight refs exercise the resolver's real Git pipeline without
# thousands of commits.  The roughly 170 KiB output reliably reaches the
# evaluator's broken-pipe path while keeping this fixture quick to construct.
REPO=$(make_repo "resolver-large-tag-output")
HEAD_SHA=$(git -C "$REPO" rev-parse HEAD)
TAG_SUFFIX=""
for suffix_component in $(seq 1 80); do
  TAG_SUFFIX="${TAG_SUFFIX}0."
done
for tag_number in $(seq 1 1024); do
  printf 'create refs/tags/v1.%s.%s0 %s\n' "$tag_number" "$TAG_SUFFIX" "$HEAD_SHA"
done | git -C "$REPO" update-ref --stdin
EXPECTED_LARGE_TAG="v1.1024.${TAG_SUFFIX}0"
run_identity_resolver "$REPO"
assert_resolved_identity "large reachable-tag output" release "$EXPECTED_LARGE_TAG" "$EXPECTED_LARGE_TAG" 0 "checked-out tag"
assert "large reachable-tag output: leaks no pipeline diagnostic" \
  "$([ "$RESOLVER_OUT" = "release"$'\t'"$EXPECTED_LARGE_TAG"$'\t'"$EXPECTED_LARGE_TAG"$'\t0\tchecked-out tag' ] && echo 0 || echo 1)"

# Prerelease tags are not release baselines.  They must not displace the last
# stable release even though the basic Git glob can match their names.
REPO=$(make_repo "resolver-excludes-release-candidate")
git -C "$REPO" commit -q --allow-empty -m "v0.4.0-rc1"
git -C "$REPO" tag v0.4.0-rc1
run_identity_resolver "$REPO"
assert_resolved_identity "release candidate tag is excluded" post-release v0.3.0+1 v0.3.0 1 checkout

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

# ─── Update config access does not depend on PyYAML ────────────────────────
# The approved ADR keeps the update-specific accessors and entry points off
# PyYAML, routing every conductor read and write through conduct-ts. It
# deliberately leaves the generic harness_cfg_get/harness_cfg_set viewer
# helpers on PyYAML, so those stay out of scope here.
#
# This was previously a static "does bin/update contain `import yaml`" scan,
# which proved nothing: it passes on the base tree, it passes on any tree once
# the scanner is unavailable, and it never touches the accessors the ADR is
# actually about. Break the import instead and run the real entry points.

NO_YAML_LIB="$TMP_ROOT/no-yaml-lib"
mkdir -p "$NO_YAML_LIB"
cat > "$NO_YAML_LIB/yaml.py" <<'EOF'
raise ImportError("PyYAML is unavailable in this fixture")
EOF
NO_YAML_BIN="$TMP_ROOT/no-yaml-bin"
mkdir -p "$NO_YAML_BIN"
cat > "$NO_YAML_BIN/python3" <<EOF
#!/usr/bin/env bash
# Shadows PyYAML with a module that always raises, so any code path that
# reaches \`import yaml\` fails loudly instead of silently succeeding.
PYTHONPATH="$NO_YAML_LIB\${PYTHONPATH:+:\$PYTHONPATH}" exec "$PY3" "\$@"
EOF
chmod +x "$NO_YAML_BIN/python3"
NO_YAML_PATH="$NO_YAML_BIN:/usr/bin:/bin"

# The fixture is only meaningful if it really breaks the import.
set +e
NO_YAML_PROBE=$(PATH="$NO_YAML_PATH" python3 -c 'import yaml' 2>&1)
NO_YAML_PROBE_CODE=$?
set -e
assert "no-PyYAML fixture actually breaks 'import yaml'" \
  "$( [ "$NO_YAML_PROBE_CODE" -ne 0 ] && case "$NO_YAML_PROBE" in *"unavailable in this fixture"*) echo 0;; *) echo 1;; esac || echo 1)"

# The accessors are the ADR's subject: they must still resolve the conductor
# block through conduct-ts with PyYAML unimportable.
HOME_DIR=$(make_isolated_home)
set +e
NO_YAML_ACCESSOR_OUT=$(CONDUCTOR_CFG_CALLS="$HOME_DIR/conductor-cfg-calls" \
  CONDUCTOR_CFG_READ_VALUE="main" \
  HOME="$HOME_DIR" PATH="$CONDUCTOR_CFG_STUBS:$NO_YAML_PATH" \
  bash -c 'source "$1"; conductor_cfg_set updateChannel main; conductor_cfg_get updateChannel tagged' \
    _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>&1)
NO_YAML_ACCESSOR_CODE=$?
set -e
NO_YAML_CALLS=$(cat "$HOME_DIR/conductor-cfg-calls" 2>/dev/null || true)
assert "without PyYAML: conductor accessors still succeed" \
  "$([ "$NO_YAML_ACCESSOR_CODE" -eq 0 ] && echo 0 || echo 1)"
assert "without PyYAML: conductor write delegates to conduct-ts" \
  "$(printf '%s\n' "$NO_YAML_CALLS" | grep -qx 'config set conductor.update_channel main' && echo 0 || echo 1)"
assert "without PyYAML: conductor read delegates to conduct-ts" \
  "$(printf '%s\n' "$NO_YAML_CALLS" | grep -qx 'config read conductor.update_channel' && echo 0 || echo 1)"
assert "without PyYAML: conductor read returns the conduct-ts value" \
  "$(case "$NO_YAML_ACCESSOR_OUT" in *"main"*) echo 0;; *) echo 1;; esac)"

# The entry point must reach the same conclusion it reaches with PyYAML present.
REPO=$(make_repo "no-pyyaml")
HOME_DIR=$(make_isolated_home)
set_conductor_cfg "$HOME_DIR" updateChannel tagged
set +e
OUT=$(cd "$REPO" && HOME="$HOME_DIR" PATH="$REPO/bin:$NO_YAML_PATH" "$REPO/bin/update" --auto < /dev/null 2>&1)
CODE=$?
set -e
assert "without PyYAML: bin/update --auto completes" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "without PyYAML: bin/update never reports a yaml import failure" \
  "$(case "$OUT" in *"unavailable in this fixture"*|*"ModuleNotFoundError"*) echo 1;; *) echo 0;; esac)"

# ─── Installer update config: shared conductor YAML ownership ─────────────

echo ""
echo -e "${BOLD}Installer update config — conductor YAML${NC}"

# Fresh installs must create the canonical conductor block through the shared
# accessors; no legacy Claude-only JSON file may be recreated.
HOME_DIR=$(make_isolated_home)
run_install_configure_conductor "$HOME_DIR" false
assert "installer first run writes conductor YAML through shared accessors" \
  "$( [ "$INSTALL_CONFIG_CODE" -eq 0 ] && [ "$(cfg_get "$HOME_DIR" updateChannel)" = "stable" ] && [ "$(cfg_get "$HOME_DIR" autoCheck)" = "true" ] && [ -n "$(cfg_get "$HOME_DIR" currentVersion)" ] && [ -n "$(cfg_get "$HOME_DIR" lastCheckedAt)" ] && echo 0 || echo 1)"
assert "installer first run calls shared conductor accessors" \
  "$( grep -qx 'config set conductor.update_channel stable' "$HOME_DIR/install-config-calls" && grep -qx 'config set conductor.auto_check true' "$HOME_DIR/install-config-calls" && grep -qx 'config set conductor.current_version .*' "$HOME_DIR/install-config-calls" && grep -qx 'config set conductor.last_checked_at .*' "$HOME_DIR/install-config-calls" && [ "$(wc -l < "$HOME_DIR/install-config-calls")" -eq 4 ] && echo 0 || echo 1)"
assert "installer first run creates no legacy JSON config" \
  "$( [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json" ] && echo 0 || echo 1)"

# A legacy-only installation must seed before first-run detection. Otherwise,
# the initial default writes would overwrite its channel and auto-check choice.
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "updateChannel": "main",
  "autoCheck": false,
  "currentVersion": "v0.100.0"
}
EOF
run_install_configure_conductor "$HOME_DIR" false
assert "installer preserves seeded legacy preferences before first-run setup" \
  "$( [ "$INSTALL_CONFIG_CODE" -eq 0 ] && [ "$(cfg_get "$HOME_DIR" updateChannel)" = "main" ] && [ "$(cfg_get "$HOME_DIR" autoCheck)" = "false" ] && case "$(cfg_get "$HOME_DIR" currentVersion)" in main@*) true;; *) false;; esac && [ -f "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1)"

# Update mode owns only the current version and check timestamp; it must retain
# a user's selected channel and auto-check preference in the same YAML block.
HOME_DIR=$(make_isolated_home)
set_conductor_cfg "$HOME_DIR" updateChannel main
set_conductor_cfg "$HOME_DIR" autoCheck false
set_conductor_cfg "$HOME_DIR" currentVersion stale-version
set_conductor_cfg "$HOME_DIR" lastCheckedAt stale-time
run_install_configure_conductor "$HOME_DIR" true
assert "installer update refreshes version and timestamp while preserving preferences" \
  "$( [ "$INSTALL_CONFIG_CODE" -eq 0 ] && [ "$(cfg_get "$HOME_DIR" updateChannel)" = "main" ] && [ "$(cfg_get "$HOME_DIR" autoCheck)" = "false" ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" != "stale-version" ] && [ "$(cfg_get "$HOME_DIR" lastCheckedAt)" != "stale-time" ] && echo 0 || echo 1)"
assert "installer update reads the channel before calling refresh accessors" \
  "$( grep -qx 'config read conductor.update_channel' "$HOME_DIR/install-config-calls" && grep -qx 'config set conductor.current_version .*' "$HOME_DIR/install-config-calls" && grep -qx 'config set conductor.last_checked_at .*' "$HOME_DIR/install-config-calls" && [ "$(wc -l < "$HOME_DIR/install-config-calls")" -eq 3 ] && echo 0 || echo 1)"

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

# Run both public accessors in one shell so the migration guard's lifetime is
# observable.  A setter can be the first configuration access during startup;
# it must not let a later getter replay legacy JSON over that explicit write.
run_conductor_cfg_set_then_get() {
  local repo=$1 home=$2
  set +e
  ACCESSOR_OUT=$(HOME="$home" PATH="$repo/bin:$TEST_PATH" \
    bash -c 'source "$1"; conductor_cfg_set currentVersion v0.101.0; conductor_cfg_get currentVersion ""' \
    _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>&1)
  ACCESSOR_CODE=$?
  set -e
}

# The python shim observes the real seed body's legacy-JSON parse while still
# delegating to the system interpreter.  It does not replace any helper.
run_conductor_cfg_seed_sequence() {
  local home=$1 count_file=$2
  local python_stubs="$TMP_ROOT/conductor-cfg-python-stubs"
  mkdir -p "$python_stubs"
  cat > "$python_stubs/python3" <<EOF
#!/usr/bin/env bash
printf 'parsed\\n' >> "$count_file"
exec "$PY3" "\$@"
EOF
  chmod +x "$python_stubs/python3"
  set +e
  ACCESSOR_OUT=$(CONDUCTOR_CFG_CALLS="$home/conductor-cfg-calls" \
    CONDUCTOR_CFG_READ_VALUE='' \
    HOME="$home" PATH="$CONDUCTOR_CFG_STUBS:$python_stubs:$TEST_PATH" \
    bash -c '
      source "$1"
      conductor_cfg_get currentVersion "" >/dev/null
      conductor_cfg_set updateChannel tagged
      conductor_cfg_get updateChannel tagged >/dev/null
    ' _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>&1)
  ACCESSOR_CODE=$?
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

# Legacy seeding is a one-time migration convenience, not a precondition for
# reading configuration. When it fails but the schema-owned block is readable,
# the getter must still return that block's value: a stale legacy file cannot
# be allowed to disable the update check outright. Fail-closed still governs
# the read itself — only the seed degrades.
REPO=$(make_repo "legacy-seed-failure-readable-config")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
printf '{ not valid json\n' > "$HOME_DIR/.claude/ai-conductor.config.json"
set_conductor_cfg "$HOME_DIR" updateChannel main
set +e
ACCESSOR_VALUE=$(HOME="$HOME_DIR" PATH="$REPO/bin:$TEST_PATH" \
  bash -c 'source "$1"; conductor_cfg_get updateChannel tagged' \
  _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>"$HOME_DIR/accessor-stderr")
ACCESSOR_CODE=$?
set -e
ACCESSOR_STDERR=$(cat "$HOME_DIR/accessor-stderr")
assert "unseedable legacy JSON: getter still reads the schema-owned value" \
  "$(if [ "$ACCESSOR_CODE" -eq 0 ] && [ "$ACCESSOR_VALUE" = "main" ]; then echo 0; else echo 1; fi)"
assert "unseedable legacy JSON: getter still warns about the failed seed" \
  "$(case "$ACCESSOR_STDERR" in *"legacy JSON"*) echo 0;; *) echo 1;; esac)"
assert "unseedable legacy JSON: source is kept for a later repair" \
  "$( [ -f "$HOME_DIR/.claude/ai-conductor.config.json" ] && [ ! -e "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"

# The seed writes through conduct-ts, so an installed binary too old to accept
# `config set` fails the seed while `config read` still works. That is exactly
# the mid-update stale-build case, and it must not decline the update check.
REPO=$(make_repo "legacy-seed-set-unsupported")
cat > "$REPO/bin/conduct-ts" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
config="${HOME}/.ai-conductor/config.yml"
if [ "${1:-}" = "config" ] && [ "${2:-}" = "read" ]; then
  awk -F ': *' -v key="${3#conductor.}" '$1 == "  " key { print $2; exit }' "$config" 2>/dev/null || true
  exit 0
fi
echo "conduct: the inline SDLC pipeline now runs under the \`inline\` subcommand." >&2
exit 1
EOF
chmod +x "$REPO/bin/conduct-ts"
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "updateChannel": "main"
}
EOF
set_conductor_cfg "$HOME_DIR" updateChannel main
set +e
ACCESSOR_VALUE=$(HOME="$HOME_DIR" PATH="$REPO/bin:$TEST_PATH" \
  bash -c 'source "$1"; conductor_cfg_get updateChannel tagged' \
  _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>"$HOME_DIR/accessor-stderr")
ACCESSOR_CODE=$?
set -e
assert "unwritable conductor block during seed: getter still reads the channel" \
  "$(if [ "$ACCESSOR_CODE" -eq 0 ] && [ "$ACCESSOR_VALUE" = "main" ]; then echo 0; else echo 1; fi)"

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

# A warning emitted while the accessor seeds legacy JSON must remain a
# diagnostic.  In particular, callers capture the accessor's stdout as the
# setting value, so a skipped updateChannel cannot become part of that value.
REPO=$(make_repo "legacy-json-invalid-channel-accessor")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "updateChannel": "nightly",
  "currentVersion": "v0.100.0"
}
EOF
set +e
ACCESSOR_VALUE=$(HOME="$HOME_DIR" PATH="$REPO/bin:$TEST_PATH" \
  bash -c 'source "$1"; value=$(conductor_cfg_get currentVersion ""); status=$?; printf "%s\\n" "$value"; exit "$status"' \
    _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>"$HOME_DIR/accessor-stderr")
ACCESSOR_CODE=$?
set -e
ACCESSOR_STDERR=$(cat "$HOME_DIR/accessor-stderr")
assert "invalid updateChannel: accessor captures only the requested value and warns on stderr" \
  "$(if [ "$ACCESSOR_CODE" -eq 0 ] && [ "$ACCESSOR_VALUE" = "v0.100.0" ] && [[ "$ACCESSOR_STDERR" = *"updateChannel"* ]]; then echo 0; else echo 1; fi)"

# A failed seed may invoke the setter before the getter reads its requested
# value. Setter diagnostics must still stay out of the getter's captured
# stdout, otherwise callers can mistake the warning for configuration.
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "currentVersion": "v0.100.0"
}
EOF
set +e
ACCESSOR_VALUE=$(HOME="$HOME_DIR" PATH="$MISSING_CONDUCT_PATH" \
  bash -c 'source "$1"; value=$(conductor_cfg_get currentVersion ""); status=$?; printf "%s\\n" "$value"; exit "$status"' \
    _ "$HARNESS_DIR/bin/lib/harness-common.sh" 2>"$HOME_DIR/accessor-stderr")
ACCESSOR_CODE=$?
set -e
ACCESSOR_STDERR=$(cat "$HOME_DIR/accessor-stderr")
assert "missing conduct-ts during legacy seed: getter fails with stderr-only setter diagnostic" \
  "$(if [ "$ACCESSOR_CODE" -ne 0 ] && [ -z "$ACCESSOR_VALUE" ] && [[ "$ACCESSOR_STDERR" = *"conduct-ts is required to save conductor configuration"* ]]; then echo 0; else echo 1; fi)"

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

# Public accessors own the one-time seed.  In particular, an explicit write
# must first migrate legacy values, then win over them for the rest of that
# shell invocation.
REPO=$(make_repo "legacy-json-set-before-get")
HOME_DIR=$(make_isolated_home)
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "currentVersion": "v0.100.0"
}
EOF
run_conductor_cfg_set_then_get "$REPO" "$HOME_DIR"
assert "setter-first access seeds legacy JSON before preserving the explicit write" \
  "$( [ "$ACCESSOR_CODE" -eq 0 ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.101.0" ] && [ -f "$HOME_DIR/.claude/ai-conductor.config.json.migrated" ] && echo 0 || echo 1 )"

# A single shell can invoke both accessors repeatedly.  The one-time guard is
# at that shared boundary, not a convention each caller must remember.
HOME_DIR=$(make_isolated_home)
SEED_COUNT_FILE="$HOME_DIR/seed-calls"
: > "$SEED_COUNT_FILE"
mkdir -p "$HOME_DIR/.claude"
cat > "$HOME_DIR/.claude/ai-conductor.config.json" <<'EOF'
{
  "currentVersion": "v0.100.0"
}
EOF
run_conductor_cfg_seed_sequence "$HOME_DIR" "$SEED_COUNT_FILE"
assert "accessors parse legacy JSON at most once per shell" \
  "$( [ "$ACCESSOR_CODE" -eq 0 ] && [ "$(wc -l < "$SEED_COUNT_FILE" 2>/dev/null || true)" -eq 1 ] && echo 0 || echo 1 )"

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

run_update "$REPO" "$HOME_DIR" --set-channel stable
assert "--set-channel stable exits 0 and persists updateChannel=stable" \
  "$([ "$CODE" -eq 0 ] && [ "$(cfg_get "$HOME_DIR" updateChannel)" = "stable" ] && echo 0 || echo 1)"

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

# An exact checkout must be resolved by the shared resolver, rather than the
# old exact-match `git describe` branch. Make that legacy probe unavailable
# while leaving the resolver's `git tag --merged` and `git rev-list` calls
# intact; a stale forward-looking cache must not affect the result.
REPO=$(make_repo "i17-resolver-exact-tag")
OLD_RELEASE_SHA=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" checkout -q "$OLD_RELEASE_SHA"
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.4.0
GIT_DESCRIBE_BLOCKER="$TMP_ROOT/git-describe-blocker"
mkdir -p "$GIT_DESCRIBE_BLOCKER"
cat > "$GIT_DESCRIBE_BLOCKER/git" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "-C" ]; then
  shift 2
fi
if [ "$1" = "describe" ]; then
  exit 1
fi
exec "$REAL_GIT" "$@"
EOF
chmod +x "$GIT_DESCRIBE_BLOCKER/git"
REAL_GIT="$(command -v git)"
set +e
OUT=$(cd "$REPO" && HOME="$HOME_DIR" REAL_GIT="$REAL_GIT" PATH="$GIT_DESCRIBE_BLOCKER:$REPO/bin:$TEST_PATH" "$REPO/bin/update" < /dev/null 2>&1)
CODE=$?
set -e
assert "resolver-derived exact tag offers v0.3.0 → v0.4.0 and repairs the cache" \
  "$( [ "$CODE" -eq 0 ] && case "$OUT" in *"v0.3.0 → v0.4.0"*) true;; *) false;; esac && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && echo 0 || echo 1)"

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

# A checkout that has advanced past the newest released tag must report that
# drift, without offering to change the checkout or prompting for consent.
REPO=$(make_repo "i17-post-release-newest")
git -C "$REPO" commit -q --allow-empty -m "v0.4.0"
git -C "$REPO" tag v0.4.0
git -C "$REPO" commit -q --allow-empty -m "post-release one"
git -C "$REPO" commit -q --allow-empty -m "post-release two"
HOME_DIR=$(make_isolated_home)
BEFORE_SHA=$(git -C "$REPO" rev-parse HEAD)

run_update "$REPO" "$HOME_DIR"
assert "post-release newest tag: reports distance and baseline without prompting" \
  "$([ "$CODE" -eq 0 ] && [ -n "$OUT" ] && case "$OUT" in *"2 commits past v0.4.0"*) true;; *) false;; esac && case "$OUT" in *"Update to"*) false;; *) true;; esac && echo 0 || echo 1)"
assert "post-release newest tag: stamps lastCheckedAt" "$([ -n "$(cfg_get "$HOME_DIR" lastCheckedAt)" ] && echo 0 || echo 1)"
assert "post-release newest tag: leaves HEAD unchanged" "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$BEFORE_SHA" ] && echo 0 || echo 1)"

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

PAIR=$(make_main_repo "stable-accept")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
git -C "$REPO" checkout -q -b stable
git -C "$REPO" push -q -u origin stable
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
run_update "$REPO" "$HOME_DIR" --set-channel stable

WORK="$TMP_ROOT/stable-accept-push"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.com
git -C "$WORK" config user.name T
git -C "$WORK" checkout -q stable
git -C "$WORK" commit -q --allow-empty -m "v0.4.0"
git -C "$WORK" tag v0.4.0
git -C "$WORK" push -q origin stable v0.4.0
STABLE_RELEASE_SHA=$(git -C "$WORK" rev-parse HEAD)

run_update_tty "$REPO" "$HOME_DIR" y
assert "stable accept: remains on stable, fast-forwards to the tagged release, migrates, and records its version" \
  "$( [ "$CODE" -eq 0 ] && [ "$(git -C "$REPO" branch --show-current)" = "stable" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$STABLE_RELEASE_SHA" ] && [ "$(git -C "$REPO" rev-parse origin/stable)" = "$STABLE_RELEASE_SHA" ] && [ -f "$REPO/.migrate-calls" ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.4.0" ] && echo 0 || echo 1)"

PAIR=$(make_main_repo "stable-atomic-target")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
git -C "$REPO" checkout -q -b stable
git -C "$REPO" push -q -u origin stable
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
run_update "$REPO" "$HOME_DIR" --set-channel stable
STABLE_ORIGINAL_SHA=$(git -C "$REPO" rev-parse HEAD)

WORK="$TMP_ROOT/stable-atomic-target-push"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.com
git -C "$WORK" config user.name T
git -C "$WORK" checkout -q stable
git -C "$WORK" commit -q --allow-empty -m "v0.4.0"
git -C "$WORK" tag v0.4.0
git -C "$WORK" push -q origin stable v0.4.0
STABLE_APPROVED_SHA=$(git -C "$WORK" rev-parse HEAD)
git -C "$WORK" commit -q --allow-empty -m "later untagged stable advance"
STABLE_LATER_SHA=$(git -C "$WORK" rev-parse HEAD)

RACE_GIT_DIR="$TMP_ROOT/stable-atomic-git-wrapper"
RACE_MARKER="$TMP_ROOT/stable-atomic-race-fired"
REAL_GIT_BIN=$(command -v git)
mkdir -p "$RACE_GIT_DIR"
cat > "$RACE_GIT_DIR/git" <<EOF
#!/usr/bin/env bash
set -euo pipefail
case " \$* " in
  *" merge "*|*" pull "*)
    if [ ! -f "\$RACE_MARKER" ]; then
      : > "\$RACE_MARKER"
      "$REAL_GIT_BIN" -C "\$RACE_WORK" push -q origin stable
      "$REAL_GIT_BIN" fetch -q origin stable
    fi
    ;;
esac
exec "$REAL_GIT_BIN" "\$@"
EOF
chmod +x "$RACE_GIT_DIR/git"
export RACE_WORK="$WORK" RACE_MARKER
TEST_PATH_BEFORE_RACE=$TEST_PATH
TEST_PATH="$RACE_GIT_DIR:$TEST_PATH"
run_update_tty "$REPO" "$HOME_DIR" y
TEST_PATH=$TEST_PATH_BEFORE_RACE
unset RACE_WORK RACE_MARKER
assert "stable atomic target: ignores a later untagged remote advance after approving the tagged SHA" \
  "$( [ "$CODE" -eq 0 ] && [ -f "$TMP_ROOT/stable-atomic-race-fired" ] && [ "$(git -C "$REPO" branch --show-current)" = "stable" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$STABLE_APPROVED_SHA" ] && [ "$(git -C "$REPO" rev-parse HEAD)" != "$STABLE_ORIGINAL_SHA" ] && [ "$(git -C "$REPO" rev-parse HEAD)" != "$STABLE_LATER_SHA" ] && [ "$(wc -l < "$REPO/.migrate-calls")" -eq 1 ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.4.0" ] && echo 0 || echo 1)"

PAIR=$(make_main_repo "stable-untagged")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
git -C "$REPO" checkout -q -b stable
git -C "$REPO" push -q -u origin stable
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
run_update "$REPO" "$HOME_DIR" --set-channel stable
STABLE_ORIGINAL_SHA=$(git -C "$REPO" rev-parse HEAD)

WORK="$TMP_ROOT/stable-untagged-push"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.com
git -C "$WORK" config user.name T
git -C "$WORK" checkout -q stable
git -C "$WORK" commit -q --allow-empty -m "untagged stable advance"
git -C "$WORK" push -q origin stable

run_update_tty "$REPO" "$HOME_DIR" y
assert "stable untagged: rejects the advance without moving, migrating, or changing version identity" \
  "$( [ "$CODE" -ne 0 ] && [ "$(git -C "$REPO" branch --show-current)" = "stable" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$STABLE_ORIGINAL_SHA" ] && [ ! -f "$REPO/.migrate-calls" ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && printf '%s\n' "$OUT" | grep -Eqi 'exact[- ]semver' && echo 0 || echo 1)"

PAIR=$(make_main_repo "stable-migrate-failure")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
git -C "$REPO" checkout -q -b stable
git -C "$REPO" push -q -u origin stable
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
run_update "$REPO" "$HOME_DIR" --set-channel stable
cat > "$REPO/bin/migrate" <<EOF
#!/usr/bin/env bash
conduct-ts config set conductor.current_version v0.4.0
echo invoked >> "$REPO/.migrate-calls"
exit 1
EOF
chmod +x "$REPO/bin/migrate"
git -C "$REPO" add bin/migrate
git -C "$REPO" commit -q -m "install failing migrate fixture"
git -C "$REPO" push -q origin stable
STABLE_ORIGINAL_SHA=$(git -C "$REPO" rev-parse HEAD)

WORK="$TMP_ROOT/stable-migrate-failure-push"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.com
git -C "$WORK" config user.name T
git -C "$WORK" checkout -q stable
git -C "$WORK" commit -q --allow-empty -m "v0.4.0"
git -C "$WORK" tag v0.4.0
git -C "$WORK" push -q origin stable v0.4.0

run_update_tty "$REPO" "$HOME_DIR" y
assert "stable migrate failure: restores the stable checkout and original version identity" \
  "$( [ "$CODE" -ne 0 ] && [ "$(git -C "$REPO" branch --show-current)" = "stable" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$STABLE_ORIGINAL_SHA" ] && [ -f "$REPO/.migrate-calls" ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && echo 0 || echo 1)"

PAIR=$(make_main_repo "stable-dirty")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
git -C "$REPO" checkout -q -b stable
git -C "$REPO" push -q -u origin stable
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
run_update "$REPO" "$HOME_DIR" --set-channel stable
STABLE_ORIGINAL_SHA=$(git -C "$REPO" rev-parse HEAD)

WORK="$TMP_ROOT/stable-dirty-push"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.com
git -C "$WORK" config user.name T
git -C "$WORK" checkout -q stable
git -C "$WORK" commit -q --allow-empty -m "v0.4.0"
git -C "$WORK" tag v0.4.0
git -C "$WORK" push -q origin stable v0.4.0
printf 'local dirty change\n' >> "$REPO/CHANGELOG.md"

run_update "$REPO" "$HOME_DIR"
assert "stable dirty: refuses the tagged fast-forward without mutating checkout or version" \
  "$( [ "$CODE" -ne 0 ] && [ "$(git -C "$REPO" branch --show-current)" = "stable" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$STABLE_ORIGINAL_SHA" ] && [ ! -f "$REPO/.migrate-calls" ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && printf '%s\n' "$OUT" | grep -Eqi 'clean|dirty|uncommitted' && echo 0 || echo 1)"

PAIR=$(make_main_repo "stable-diverged")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
git -C "$REPO" checkout -q -b stable
git -C "$REPO" push -q -u origin stable
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0
run_update "$REPO" "$HOME_DIR" --set-channel stable
git -C "$REPO" commit -q --allow-empty -m "local stable divergence"
STABLE_ORIGINAL_SHA=$(git -C "$REPO" rev-parse HEAD)

WORK="$TMP_ROOT/stable-diverged-push"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.com
git -C "$WORK" config user.name T
git -C "$WORK" checkout -q stable
git -C "$WORK" commit -q --allow-empty -m "v0.4.0"
git -C "$WORK" tag v0.4.0
git -C "$WORK" push -q origin stable v0.4.0

run_update "$REPO" "$HOME_DIR"
assert "stable diverged: refuses the remote release without mutating checkout or version" \
  "$( [ "$CODE" -eq 0 ] && [ "$(git -C "$REPO" branch --show-current)" = "stable" ] && [ "$(git -C "$REPO" rev-parse HEAD)" = "$STABLE_ORIGINAL_SHA" ] && [ ! -f "$REPO/.migrate-calls" ] && [ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.3.0" ] && echo 0 || echo 1)"

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
