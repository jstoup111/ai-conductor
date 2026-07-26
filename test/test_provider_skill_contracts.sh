#!/usr/bin/env bash
set -uo pipefail

# RED acceptance coverage for the shared skill catalog as loaded directly by
# Claude or Codex. This audits the canonical shipped sources, not a generated
# provider-specific copy.
# Covers: FR-7, FR-8, FR-11, FR-12, FR-13

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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

require_pattern() {
  local description=$1
  local pattern=$2
  local file=$3
  if grep -qiE "$pattern" "$file"; then
    pass "$description"
  else
    fail "$description"
  fi
}

# The shared contract gives direct users semantic references, then maps only
# the host-native invocation mechanics. Outcomes and gates remain common.
require_pattern 'HARNESS defines provider-neutral or semantic skill references' \
  'semantic (skill )?reference|provider-neutral.*skill|skill reference.*provider-neutral' \
  "$HARNESS_DIR/HARNESS.md"
require_pattern 'HARNESS maps explicit skill invocation to Claude slash syntax' \
  'Claude.{0,100}`?/skill-name|`?/skill-name`?.{0,100}Claude' \
  "$HARNESS_DIR/HARNESS.md"
require_pattern 'HARNESS maps explicit skill invocation to Codex dollar syntax' \
  'Codex.{0,100}\$skill-name|\$skill-name.{0,100}Codex' \
  "$HARNESS_DIR/HARNESS.md"
require_pattern 'HARNESS states that host wording cannot weaken shared artifacts or gates' \
  'shared.*(outcome|artifact|gate).*(preserv|required|same)|do not.*(weaken|bypass).*(artifact|gate)' \
  "$HARNESS_DIR/HARNESS.md"

# A genuinely unsupported capability must fail closed with all three pieces of
# an actionable diagnostic, while a supported host-native alternative proceeds.
require_pattern 'unsupported-capability handling stops before incompatible work' \
  'unsupported capability|capability.*unavailable' "$HARNESS_DIR/HARNESS.md"
require_pattern 'unsupported-capability diagnostic names the selected provider' \
  '(unsupported|unavailable).*(selected )?provider|provider.*(unsupported|unavailable)' \
  "$HARNESS_DIR/HARNESS.md"
require_pattern 'unsupported-capability diagnostic names a recovery action' \
  '(unsupported|unavailable).*(recovery|continue|operator action)|recovery action' \
  "$HARNESS_DIR/HARNESS.md"
require_pattern 'supported host-native alternatives are not falsely classified unsupported' \
  'supported.*(host-native|provider-native|alternative|different)|valid.*path.*provider' \
  "$HARNESS_DIR/HARNESS.md"

# Direct use must retain the same canonical skill frontmatter and lifecycle
# gate language. Existing integrity coverage owns exhaustive reference/model
# validation; these assertions pin the observable direct-use contract.
if [ "$(find "$HARNESS_DIR/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')" -gt 0 ] \
  && ! find "$HARNESS_DIR/skills" -mindepth 2 -maxdepth 2 -name SKILL.md \
    -exec grep -L '^enforcement:' {} + | grep -q .; then
  pass 'every directly loadable canonical skill retains its enforcement contract'
else
  fail 'every directly loadable canonical skill retains its enforcement contract'
fi

require_pattern 'pipeline retains RED/DOMAIN/GREEN workflow gates' \
  'RED.*DOMAIN.*GREEN|RED[^[:alnum:]]+DOMAIN[^[:alnum:]]+GREEN' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'code review retains fresh-context evaluator review' \
  'fresh context' "$HARNESS_DIR/skills/code-review/SKILL.md"
require_pattern 'finish retains fresh verification before completion' \
  'fresh.*(verification|evidence)|verify.*fresh' "$HARNESS_DIR/skills/finish/SKILL.md"

printf '\nProvider skill contract acceptance: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
