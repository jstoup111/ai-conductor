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
finish_skill="$HARNESS_DIR/skills/finish/SKILL.md"
worktree_manager="$HARNESS_DIR/agents/worktree-manager.md"
if grep -qiE '(daemon|auto(matic)?).*(PR|pull request).*(retain|keep|leave).*(feature )?worktree' \
    "$finish_skill" \
  && grep -qiE '(only|solely).*engine.*sweep|engine.*sweep.*(only|solely)' \
    "$finish_skill" \
  && grep -qiE 'shipped[- ]record.*(origin/(default|<default>)|origin default|default branch)' \
    "$finish_skill" \
  && ! awk '
    /^\*\*Option 2: Push & PR\*\*/ { in_option_two = 1 }
    /^\*\*Option 3: Keep as-is\*\*/ { in_option_two = 0 }
    in_option_two { print }
  ' "$finish_skill" \
    | grep -qiE 'worktree-manager|worktree[^[:cntrl:]]*(clean[ -]?up|remove|delete|reap)|((clean[ -]?up|remove|delete|reap)[^[:cntrl:]]*worktree)' \
  && grep -qF "After Option 1's local merge completes successfully, delegate cleanup to worktree-manager." \
    "$finish_skill" \
  && grep -qF "After Option 4's discard is explicitly confirmed, delegate cleanup to worktree-manager." \
    "$finish_skill" \
  && grep -qF 'Pass worktree-manager the proof case and evidence for Option 1: completed local merge, shipped record on the local default branch, and recorded `merge-local` outcome.' \
    "$finish_skill" \
  && grep -qF 'Pass worktree-manager the proof case and evidence for Option 4: explicitly confirmed discard and recorded `discard` outcome.' \
    "$finish_skill" \
  && awk '
    function evaluate(instruction, lower, associates_pr, delegation_action, cleanup_action) {
      lower = tolower(instruction)
      associates_pr = lower ~ /(option 2|options? 1[^[:cntrl:]]*(and|&)[^[:cntrl:]]*2|push[[:space:]]*&[[:space:]]*pr|pull request)/
      delegation_action = lower ~ /(delegat|dispatch|invoke|worktree-manager)/
      cleanup_action = lower ~ /(clean[ -]?up|remove|delete|reap)/
      if (associates_pr && delegation_action) violation = 1
      if (associates_pr && cleanup_action) violation = 1
    }
    function flush_bullet() {
      if (bullet != "") evaluate(bullet)
      bullet = ""
    }
    /^### 6\. Worktree Retention Boundary/ {
      in_retention_boundary = 1
      next
    }
    in_retention_boundary && /^## Verification/ {
      flush_bullet()
      in_retention_boundary = 0
    }
    !in_retention_boundary { next }
    /^- / {
      flush_bullet()
      bullet = $0
      next
    }
    bullet != "" && /^  / {
      bullet = bullet " " $0
      next
    }
    {
      flush_bullet()
      if ($0 != "") evaluate($0)
    }
    END {
      flush_bullet()
      exit(violation ? 1 : 0)
    }
  ' "$finish_skill" \
  && grep -qF 'Claude Code only: delegate worktree-manager cleanup through the Agent tool with model="haiku".' \
    "$finish_skill" \
  && grep -qF 'Other supported hosts delegate worktree-manager cleanup through their provider-native subagent facility and configured provider policy.' \
    "$finish_skill" \
  && grep -qF 'MUST refuse cleanup when a PR is open or unmerged unless a discard was explicitly confirmed.' \
    "$worktree_manager" \
  && grep -qF 'Cleanup is authorized only after one of these proofs:' \
    "$worktree_manager" \
  && grep -qF 'Remote-default shipment cleanup is owned only by the engine mergeable sweep; worktree-manager MUST refuse it.' \
    "$worktree_manager" \
  && awk '
    /^Cleanup is authorized only after one of these proofs:/ {
      in_authorized_proofs = 1
      next
    }
    in_authorized_proofs && /^If none is supplied and verified,/ {
      in_authorized_proofs = 0
    }
    in_authorized_proofs && /^[0-9]+\./ { proof_count++ }
    in_authorized_proofs && /a local merge completed successfully/ { local_merge_proof_count++ }
    in_authorized_proofs && /a discard was explicitly confirmed/ { confirmed_discard_proof_count++ }
    in_authorized_proofs && /origin\/<default>/ { remote_default_authorized = 1 }
    END {
      exit(proof_count == 2 \
        && local_merge_proof_count == 1 \
        && confirmed_discard_proof_count == 1 \
        && !remote_default_authorized ? 0 : 1)
    }
  ' "$worktree_manager" \
  && grep -qF 'For an explicitly confirmed discard, delete the unmerged branch with `git branch -D <branch>`; never force-delete a branch for any other proof case.' \
    "$worktree_manager" \
  && awk '
    index($0, "git worktree remove <path>") { worktree_remove_line = NR }
    index($0, "For an explicitly confirmed discard, delete the unmerged branch with `git branch -D <branch>`") {
      discard_branch_delete_line = NR
    }
    END {
      exit(worktree_remove_line > 0 && discard_branch_delete_line > worktree_remove_line ? 0 : 1)
    }
  ' "$worktree_manager" \
  && awk '
    {
      line = tolower($0)
      prohibits_open_pr_cleanup = line ~ /(never|refuse|must not|do not)[^[:cntrl:]]*clean[^[:cntrl:]]*(open|unmerged)[^[:cntrl:]]*pr/ \
        || line ~ /(open|unmerged)[^[:cntrl:]]*pr[^[:cntrl:]]*(never|refuse|must not|do not)[^[:cntrl:]]*clean/
      confirmed_discard_exception = line ~ /(unless|except)[^[:cntrl:]]*(discard[^[:cntrl:]]*explicit[^[:cntrl:]]*confirm|explicit[^[:cntrl:]]*confirm[^[:cntrl:]]*discard)/
      if (prohibits_open_pr_cleanup && !confirmed_discard_exception) violation = 1
    }
    END { exit(violation ? 1 : 0) }
  ' "$worktree_manager"; then
  pass 'finish lifecycle matrix retains PR worktrees and preserves proven interactive cleanup routes'
