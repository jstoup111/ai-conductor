#!/usr/bin/env bash
set -euo pipefail

# test_install_node_guard.sh — `bin/install` fails closed when the conduct-ts
# bundle cannot be built.
#
# `bin/install` used to warn and exit 0 when Node was missing or older than the
# >=26 the engine requires: it skipped the npm build, skipped the conduct-ts
# symlink, and still printed "Installation complete." An operator — and the
# daemon's install-freshness gate — read that as a good install with the engine
# entirely absent. Both paths must now record the cause and exit non-zero, with
# the reason restated at the very end where scrollback cannot bury it, while
# skills, permissions and hook wiring still install.
#
# Runs the REAL bin/install with shimmed node/npm on PATH and HOME pointed at a
# temp directory, so the assertions are proven against the actual script and the
# operator's own ~/.claude is never touched. Neither failing case reaches
# `npm ci`, so nothing is built and the checkout is not mutated.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

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

# Case 3 needs a bundle to exist at step 3b so the success path is reachable in
# a checkout that has never run `npm run build` — the npm shim exits 0 without
# emitting one. Stand in a placeholder only when there is none, and remove it
# again on exit. A real bundle is never touched. (Same approach as
# test_install_check_build_auth.sh.)
CONDUCT_TS_DIST="${HARNESS_DIR}/src/conductor/dist/index.js"
PLACEHOLDER_DIST=false

cleanup() {
  if [ "$PLACEHOLDER_DIST" = true ]; then
    rm -f "$CONDUCT_TS_DIST"
    rmdir "$(dirname "$CONDUCT_TS_DIST")" 2>/dev/null || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

STUB_BIN="${TMP_ROOT}/stubbin"
mkdir -p "$STUB_BIN"
cat > "${STUB_BIN}/claude" <<'EOF'
#!/usr/bin/env bash
echo "1.0.0 (Claude Code)"
EOF
chmod +x "${STUB_BIN}/claude"

# Write a node shim reporting $2 from `node --version`, into directory $1.
write_node_shim() {
  local dir=$1 version=$2
  cat > "${dir}/node" <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = "--version" ] && { echo "${version}"; exit 0; }
exit 1
EOF
  chmod +x "${dir}/node"
}

# Write an npm shim into directory $1. It records every invocation in
# \$NPM_SHIM_CALLS and exits with $2 for build subcommands, so a case can assert
# that `npm ci` was never reached.
write_npm_shim() {
  local dir=$1 build_status=$2
  cat > "${dir}/npm" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "\${NPM_SHIM_CALLS:-/dev/null}"
case "\$*" in
  "list -g "*) exit 0 ;;
  *) exit ${build_status} ;;
esac
EOF
  chmod +x "${dir}/npm"
}

# Run the real bin/install against an isolated HOME with only $1 and the stub
# directory on PATH.
#
# --allow-worktree-root is passed deliberately: bin/install refuses to install
# from a `.worktrees/` checkout and exits 1 doing so, which would satisfy the
# exit-code assertions below without ever reaching the conduct-ts guard. The
# flag keeps this test proving the same thing wherever it is run from. HOME is a
# fresh per-case temp directory, so the global bins, skills and settings.json
# written by a real install land there and nowhere else.
run_install() {
  local case_name=$1 extra_path=$2
  local case_home="${TMP_ROOT}/home-${case_name}"
  mkdir -p "$case_home"
  local install_path="${extra_path}:${STUB_BIN}:/usr/bin:/bin"
  HOME="$case_home" PATH="$install_path" \
    NPM_SHIM_CALLS="${TMP_ROOT}/npm-calls-${case_name}" \
    "${HARNESS_DIR}/bin/install" --allow-worktree-root </dev/null 2>&1
}

# ─── Case 1: no node and no npm on PATH → install fails, naming npm ───────────

NO_NODE_BIN="${TMP_ROOT}/no-node-bin"
mkdir -p "$NO_NODE_BIN"

out=$(run_install "no-node" "$NO_NODE_BIN") && rc=0 || rc=$?
[ "$rc" -eq 1 ] && r=0 || r=1
assert "no node/npm: install exits 1 instead of reporting success" "$r"
printf '%s\n' "$out" | grep -q "Installation complete" && r=1 || r=0
assert "no node/npm: never prints 'Installation complete'" "$r"
printf '%s\n' "$out" | grep -q "Installation incomplete — conduct-ts was not installed" && r=0 || r=1
assert "no node/npm: terminal summary names the incomplete install" "$r"
printf '%s\n' "$out" | tail -n 4 | grep -q "npm was not found on PATH" && r=0 || r=1
assert "no node/npm: restates the cause at the end, not only up the scrollback" "$r"
printf '%s\n' "$out" | grep -q "Skills, permissions and hook wiring were installed" && r=0 || r=1
assert "no node/npm: still reports skills, permissions and hooks as installed" "$r"

# ─── Case 2: Node older than 26 → install fails, naming the version found ────

OLD_NODE_BIN="${TMP_ROOT}/old-node-bin"
mkdir -p "$OLD_NODE_BIN"
write_node_shim "$OLD_NODE_BIN" "v20.11.0"
write_npm_shim "$OLD_NODE_BIN" 1

out=$(run_install "old-node" "$OLD_NODE_BIN") && rc=0 || rc=$?
[ "$rc" -eq 1 ] && r=0 || r=1
assert "node v20: install exits 1 instead of reporting success" "$r"
printf '%s\n' "$out" | grep -q "Installation complete" && r=1 || r=0
assert "node v20: never prints 'Installation complete'" "$r"
printf '%s\n' "$out" | tail -n 4 | grep -q "requires Node >=26 but found v20.11.0" && r=0 || r=1
assert "node v20: terminal summary names the Node actually found" "$r"
grep -q '^ci$' "${TMP_ROOT}/npm-calls-old-node" && r=1 || r=0
assert "node v20: the version guard trips before 'npm ci' is attempted" "$r"

# ─── Case 3: Node >=26 with a bundle present → install still succeeds ────────
#
# Negative control: without it, the exit codes above could come from any
# unrelated failure in this environment rather than from the Node guard.

if [ ! -f "$CONDUCT_TS_DIST" ]; then
  PLACEHOLDER_DIST=true
  mkdir -p "$(dirname "$CONDUCT_TS_DIST")"
  printf '// placeholder written by test_install_node_guard.sh\n' > "$CONDUCT_TS_DIST"
fi

GOOD_NODE_BIN="${TMP_ROOT}/good-node-bin"
mkdir -p "$GOOD_NODE_BIN"
write_node_shim "$GOOD_NODE_BIN" "v26.7.0"
write_npm_shim "$GOOD_NODE_BIN" 0

out=$(run_install "good-node" "$GOOD_NODE_BIN") && rc=0 || rc=$?
[ "$rc" -eq 0 ] && r=0 || r=1
assert "node v26 with a bundle: install exits 0" "$r"
printf '%s\n' "$out" | grep -q "Installation complete" && r=0 || r=1
assert "node v26 with a bundle: reports the install as complete" "$r"
printf '%s\n' "$out" | grep -q "Installation incomplete" && r=1 || r=0
assert "node v26 with a bundle: the guard does not fire spuriously" "$r"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "----------------------------------------"
echo "Total: ${TOTAL}  Pass: ${PASS}  Fail: ${FAIL}"

if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
