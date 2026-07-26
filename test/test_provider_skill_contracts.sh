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

# Assessment and review delegation has to remain usable by either built-in
# host. The shared rule selects the host's subagent facility; the existing
# Claude Agent-tool and model details stay explicitly Claude-scoped.
for review_skill in assess architecture-review code-review; do
  review_skill_file="$HARNESS_DIR/skills/${review_skill}/SKILL.md"
  require_pattern "${review_skill} delegates through the selected host facility" \
    'selected host.{0,80}(available )?subagent facility|selected provider.{0,80}(available )?subagent facility' \
    "$review_skill_file"
  require_pattern "${review_skill} scopes Claude Agent-tool mechanics" \
    'Claude.{0,100}Agent tool|Agent tool.{0,100}Claude' \
    "$review_skill_file"
done

if ! grep -qiE '(^|[^[:alnum:]])(use|via|using|dispatch.{0,40}via) the Agent tool' \
  "$HARNESS_DIR/skills/assess/SKILL.md" \
  "$HARNESS_DIR/skills/architecture-review/SKILL.md" \
  "$HARNESS_DIR/skills/code-review/SKILL.md"; then
  pass 'review and assessment skills contain no unscoped Agent-tool imperative'
else
  fail 'review and assessment skills contain no unscoped Agent-tool imperative'
fi

require_pattern 'assess scopes its specialist model table to Claude' \
  'Claude.{0,120}(model|Agent tool)|(model|Agent tool).{0,120}Claude' \
  "$HARNESS_DIR/skills/assess/SKILL.md"
require_pattern 'code review scopes evaluator model selection to Claude' \
  'Claude.{0,120}(model|Agent tool)|(model|Agent tool).{0,120}Claude' \
  "$HARNESS_DIR/skills/code-review/SKILL.md"
require_pattern 'architecture review preserves its two-agent medium-tier limit' \
  'Max 2 agents|maximum of 2 agents' "$HARNESS_DIR/skills/architecture-review/SKILL.md"
require_pattern 'assess retains specialist-report output contract' \
  'Write your findings to \.pipeline/assessment/' "$HARNESS_DIR/skills/assess/SKILL.md"
require_pattern 'code review retains fresh-context evaluator review' \
  'fresh context' "$HARNESS_DIR/skills/code-review/SKILL.md"
require_pattern 'code review retains blocking verdict gate' \
  'BLOCK verdict prevents merge' "$HARNESS_DIR/skills/code-review/SKILL.md"

printf '\nProvider skill contract acceptance: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