else
  fail 'finish lifecycle matrix retains PR worktrees and preserves proven interactive cleanup routes'
fi
require_pattern 'finish preserves merge-local completion choice' \
  'Option 1: Merge locally' "$HARNESS_DIR/skills/finish/SKILL.md"
require_pattern 'finish preserves PR completion choice' \
  'Option 2: Push & PR' "$HARNESS_DIR/skills/finish/SKILL.md"
require_pattern 'finish preserves keep completion choice' \
  'Option 3: Keep as-is' "$HARNESS_DIR/skills/finish/SKILL.md"
require_pattern 'finish preserves discard completion choice' \
  'Option 4: Discard' "$HARNESS_DIR/skills/finish/SKILL.md"
require_pattern 'retro uses provider-neutral subagent delegation language' \
  '(selected host|selected provider).{0,100}(subagent|delegat)|(subagent|delegat).{0,100}(selected host|selected provider)' \
  "$HARNESS_DIR/skills/retro/SKILL.md"
require_pattern 'retro scopes Claude model examples to Claude' \
  'Claude.{0,100}(Opus|Sonnet)|(Opus|Sonnet).{0,100}Claude' \
  "$HARNESS_DIR/skills/retro/SKILL.md"
require_pattern 'retro preserves memory follow-up' \
  'Persist learnings to `?\.memory/' \
  "$HARNESS_DIR/skills/retro/SKILL.md"

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
require_pattern 'as-built architecture review independently verifies the root-to-caller-to-export chain' \
  'independently verif.{0,160}root-to-caller-to-export|root-to-caller-to-export.{0,160}independently verif' \
  "$HARNESS_DIR/skills/architecture-review/SKILL.md"
