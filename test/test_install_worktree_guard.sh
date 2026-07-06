#!/usr/bin/env bash
set -euo pipefail

# test_install_worktree_guard.sh — Real-binary smoke test for the bin/install
# worktree-root guard (issue #363).
#
# Usage: ./test/test_install_worktree_guard.sh
#
# Copies the harness into a <tmp>/.worktrees/x path and runs the ACTUAL
# bin/install (no mocks, no injected runner) with HOME pointed at a throwaway
# dir. Asserts: global-mutating modes refuse with a non-zero exit naming the
# resolved root, the throwaway HOME is byte-for-byte unchanged on refusal,
# --allow-worktree-root proceeds, read-only modes are guard-free, and the flag
# is inert on a non-worktree root. Injected-runner tests alone are a known
# false-green trap for this class of bug — this script exists so the guard is
# proven against the real script.
#
# Never touches the real ~/.claude or ~/.ai-conductor: every install runs with
# HOME set to a throwaway dir inside the test tmp root.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2  # 0 = pass, non-zero = fail
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

# ─── Fixtures ─────────────────────────────────────────────────────────────────

# Copy the minimal harness surface bin/install needs (skills enumeration, the
# conduct symlink source, hook configuration). src/conductor is deliberately
# omitted so build_conduct_ts skips (no npm install in a smoke test); the guard
# keys on the path alone, so a plain copy at a .worktrees/-shaped path suffices.
make_harness_copy() {
  local dest=$1
  mkdir -p "$dest"
  cp -r "$HARNESS_DIR/bin" "$dest/bin"
  cp -r "$HARNESS_DIR/skills" "$dest/skills"
  cp -r "$HARNESS_DIR/hooks" "$dest/hooks"
  cp "$HARNESS_DIR/VERSION" "$dest/VERSION"
}

# Stub out external tools the default-install dependency bootstrap probes for
# (rtk/npm/node/claude/uv). Keeps default-mode runs fast and hermetic: no
# network installs, no real npm -g queries. python3/git/coreutils stay real.
STUBS_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUBS_DIR"
for tool in rtk npm node claude uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS_DIR/$tool"
  chmod +x "$STUBS_DIR/$tool"
done

# python3 must stay REAL (settings.json/config writers) — but a version-manager
# shim (asdf/mise) resolves via $HOME, which the throwaway HOME breaks. Pin the
# concrete interpreter path, resolved now under the real HOME.
PY3="$(python3 -c 'import sys; print(sys.executable)')"
ln -s "$PY3" "$STUBS_DIR/python3"

# Order-independent, content-sensitive snapshot of a directory tree.
snapshot() {
  local dir=$1
  (
    cd "$dir"
    find . -print | LC_ALL=C sort
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r md5sum
  )
}

# Run an install invocation hermetically: throwaway HOME, stubbed tool PATH,
# closed stdin. Captures combined output to $OUT and exit code to $CODE.
OUT=""
CODE=0
run_install() {
  local installer=$1 home=$2
  shift 2
  set +e
  OUT=$(HOME="$home" PATH="$STUBS_DIR:$PATH" "$installer" "$@" < /dev/null 2>&1)
  CODE=$?
  set -e
}

MAIN_COPY="$TMP_ROOT/repo"
WORKTREE_COPY="$MAIN_COPY/.worktrees/x"
make_harness_copy "$WORKTREE_COPY"
WORKTREE_PHYSICAL="$(cd "$WORKTREE_COPY" && pwd -P)"

# ─── Refusal: default mode ─────────────────────────────────────────────────────

echo -e "${BOLD}Refusal — default mode from a worktree root${NC}"

HOME1="$TMP_ROOT/home1"
mkdir -p "$HOME1"
BEFORE=$(snapshot "$HOME1")
run_install "$WORKTREE_COPY/bin/install" "$HOME1"
AFTER=$(snapshot "$HOME1")

assert "default install from a worktree root exits non-zero" \
  "$([ "$CODE" -ne 0 ]; echo $?)"
assert "refusal message names the resolved physical root" \
  "$(echo "$OUT" | grep -qF "$WORKTREE_PHYSICAL"; echo $?)"
assert "refusal message names the remedy (--allow-worktree-root)" \
  "$(echo "$OUT" | grep -qF -- "--allow-worktree-root"; echo $?)"
assert "throwaway HOME is byte-for-byte unchanged after refusal" \
  "$([ "$BEFORE" = "$AFTER" ]; echo $?)"

# ─── Refusal: --update mode ────────────────────────────────────────────────────

echo -e "${BOLD}Refusal — --update mode from a worktree root${NC}"

