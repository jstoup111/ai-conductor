#!/usr/bin/env bash
# Covers: task:1, task:2
set -uo pipefail

# test_model_table_presence.sh — Focused fixture spec for
# test/check_model_table_presence.sh. The checker is invoked directly against
# disposable inputs so this spec can itself be run from the integrity suite
# without recursion.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="${SCRIPT_DIR}/check_model_table_presence.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${description}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${description}"
    FAIL=$((FAIL + 1))
  fi
}

if [ ! -f "$CHECKER" ]; then
  echo "Missing checker: $CHECKER"
  exit 1
fi

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/model-table-presence-XXXXXX")
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

SKILLS_DIR="${WORKDIR}/skills"
ARCHITECTURE_FILE="${WORKDIR}/ARCHITECTURE.md"
mkdir -p "${SKILLS_DIR}/exact-row" "${SKILLS_DIR}/engine-row" "${SKILLS_DIR}/tdd" "${SKILLS_DIR}/engineer"
for skill in exact-row engine-row tdd engineer; do
  printf '%s\n' '---' "name: ${skill}" '---' > "${SKILLS_DIR}/${skill}/SKILL.md"
done

cat > "$ARCHITECTURE_FILE" <<'TABLE'
| Skill | Notes |
| --- | --- |
| exact-row | direct row |
| engine-row (engine gate) | trailing engine annotation |
| tdd-red | red phase |
| tdd-green | green phase |
TABLE

run_fixture_checker() {
  HARNESS_INTEGRITY_SKILLS_DIR="$SKILLS_DIR" \
  HARNESS_INTEGRITY_ARCHITECTURE_FILE="$ARCHITECTURE_FILE" \
    bash "$CHECKER" 2>&1
}

run_fixture_checker_with() {
  HARNESS_INTEGRITY_SKILLS_DIR="$SKILLS_DIR" \
  HARNESS_INTEGRITY_ARCHITECTURE_FILE="$ARCHITECTURE_FILE" \
  HARNESS_INTEGRITY_MODEL_TABLE_ALLOWLIST="$1" \
  HARNESS_INTEGRITY_MODEL_TABLE_ALIASES="$2" \
    bash "$CHECKER" 2>&1
}

echo ""
echo "Model-table presence — fixture spec"

OUT=$(run_fixture_checker)
CODE=$?
assert "exact rows, engine-gate rows, aliases, and an allowlisted skill pass" \
  "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
assert "allowlisted row-less skill is identified as allowlisted" \
  "$(case "$OUT" in *'engineer — allowlisted:'*) echo 0;; *) echo 1;; esac)"
[ "$CODE" -eq 0 ] || echo "$OUT" | sed 's/^/    /'

mkdir -p "${SKILLS_DIR}/row-less"
printf '%s\n' '---' 'name: row-less' '---' > "${SKILLS_DIR}/row-less/SKILL.md"
OUT=$(run_fixture_checker)
CODE=$?
assert "row-less unlisted skill fails and names the skill" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'row-less — not in' && echo 0 || echo 1)"
rm -f "${SKILLS_DIR}/row-less/SKILL.md"
rmdir "${SKILLS_DIR}/row-less"

OUT=$(run_fixture_checker_with $'engineer|' '')
CODE=$?
assert "allowlist entry with an empty reason fails and names the entry" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'engineer' && echo 0 || echo 1)"

OUT=$(run_fixture_checker_with $'ghost|retired skill' '')
CODE=$?
assert "stale allowlist entry fails and reports the missing skill" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'ghost' && echo 0 || echo 1)"

OUT=$(run_fixture_checker_with '' $'tdd|tdd-red,tdd-green|')
CODE=$?
assert "alias entry with an empty reason fails and names the alias" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'tdd' && echo 0 || echo 1)"

sed -i '/| tdd-red |/d; /| tdd-green |/d' "$ARCHITECTURE_FILE"
printf '%s\n' '| tdd-review | review phase |' >> "$ARCHITECTURE_FILE"
OUT=$(run_fixture_checker_with '' $'tdd|tdd-red,tdd-green|phases')
CODE=$?
assert "prefix-only tdd-review row does not resolve tdd aliases" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'tdd — not in' && echo 0 || echo 1)"

OUT=$(bash "$CHECKER" 2>&1)
CODE=$?
assert "real tree passes without WARN output" \
  "$([ "$CODE" -eq 0 ] && ! printf '%s\n' "$OUT" | grep -Fq WARN && echo 0 || echo 1)"
[ "$CODE" -eq 0 ] || echo "$OUT" | sed 's/^/    /'

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