require_pattern 'as-built architecture review permits same-file composition only with exact caller and root evidence' \
  'same-file.{0,220}(exact caller-to-export|caller-to-export.{0,120}exact).{0,220}(production-entry-point|production root|root chain)' \
  "$HARNESS_DIR/skills/architecture-review/SKILL.md"
require_pattern 'as-built architecture review rejects own-module-only claims' \
  'own-module.{0,120}(alone|only).{0,120}(does not count|insufficient|reject)' \
  "$HARNESS_DIR/skills/architecture-review/SKILL.md"
require_pattern 'as-built architecture review rejects stale BUILD proof as authority' \
  'stale.{0,100}(BUILD )?proof.{0,160}(does not|never).{0,120}(count|authorit|pass)|persisted BUILD proof.{0,160}(corroborat|not authorit)' \
  "$HARNESS_DIR/skills/architecture-review/SKILL.md"
require_pattern 'assess retains specialist-report output contract' \
  'Write your findings to \.pipeline/assessment/' "$HARNESS_DIR/skills/assess/SKILL.md"
require_pattern 'code review retains fresh-context evaluator review' \
  'fresh context' "$HARNESS_DIR/skills/code-review/SKILL.md"
require_pattern 'code review retains blocking verdict gate' \
  'BLOCK verdict prevents merge' "$HARNESS_DIR/skills/code-review/SKILL.md"

# Build-cycle delegation is provider-neutral. Claude Code's Agent tool, session
# hooks, and model labels remain valid host mechanics, but must not be presented
# as requirements for every supported host.
for build_skill in pipeline tdd; do
  build_skill_file="$HARNESS_DIR/skills/${build_skill}/SKILL.md"
  require_pattern "${build_skill} delegates through the selected host facility" \
    'selected host.{0,80}(available )?subagent facility|selected provider.{0,80}(available )?subagent facility' \
    "$build_skill_file"
  require_pattern "${build_skill} scopes Claude Agent-tool mechanics" \
    'Claude.{0,100}Agent tool|Agent tool.{0,100}Claude' \
    "$build_skill_file"
done

require_pattern 'pipeline scopes session-hook mechanics to Claude Code' \
  'Claude Code.{0,100}(PreToolUse|PostToolUse|session hook)|(PreToolUse|PostToolUse|session hook).{0,100}Claude Code' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline scopes its Claude model selection' \
  'Claude.{0,120}model|model.{0,120}Claude' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline builds a ready frontier for Standard and Full autonomy' \
  '(Standard|Full).{0,120}ready frontier|ready frontier.{0,120}(Standard|Full)' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline uses one host-native fan-out operation for a ready frontier' \
  '(one|single) host-native fan-out operation' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline caps a fan-out at three independent tasks' \
  '(up to|at most|max(imum)?)[[:space:]]+3.{0,80}independent tasks|independent tasks.{0,80}(up to|at most|max(imum)?)[[:space:]]+3' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline gives Claude Code one-response multi-Agent fan-out mechanics' \
  'Claude Code.{0,180}(one|single) response.{0,180}multiple Agent tool dispatches|multiple Agent tool dispatches.{0,180}(one|single) response.{0,180}Claude Code' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline gives Codex one-response collaboration spawn fan-out mechanics' \
  'Codex.{0,180}(one|single) response.{0,180}multiple `?collaboration\.spawn_agent|multiple `?collaboration\.spawn_agent.{0,180}(one|single) response.{0,180}Codex' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline joins every concurrent dispatch before verification' \
  '(wait|join).{0,120}(all|every).{0,120}(dispatch|agent)|(all|every).{0,120}(dispatch|agent).{0,120}(wait|join)' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline fails closed when selected host lacks native fan-out' \
  '(fan-out|concurrent dispatch).{0,180}(unavailable|unsupported).{0,180}(fail closed|stop|halt)|(fail closed|stop|halt).{0,180}(fan-out|concurrent dispatch).{0,180}(unavailable|unsupported)' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline keeps Conservative autonomy sequential' \
  'Conservative.{0,120}sequential|sequential.{0,120}Conservative' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'pipeline defers dependent or overlapping-file tasks to a later frontier' \
  '(dependent|overlapping-file|overlapping file).{0,180}(next|later) frontier|(next|later) frontier.{0,180}(dependent|overlapping-file|overlapping file)' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md"