HOME2="$TMP_ROOT/home2"
mkdir -p "$HOME2"
BEFORE=$(snapshot "$HOME2")
run_install "$WORKTREE_COPY/bin/install" "$HOME2" --update
AFTER=$(snapshot "$HOME2")

assert "--update from a worktree root exits non-zero" \
  "$([ "$CODE" -ne 0 ]; echo $?)"
assert "--update refusal names the resolved root" \
  "$(echo "$OUT" | grep -qF "$WORKTREE_PHYSICAL"; echo $?)"
assert "throwaway HOME unchanged after --update refusal" \
  "$([ "$BEFORE" = "$AFTER" ]; echo $?)"

# ─── Refusal: symlinked logical path (physical resolution) ─────────────────────

echo -e "${BOLD}Refusal — symlinked path hiding .worktrees${NC}"

ln -s "$WORKTREE_COPY" "$TMP_ROOT/innocent-looking-checkout"
HOME3="$TMP_ROOT/home3"
mkdir -p "$HOME3"
run_install "$TMP_ROOT/innocent-looking-checkout/bin/install" "$HOME3"

assert "guard fires through a symlink that hides .worktrees (pwd -P)" \
  "$([ "$CODE" -ne 0 ]; echo $?)"
assert "symlink-case refusal names the physical root" \
  "$(echo "$OUT" | grep -qF "$WORKTREE_PHYSICAL"; echo $?)"

# ─── Override: --allow-worktree-root proceeds ──────────────────────────────────

echo -e "${BOLD}Override — --allow-worktree-root proceeds${NC}"

HOME4="$TMP_ROOT/home4"
mkdir -p "$HOME4"
run_install "$WORKTREE_COPY/bin/install" "$HOME4" --update --allow-worktree-root

assert "--update --allow-worktree-root exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "override run links skills into the throwaway HOME" \
  "$([ -L "$HOME4/.claude/skills/tdd" ]; echo $?)"
assert "override run links conduct into the throwaway HOME" \
  "$([ -L "$HOME4/.local/bin/conduct" ]; echo $?)"
assert "override run writes settings.json in the throwaway HOME" \
  "$([ -f "$HOME4/.claude/settings.json" ]; echo $?)"

# ─── Read-only modes are guard-free ────────────────────────────────────────────

echo -e "${BOLD}Read-only modes — guard never fires${NC}"

HOME5="$TMP_ROOT/home5"
mkdir -p "$HOME5"
run_install "$WORKTREE_COPY/bin/install" "$HOME5" --check
assert "--check from a worktree root does not refuse (normal check semantics)" \
  "$(echo "$OUT" | grep -q "Refusing to install"; [ $? -ne 0 ]; echo $?)"
assert "--check still produces its status report" \
  "$(echo "$OUT" | grep -q "Harness Installation Status"; echo $?)"

run_install "$WORKTREE_COPY/bin/install" "$HOME5" --help
assert "--help from a worktree root exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "--help documents --allow-worktree-root" \
  "$(echo "$OUT" | grep -qF -- "--allow-worktree-root"; echo $?)"
assert "--help does not trip the guard" \
  "$(echo "$OUT" | grep -q "Refusing to install"; [ $? -ne 0 ]; echo $?)"

# ─── Inert flag on a non-worktree root ─────────────────────────────────────────

echo -e "${BOLD}Inert flag — non-worktree root accepts --allow-worktree-root${NC}"

PLAIN_COPY="$TMP_ROOT/plain-checkout"
make_harness_copy "$PLAIN_COPY"
HOME6="$TMP_ROOT/home6"
mkdir -p "$HOME6"
run_install "$PLAIN_COPY/bin/install" "$HOME6" --allow-worktree-root

assert "default install with the flag on a main-style root exits zero" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "no refusal message on a non-worktree root" \
  "$(echo "$OUT" | grep -q "Refusing to install"; [ $? -ne 0 ]; echo $?)"
assert "install proceeded normally (skills linked)" \
  "$([ -L "$HOME6/.claude/skills/tdd" ]; echo $?)"

# ─── Sanity: default install on a main-style root without the flag ─────────────

echo -e "${BOLD}No behavior change — main-style root without the flag${NC}"

HOME7="$TMP_ROOT/home7"
mkdir -p "$HOME7"
run_install "$PLAIN_COPY/bin/install" "$HOME7"

assert "default install on a non-worktree root still works (guard inert)" \
  "$([ "$CODE" -eq 0 ]; echo $?)"
assert "skills linked on the plain-root install" \
  "$([ -L "$HOME7/.claude/skills/tdd" ]; echo $?)"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Results: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${FAIL} assertion(s) failed.${NC}"
  exit 1
fi
echo -e "${GREEN}All install worktree-guard smoke tests passed.${NC}"
exit 0
