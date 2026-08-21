#!/usr/bin/env bash
set -euo pipefail

# Validate the exhaustive Claude/Codex implicit-invocation classification for
# both the shipped catalog and this repository's local skill catalog.

POLICY_ROOT=${1:-}

if [ -z "$POLICY_ROOT" ] || [ ! -d "$POLICY_ROOT/skills" ] \
  || [ ! -d "$POLICY_ROOT/.agents/skills" ]; then
  echo "usage: $0 <harness-root>" >&2
  exit 2
fi

EXPECTED_IMPLICIT_REQUIRED=$(printf '%s\n' \
  architecture-diagram architecture-review coherence-check conflict-check debugging explore intake \
  plan prd simplify stories verify-claims | sort)
OBSERVED_IMPLICIT_REQUIRED=""
VIOLATIONS=""

for skill_file in \
  "$POLICY_ROOT"/skills/*/SKILL.md \
  "$POLICY_ROOT"/.agents/skills/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  skill_name=$(basename "$(dirname "$skill_file")")
  frontmatter=$(sed -n '2,/^---$/p' "$skill_file" | head -n -1)
  openai_file="$(dirname "$skill_file")/agents/openai.yaml"

  IFS='|' read -r marker_count marker_required_count claude_disable_count claude_true_count <<<"$(
    awk '
      {
        line=$0
        sub(/(^|[[:space:]])#.*/, "", line)
        sub(/[[:space:]]+$/, "", line)
        if (line ~ /^[[:space:]]*implicit_invocation[[:space:]]*:/) {
          marker_count++
          if (line == "implicit_invocation: required") marker_required_count++
        }
        if (line ~ /^[[:space:]]*disable-model-invocation[[:space:]]*:/) {
          disable_count++
          if (line == "disable-model-invocation: true") true_count++
        }
      }
      END {
        printf "%d|%d|%d|%d", marker_count, marker_required_count, disable_count, true_count
      }
    ' <<<"$frontmatter"
  )"

  codex_policy_count=0
  codex_canonical_policy_count=0
  codex_key_count=0
  codex_false_count=0
  if [ -f "$openai_file" ]; then
    IFS='|' read -r codex_policy_count codex_canonical_policy_count codex_key_count codex_false_count <<<"$(
      awk '
        {
          line=$0
          sub(/(^|[[:space:]])#.*/, "", line)
          sub(/[[:space:]]+$/, "", line)

          if (line ~ /^[[:space:]]*policy[[:space:]]*:/) {
            policy_count++
            in_policy=(line == "policy:")
            if (in_policy) canonical_policy_count++
            next
          }
          if (line ~ /^[^[:space:]]/) in_policy=0

          if (line ~ /^[[:space:]]*allow_implicit_invocation[[:space:]]*:/) {
            key_count++
            if (in_policy && line == "  allow_implicit_invocation: false") false_count++
          }
        }
        END {
          printf "%d|%d|%d|%d", policy_count, canonical_policy_count, key_count, false_count
        }
      ' "$openai_file"
    )"
  fi

  is_shipped_implicit_required=0
  if [[ "$skill_file" == "$POLICY_ROOT"/skills/* ]] \
    && grep -Fxq "$skill_name" <<<"$EXPECTED_IMPLICIT_REQUIRED"; then
    is_shipped_implicit_required=1
  fi

  if [ "$marker_count" -eq 1 ] && [ "$marker_required_count" -eq 1 ] \
    && [[ "$skill_file" == "$POLICY_ROOT"/skills/* ]]; then
    OBSERVED_IMPLICIT_REQUIRED+="${skill_name}"$'\n'
  fi

  if [ "$is_shipped_implicit_required" -eq 1 ]; then
    if [ "$marker_count" -ne 1 ] || [ "$marker_required_count" -ne 1 ]; then
      VIOLATIONS+="${skill_name} — requires exactly one canonical 'implicit_invocation: required' marker (found ${marker_count} declarations, ${marker_required_count} canonical)"$'\n'
    fi
    if [ "$claude_disable_count" -ne 0 ]; then
      VIOLATIONS+="${skill_name} — implicit-required skill must not declare Claude disable-model-invocation (found ${claude_disable_count})"$'\n'
    fi
    if [ "$codex_key_count" -ne 0 ]; then
      VIOLATIONS+="${skill_name} — implicit-required skill must not declare Codex allow_implicit_invocation (found ${codex_key_count})"$'\n'
    fi
  else
    if [ "$marker_count" -ne 0 ]; then
      VIOLATIONS+="${skill_name} — explicit-only skill must not declare implicit_invocation (found ${marker_count})"$'\n'
    fi
    if [ "$claude_disable_count" -ne 1 ] || [ "$claude_true_count" -ne 1 ]; then
      VIOLATIONS+="${skill_name} — requires exactly one canonical Claude 'disable-model-invocation: true' declaration (found ${claude_disable_count} declarations, ${claude_true_count} canonical true)"$'\n'
    fi
    if [ ! -f "$openai_file" ]; then
      VIOLATIONS+="${skill_name} — missing agents/openai.yaml Codex policy"$'\n'
    elif [ "$codex_policy_count" -ne 1 ] || [ "$codex_canonical_policy_count" -ne 1 ] \
      || [ "$codex_key_count" -ne 1 ] || [ "$codex_false_count" -ne 1 ]; then
      VIOLATIONS+="${skill_name} — requires one canonical Codex policy with 'allow_implicit_invocation: false' (policy ${codex_policy_count}/${codex_canonical_policy_count} canonical; key ${codex_key_count}/${codex_false_count} canonical false)"$'\n'
    fi
  fi
done

OBSERVED_IMPLICIT_REQUIRED=$(printf '%s' "$OBSERVED_IMPLICIT_REQUIRED" | sort)
if [ "$OBSERVED_IMPLICIT_REQUIRED" != "$EXPECTED_IMPLICIT_REQUIRED" ]; then
  VIOLATIONS+="implicit-required set drift — expected [$(echo "$EXPECTED_IMPLICIT_REQUIRED" | tr '\n' ' ')] observed [$(echo "$OBSERVED_IMPLICIT_REQUIRED" | tr '\n' ' ')]"$'\n'
fi

if [ -n "$VIOLATIONS" ]; then
  printf '%s' "$VIOLATIONS" >&2
  exit 1
fi
