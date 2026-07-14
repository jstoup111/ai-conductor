#!/usr/bin/env bash
set -euo pipefail

# test_bin_update.sh — Real-binary acceptance tests for `bin/update`, the
# standalone self-update/channel CLI that replaces the update block ported
# out of `bin/conduct` (327-470). See .docs/stories/port-self-update-flow.md
# for the acceptance criteria this file encodes (Stories 1-9).
#
# Runs the ACTUAL bin/update (no mocks of the script under test) against a
# throwaway git repo standing in for the harness checkout, with HOME pointed
# at a disposable dir so the real ~/.claude/ai-conductor.config.json is never
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
# ~/.claude/ai-conductor.config.json.
make_isolated_home() {
  local home="$TMP_ROOT/home-$$-${RANDOM}"
  mkdir -p "$home"
  echo "$home"
}

# set_current_version <home> <version>
set_current_version() {
  local home=$1 version=$2
  mkdir -p "$home/.claude"
  python3 -c "
import json
from pathlib import Path
p = Path('$home/.claude/ai-conductor.config.json')
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg['currentVersion'] = '$version'
p.write_text(json.dumps(cfg))
"
}

cfg_get() {
  local home=$1 field=$2
  python3 -c "
import json
from pathlib import Path
p = Path('$home/.claude/ai-conductor.config.json')
cfg = json.loads(p.read_text()) if p.exists() else {}
print(cfg.get('$field', ''))
"
}

# run_update <repo> <home> [args...] — no TTY on stdin.
run_update() {
  local repo=$1 home=$2
  shift 2
  set +e
  OUT=$(cd "$repo" && HOME="$home" PATH="$TEST_PATH" "$repo/bin/update" "$@" < /dev/null 2>&1)
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
  OUT=$(cd "$repo" && printf '%s\n' "$answer" | HOME="$home" PATH="$TEST_PATH" script -qec "$repo/bin/update $*" "$log" 2>&1)
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
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
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
mkdir -p "$HOME_DIR/.claude"
python3 -c "
import json
from pathlib import Path
p = Path('$HOME_DIR/.claude/ai-conductor.config.json')
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg['autoCheck'] = False
cfg['currentVersion'] = 'v0.3.0'
p.write_text(json.dumps(cfg))
"

run_update "$REPO" "$HOME_DIR" --auto
assert "--auto with autoCheck=false: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "--auto with autoCheck=false: silent no-op (no lastCheckedAt)" "$([ -z "$(cfg_get "$HOME_DIR" lastCheckedAt)" ] && echo 0 || echo 1)"

REPO=$(make_repo "s7-auto-enabled")
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.4.0
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true

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
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
HOME_DIR=$(make_isolated_home)
# currentVersion intentionally unset.

run_update "$REPO" "$HOME_DIR"
assert "seeds currentVersion silently" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.4.0" ] && echo 0 || echo 1)"
assert "no update prompt on first-run seed" "$(case "$OUT" in *"Update to"*) echo 1;; *) echo 0;; esac)"

# ─── Story 5: no-TTY guidance ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}Story 5 — no-TTY guidance${NC}"

REPO=$(make_repo "s5")
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
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
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" v0.3.0

run_update_tty "$REPO" "$HOME_DIR" y
assert "accept: exits 0" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "accept: renders changelog range" "$(case "$OUT" in *"Feature D"*) echo 0;; *) echo 1;; esac)"
assert "accept: checks out tags/v0.4.0" "$([ "$(git -C "$REPO" describe --tags 2>/dev/null)" = "v0.4.0" ] && echo 0 || echo 1)"
assert "accept: invokes bin/migrate" "$([ -f "$REPO/.migrate-calls" ] && echo 0 || echo 1)"
assert "accept: advances currentVersion" "$([ "$(cfg_get "$HOME_DIR" currentVersion)" = "v0.4.0" ] && echo 0 || echo 1)"

REPO=$(make_repo "s3-decline")
git -C "$REPO" tag v0.4.0 >/dev/null 2>&1 || true
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
  )
  echo "$clone|$origin"
}

PAIR=$(make_main_repo "s4-accept")
REPO="${PAIR%%|*}"; ORIGIN="${PAIR##*|}"
HOME_DIR=$(make_isolated_home)
set_current_version "$HOME_DIR" main@0000000
run_update "$REPO" "$HOME_DIR" --set-channel main

WORK="$TMP_ROOT/s4-accept-push"
git clone -q "$ORIGIN" "$WORK"
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

# ─── Story 9: documentation reflects bin/update ────────────────────────────

echo ""
echo -e "${BOLD}Story 9 — documentation${NC}"

assert "HARNESS.md mentions bin/update" \
  "$(grep -q "bin/update" "$HARNESS_DIR/HARNESS.md" 2>/dev/null && echo 0 || echo 1)"
assert "README.md mentions bin/update" \
  "$(grep -q "bin/update" "$HARNESS_DIR/README.md" 2>/dev/null && echo 0 || echo 1)"
assert "src/conductor/README.md mentions bin/update" \
  "$(grep -q "bin/update" "$HARNESS_DIR/src/conductor/README.md" 2>/dev/null && echo 0 || echo 1)"
assert "CHANGELOG carries a Migration block for the flag rename" \
  "$(awk '/^## \[Unreleased\]/{f=1} f&&/^## Migration/{print;exit}' "$HARNESS_DIR/CHANGELOG.md" | grep -q "Migration" && echo 0 || echo 1)"

echo ""
echo -e "${BOLD}Summary: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
