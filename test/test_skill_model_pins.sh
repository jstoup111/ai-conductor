#!/usr/bin/env bash
# Covers: task:3
set -uo pipefail

# test_skill_model_pins.sh — Focused fixture spec for
# test/check_skill_model_pins.sh. The checker receives fixture-only JSON and
# skills directories through its public seams.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="${SCRIPT_DIR}/check_skill_model_pins.sh"

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

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/skill-model-pins-XXXXXX")
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

SKILLS_DIR="${WORKDIR}/skills"
mkdir -p "$SKILLS_DIR"

reset_skills() {
  rm -rf "$SKILLS_DIR"
  mkdir -p "$SKILLS_DIR"
}

write_skill() {
  local skill=$1 model=${2:-}
  mkdir -p "${SKILLS_DIR}/${skill}"
  {
    printf '%s\n' '---' "name: ${skill}"
    [ -z "$model" ] || printf 'model: %s\n' "$model"
    printf '%s\n' '---'
  } > "${SKILLS_DIR}/${skill}/SKILL.md"
}

run_checker() {
  HARNESS_INTEGRITY_TEST_PINS_JSON=$1 \
  HARNESS_INTEGRITY_TEST_SKILLS_DIR="$SKILLS_DIR" \
    bash "$CHECKER" 2>&1
}

echo ""
echo "Skill model pins — fixture spec"

reset_skills
write_skill matching opus
OUT=$(run_checker '{"matching":{"expected":"opus"}}')
CODE=$?
assert "matching expected opus pin passes" \
  "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"

reset_skills
write_skill exempt
OUT=$(run_checker '{"exempt":{"exempt":true}}')
CODE=$?
assert "exempt entry with no pin passes" \
  "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"

reset_skills
write_skill neither
OUT=$(run_checker '{}')
CODE=$?
assert "skill with neither an entry nor a pin passes" \
  "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"

reset_skills
write_skill missing-pin
OUT=$(run_checker '{"missing-pin":{"expected":"opus"}}')
CODE=$?
assert "expected opus entry without a model pin fails naming skill and opus" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'missing-pin' && printf '%s\n' "$OUT" | grep -Fq 'opus' && echo 0 || echo 1)"

reset_skills
OUT=$(run_checker '{"missing-skill":{"expected":"opus"}}')
CODE=$?
assert "non-exempt entry with no SKILL.md fails naming skill" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'missing-skill' && echo 0 || echo 1)"

reset_skills
write_skill disagreement sonnet
OUT=$(run_checker '{"disagreement":{"expected":"opus"}}')
CODE=$?
assert "sonnet pin versus opus expected fails as disagreement" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'disagreement' && printf '%s\n' "$OUT" | grep -Fq 'sonnet' && printf '%s\n' "$OUT" | grep -Fq 'opus' && echo 0 || echo 1)"

reset_skills
write_skill unmapped opus
OUT=$(run_checker '{}')
CODE=$?
assert "pin with no expected-model entry fails as unmapped" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'unmapped' && echo 0 || echo 1)"

OUT=$(run_checker '{not json')
CODE=$?
assert "malformed JSON fails" \
  "$( [ "$CODE" -ne 0 ] && printf '%s\n' "$OUT" | grep -Fq 'parseable JSON' && echo 0 || echo 1)"

OUT=$(bash "$CHECKER" 2>&1)
CODE=$?
assert "real tree passes and names the five expected opus skills" \
  "$( [ "$CODE" -eq 0 ] && printf '%s\n' "$OUT" | grep -Fq 'architecture-review' && printf '%s\n' "$OUT" | grep -Fq 'explore' && printf '%s\n' "$OUT" | grep -Fq 'prd' && printf '%s\n' "$OUT" | grep -Fq 'rebase' && printf '%s\n' "$OUT" | grep -Fq 'remediate' && echo 0 || echo 1)"
[ "$CODE" -eq 0 ] || echo "$OUT" | sed 's/^/    /'

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
