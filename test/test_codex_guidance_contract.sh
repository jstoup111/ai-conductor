#!/usr/bin/env bash
set -uo pipefail

# RED acceptance coverage for the repository-guidance entry point in the
# bootstrap skill. For an agent-driven initializer, the shipped skill and
# templates are the public executable contract.
# Covers: FR-5, FR-6

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BOOTSTRAP="$HARNESS_DIR/skills/bootstrap/SKILL.md"
AGENTS_TEMPLATE="$HARNESS_DIR/templates/AGENTS.md.template"
CLAUDE_TEMPLATE="$HARNESS_DIR/templates/CLAUDE.md.template"

PASS=0
FAIL=0

check_result() {
  local description=$1
  local status=$2
  if [ "$status" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

contains() {
  local description=$1
  local pattern=$2
  local file=$3
  grep -qiE "$pattern" "$file"
  check_result "$description" $?
}

not_contains() {
  local description=$1
  local pattern=$2
  local file=$3
  if grep -qiE "$pattern" "$file"; then
    check_result "$description" 1
  else
    check_result "$description" 0
  fi
}

# ST-904-5 happy path: a later Codex session follows AGENTS.md to the current
# user skill surface without a plugin or copied project-local catalog.
contains 'AGENTS template points Codex at ~/.agents/skills/HARNESS.md' \
  '~/.agents/skills/HARNESS\.md' "$AGENTS_TEMPLATE"
not_contains 'AGENTS template does not advertise the legacy ~/.codex/skills scope' \
  '~/.codex/skills' "$AGENTS_TEMPLATE"
contains 'AGENTS template keeps harness skills user-scoped rather than copied into the project' \
  'user[^[:space:]]*|user-scoped|do not copy' "$AGENTS_TEMPLATE"

# The real bootstrap instruction must preserve operator content, converge on
# one reference, and fail atomically with a file-named diagnostic.
contains 'bootstrap has an explicit fresh AGENTS.md creation path' \
  'Fresh/no AGENTS\.md' "$BOOTSTRAP"
contains 'bootstrap appends a missing AGENTS.md reference without overwriting content' \
  'Existing AGENTS\.md.*append' "$BOOTSTRAP"
contains 'bootstrap makes repeated AGENTS.md initialization idempotent' \
  'AGENTS\.md.*(exactly once|one reference|idempotent)|reference.*(exactly once|one reference)' "$BOOTSTRAP"
contains 'bootstrap requires atomic AGENTS.md failure with the original left intact' \
  'AGENTS\.md.*(atomic|partial|intact)|atomic.*AGENTS\.md|original content intact' "$BOOTSTRAP"
contains 'bootstrap names AGENTS.md in an actionable failed-update diagnostic' \
  'AGENTS\.md.*(diagnostic|report|error|fail)' "$BOOTSTRAP"
contains 'bootstrap itself references the current Codex discovery scope' \
  '~/.agents/skills' "$BOOTSTRAP"
not_contains 'bootstrap no longer presents ~/.codex/skills as the active Codex scope' \
  'user-scoped at `?~/.codex/skills|Codex.*~/.codex/skills' "$BOOTSTRAP"

# ST-904-6: both host files are independently preserved, yet point to the same
# shared lifecycle contract and reject cross-host invocation contradictions.
contains 'bootstrap independently preserves existing CLAUDE.md content' \
  'Existing CLAUDE\.md.*(preserve|append|Never overwrite)' "$BOOTSTRAP"
contains 'bootstrap independently preserves existing AGENTS.md content' \
  'Existing AGENTS\.md.*(preserve|append|Never overwrite)' "$BOOTSTRAP"
contains 'mixed-provider guidance detects contradictory host invocation syntax or gates' \
  'contradict|other host|host.*syntax|invocation.*(Claude|Codex)' "$BOOTSTRAP"
contains 'Claude template loads the shared HARNESS.md contract' \
  '~/.claude/skills/HARNESS\.md' "$CLAUDE_TEMPLATE"
contains 'Codex template loads that same HARNESS.md contract from its native scope' \
  '~/.agents/skills/HARNESS\.md' "$AGENTS_TEMPLATE"
contains 'Claude and Codex templates identify the shared workflow and lifecycle gates' \
  'shared.*(workflow|lifecycle).*gate|same.*(workflow|lifecycle).*gate' "$CLAUDE_TEMPLATE"
contains 'Codex template keeps Codex invocation syntax native' \
  'Codex.*\$[a-z][a-z-]*' "$AGENTS_TEMPLATE"
contains 'Claude template keeps Claude invocation syntax native' \
  'Claude.*`/[a-z][a-z-]*`' "$CLAUDE_TEMPLATE"
not_contains 'Codex guidance never instructs Codex to invoke Claude slash syntax' \
  'Codex.*`/[a-z][a-z-]*`|invoke.*`/[a-z][a-z-]*`' "$AGENTS_TEMPLATE"

printf '\nCodex guidance acceptance: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
