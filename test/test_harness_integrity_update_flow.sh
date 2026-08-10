#!/usr/bin/env bash
set -uo pipefail

# test_harness_integrity_update_flow.sh — Focused fixture spec for
# test/check_update_flow_config_ownership.sh.
#
# The ownership check is a guard, so the thing worth proving is that it still
# FAILS on the shapes it exists to catch. Asserting only that the current tree
# passes would keep passing after the guard degraded into a no-op — which is
# exactly how the previous inline version could report success on a scan that
# never ran.
#
# Every case drives the checker through its two environment seams
# (HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR, HARNESS_INTEGRITY_CONDUCTOR_SCHEMA_FILE)
# against a disposable copied tree. The checker is invoked directly, never
# through test_harness_integrity.sh, so the suite can run this spec without
# recursing into itself.
#
# Usage: bash test/test_harness_integrity_update_flow.sh
# Exit:  0 = every case behaved as specified

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="${SCRIPT_DIR}/check_update_flow_config_ownership.sh"
REAL_SCHEMA="${HARNESS_DIR}/src/conductor/src/engine/config.ts"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0

assert() {
  local desc=$1 result=$2
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

if [ ! -f "$CHECKER" ]; then
  echo "Missing checker: $CHECKER"
  exit 1
fi
if [ ! -f "$REAL_SCHEMA" ]; then
  echo "Missing conductor schema: $REAL_SCHEMA"
  exit 1
fi

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/update-flow-ownership-XXXXXX")
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# A disposable copy of the real bin/ tree. Cases mutate their own copy only.
make_bin_fixture() {
  local name=$1
  local dest="${WORKDIR}/${name}"
  mkdir -p "$dest"
  cp -R "${HARNESS_DIR}/bin/." "${dest}/"
  printf '%s' "$dest"
}

run_checker() {
  local bin_dir=$1 schema_file=$2
  HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR="$bin_dir" \
  HARNESS_INTEGRITY_CONDUCTOR_SCHEMA_FILE="$schema_file" \
    bash "$CHECKER" 2>&1
}

echo ""
echo "Update flow config ownership — fixture spec"

# ── Case 1: the current tree passes ─────────────────────────────────────────
# The seams must describe the real tree faithfully; if this case fails, every
# negative case below proves nothing.
CURRENT_BIN=$(make_bin_fixture current)
OUT=$(run_checker "$CURRENT_BIN" "$REAL_SCHEMA")
CODE=$?
assert "current tree passes the ownership check" "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
[ "$CODE" -eq 0 ] || echo "$OUT" | sed 's/^/    /'

# ── Case 2: a legacy config path outside the seed file fails ────────────────
LEGACY_BIN=$(make_bin_fixture legacy-path)
cat > "${LEGACY_BIN}/rogue-update" <<'FIXTURE'
#!/usr/bin/env bash
# Fixture: recreates split ownership by reading the legacy Claude-only config
# directly instead of going through the shared accessors.
legacy="${HOME}/.claude/ai-conductor.config.json"
cat "$legacy"
FIXTURE
OUT=$(run_checker "$LEGACY_BIN" "$REAL_SCHEMA")
CODE=$?
assert "legacy config path outside bin/lib/harness-common.sh fails" "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
assert "legacy config path failure names the offending file:line" \
  "$(case "$OUT" in *"rogue-update:"*) echo 0;; *) echo 1;; esac)"

# ── Case 3: a conductor key the schema does not admit fails ─────────────────
UNKNOWN_KEY_BIN=$(make_bin_fixture unknown-key)
cat > "${UNKNOWN_KEY_BIN}/rogue-key" <<'FIXTURE'
#!/usr/bin/env bash
# Fixture: names a conductor block key that validateConductorBlock rejects.
conduct-ts config read conductor.not_a_schema_key
FIXTURE
OUT=$(run_checker "$UNKNOWN_KEY_BIN" "$REAL_SCHEMA")
CODE=$?
assert "conductor key absent from the schema allowlist fails" "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
assert "unknown conductor key failure names the offending file:line" \
  "$(case "$OUT" in *"rogue-key:"*) echo 0;; *) echo 1;; esac)"

# ── Case 4: an undeterminable allowlist fails closed ────────────────────────
# A validator this guard cannot parse must stop the check, never widen it.
STUB_SCHEMA="${WORKDIR}/config-without-validator.ts"
cat > "$STUB_SCHEMA" <<'FIXTURE'
// Fixture: no validateConductorBlock declaration, so no allowlist is derivable.
export function somethingElse(): void {}
FIXTURE
OUT=$(run_checker "$CURRENT_BIN" "$STUB_SCHEMA")
CODE=$?
assert "undeterminable schema allowlist fails closed" "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
assert "undeterminable allowlist failure names validateConductorBlock" \
  "$(case "$OUT" in *"validateConductorBlock"*) echo 0;; *) echo 1;; esac)"

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