require_pattern 'TDD scopes its Claude model selection' \
  'Claude.{0,120}model|model.{0,120}Claude' \
  "$HARNESS_DIR/skills/tdd/SKILL.md"

if ! grep -qiE '(^|[^[:alnum:]])(use|via|using|dispatch.{0,40}via) the Agent tool' \
  "$HARNESS_DIR/skills/pipeline/SKILL.md" \
  "$HARNESS_DIR/skills/tdd/SKILL.md"; then
  pass 'pipeline and TDD contain no unscoped Agent-tool imperative'
else
  fail 'pipeline and TDD contain no unscoped Agent-tool imperative'
fi

# These lifecycle skills share outcomes and gates across supported hosts. Only
# installation, invocation, and interactive-session mechanics may differ.
require_pattern 'bootstrap identifies the current Codex skill location' \
  '~/.agents/skills.*(active|current)' \
  "$HARNESS_DIR/skills/bootstrap/SKILL.md"
require_pattern 'bootstrap identifies the legacy Codex skill location' \
  '~/.codex/skills.*legacy|legacy.*~/.codex/skills' \
  "$HARNESS_DIR/skills/bootstrap/SKILL.md"
require_pattern 'conduct describes build orchestration as provider-neutral' \
  'host agent orchestrates|selected provider orchestrates|provider-neutral.*orchestrat' \
  "$HARNESS_DIR/skills/conduct/SKILL.md"
require_pattern 'engineer makes the host-agent session model provider-neutral' \
  'live supported host-agent session|supported host-agent session|host-agent session' \
  "$HARNESS_DIR/skills/engineer/SKILL.md"
require_pattern 'engineer scopes Claude launcher claims to Claude-only behavior' \
  'Claude-only.*(launcher|session)|(launcher|session).*Claude-only' \
  "$HARNESS_DIR/skills/engineer/SKILL.md"
require_pattern 'engineer defers native persistent-session launching to issue 759' \
  '(#759|issue 759).*(defer|deferred)|(defer|deferred).*#759' \
  "$HARNESS_DIR/skills/engineer/SKILL.md"
require_pattern 'engineer scopes /quit to Claude Code sessions' \
  'Claude Code.*`/quit`|`/quit`.*Claude Code' \
  "$HARNESS_DIR/skills/engineer/SKILL.md"
require_pattern 'engineer gives non-Claude hosts a normal session-end path' \
  'other supported host.*(end|close).*session|end.*session.*other supported host' \
  "$HARNESS_DIR/skills/engineer/SKILL.md"

# The positive checks above pin expected language. This small deterministic audit
# rejects the high-risk ways a shared instruction can accidentally become
# Claude-only. Its fixtures keep the rules honest: every category below must
# fail for the named provider-contract boundary, not merely because a word is
# missing elsewhere in the catalog.
provider_contract_audit() {
  local file=$1
  local required_gate=${2:-}
  local violations=''

  # `/skill` is permitted as a semantic reference (the HARNESS legend defines
  # that convention), but an imperative host command must name its host on the
  # same line. This avoids treating phase diagrams and cross-skill references
  # as fabricated invocation mechanics.
  violations+=$(grep -niE '\b(run|invoke|use|start|type)[[:space:]]+`?/[a-z][a-z-]*`?' "$file" \
    | grep -viE 'Claude|MUST NOT|must not|do not' || true)

  # The Claude Agent tool and its `model=` option are host mechanics. A shared
  # instruction must not present either as a requirement for Codex.
  violations+=$(grep -niE 'Agent tool' "$file" | grep -vi 'Claude' || true)
  violations+=$(grep -niE 'model="(sonnet|opus|haiku|fable)"' "$file" | grep -vi 'Claude' || true)

  # Claude-labelled delegation and interactive slash commands need an explicit
  # Claude Code boundary. Native alternatives are covered by the selected-host
  # contract already asserted above.
  violations+=$(grep -niE '\b(delegate|dispatch)[[:space:]]+(the[[:space:]]+)?[^.]{0,30}Claude[[:space:]]+(subagents|agents)' "$file" \
    | grep -viE 'Claude Code|Claude-only|Claude only|selected host' || true)
  violations+=$(grep -niE '(interactive (session|run)|session)[^[:cntrl:]]{0,80}\b(run|invoke|type)[[:space:]]+`?/[a-z][a-z-]*`?' "$file" \
    | grep -vi 'Claude' || true)

  if [ -n "$required_gate" ] && ! grep -qiE "$required_gate" "$file"; then
    violations="required shared gate missing${violations}"
  fi

  [ -z "$violations" ]
}

expect_audit() {
  local description=$1
  local expected=$2
  local file=$3
  local required_gate=${4:-}
  local status

  set +e
  provider_contract_audit "$file" "$required_gate"
  status=$?
  set -e

  if [ "$status" -eq "$expected" ]; then
    pass "$description"
  else
    fail "$description"
  fi
}

contract_fixture="$(mktemp)"
trap 'rm -f "$contract_fixture"' EXIT

printf '%s\n' \
  'Claude Code invokes `conduct` as `/conduct`; Codex invokes it as `$conduct`.' \
  'Claude Code uses the Agent tool with `model="sonnet"`; other hosts use their native delegation facility.' \
  'Claude Code users type `/quit`; other hosts use their normal session control.' \
  'Shared lifecycle gate: required artifact evidence remains mandatory.' \
  > "$contract_fixture"
expect_audit 'provider audit accepts balanced invocation, model, tool, delegation, and interaction scope' 0 "$contract_fixture" 'Shared lifecycle gate'

printf '%s\n' 'Run `/conduct` now.' > "$contract_fixture"
expect_audit 'provider audit rejects unscoped Claude slash invocation' 1 "$contract_fixture"

printf '%s\n' 'Use `model="sonnet"` for the evaluator.' > "$contract_fixture"
expect_audit 'provider audit rejects unscoped Claude model selection' 1 "$contract_fixture"

printf '%s\n' 'Dispatch the Agent tool for this review.' > "$contract_fixture"
expect_audit 'provider audit rejects unscoped Claude tool delegation' 1 "$contract_fixture"

printf '%s\n' 'Delegate the task to Claude subagents.' > "$contract_fixture"
expect_audit 'provider audit rejects unscoped Claude delegation' 1 "$contract_fixture"

printf '%s\n' 'In the interactive session, type `/quit`.' > "$contract_fixture"
expect_audit 'provider audit rejects unscoped interactive Claude command' 1 "$contract_fixture"

printf '%s\n' 'Claude Code invokes `conduct` as `/conduct`; Codex invokes it as `$conduct`.' > "$contract_fixture"
expect_audit 'provider audit rejects a compatibility edit that removes the shared gate' 1 "$contract_fixture" 'Shared lifecycle gate'

for provider_contract_file in \
  "$HARNESS_DIR/HARNESS.md" \
  "$HARNESS_DIR/skills/assess/SKILL.md" \
  "$HARNESS_DIR/skills/architecture-review/SKILL.md" \
  "$HARNESS_DIR/skills/bootstrap/SKILL.md" \
  "$HARNESS_DIR/skills/code-review/SKILL.md" \
  "$HARNESS_DIR/skills/conduct/SKILL.md" \
  "$HARNESS_DIR/skills/engineer/SKILL.md" \
  "$HARNESS_DIR/skills/finish/SKILL.md" \
  "$HARNESS_DIR/skills/pipeline/SKILL.md" \
  "$HARNESS_DIR/skills/retro/SKILL.md" \
  "$HARNESS_DIR/skills/tdd/SKILL.md"; do
  expect_audit "provider audit accepts $(basename "$(dirname "$provider_contract_file")")" 0 "$provider_contract_file"
done

printf '\nProvider skill contract acceptance: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
