#!/usr/bin/env bash
set -euo pipefail

# Mutation tests for check_skill_invocation_policy.sh. These fixtures prove the
# checker fails closed without recursively invoking the aggregate harness suite.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HARNESS_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
CHECKER="$SCRIPT_DIR/check_skill_invocation_policy.sh"
FIXTURE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/skill-invocation-policy.XXXXXX")

rewrite_with_sed() {
  local target=$1
  shift
  local temp
  temp=$(mktemp "${target}.XXXXXX")
  if cp -p "$target" "$temp" && sed "$@" "$target" > "$temp"; then
    mv "$temp" "$target"
  else
    rm -f "$temp"
    return 1
  fi
}

rewrite_with_awk() {
  local target=$1
  local program=$2
  local temp
  temp=$(mktemp "${target}.XXXXXX")
  if cp -p "$target" "$temp" && awk "$program" "$target" > "$temp"; then
    mv "$temp" "$target"
  else
    rm -f "$temp"
    return 1
  fi
}

cleanup() {
  case "$FIXTURE_ROOT" in
    "${TMPDIR:-/tmp}"/skill-invocation-policy.*)
      rm -rf -- "$FIXTURE_ROOT"
      ;;
    *)
      echo "refusing to remove unexpected fixture path: $FIXTURE_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT

mkdir -p "$FIXTURE_ROOT/baseline/.agents"
cp -R "$HARNESS_DIR/skills" "$FIXTURE_ROOT/baseline/skills"
cp -R "$HARNESS_DIR/.agents/skills" "$FIXTURE_ROOT/baseline/.agents/skills"

if ! bash "$CHECKER" "$FIXTURE_ROOT/baseline"; then
  echo "FAIL baseline invocation policy fixture is invalid" >&2
  exit 1
fi
echo "PASS baseline invocation policy fixture"

reset_case() {
  local case_name=$1
  local case_root="$FIXTURE_ROOT/$case_name"

  mkdir -p "$case_root/.agents"
  cp -R "$FIXTURE_ROOT/baseline/skills" "$case_root/skills"
  cp -R "$FIXTURE_ROOT/baseline/.agents/skills" "$case_root/.agents/skills"
  printf '%s\n' "$case_root"
}

expect_rejection() {
  local description=$1
  local case_root=$2
  local expected_diagnostic=$3
  local output

  if output=$(bash "$CHECKER" "$case_root" 2>&1); then
    echo "FAIL $description — checker accepted invalid policy" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_diagnostic" <<<"$output"; then
    echo "FAIL $description — missing diagnostic: $expected_diagnostic" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
  echo "PASS $description"
}

case_root=$(reset_case missing-required-marker)
rewrite_with_sed "$case_root/skills/explore/SKILL.md" \
  '/^implicit_invocation: required$/d'
expect_rejection "missing implicit-required marker" "$case_root" "implicit-required set drift"

case_root=$(reset_case duplicate-noncanonical-claude)
rewrite_with_awk "$case_root/skills/memory/SKILL.md" \
  '{ print; if ($0 == "disable-model-invocation: true") print "disable-model-invocation: FALSE" }'
expect_rejection "duplicate noncanonical Claude control" "$case_root" \
  "requires exactly one canonical Claude 'disable-model-invocation: true' declaration"

case_root=$(reset_case contradictory-codex)
rewrite_with_sed "$case_root/skills/memory/agents/openai.yaml" \
  's/^  allow_implicit_invocation: false$/  allow_implicit_invocation: true/'
expect_rejection "contradictory Codex control" "$case_root" \
  "requires one canonical Codex policy with 'allow_implicit_invocation: false'"

case_root=$(reset_case missing-local-policy)
rewrite_with_sed "$case_root/.agents/skills/scope-check/agents/openai.yaml" \
  '/^policy:$/,/^  allow_implicit_invocation: false$/d'
expect_rejection "missing repository-local Codex control" "$case_root" \
  "scope-check — requires one canonical Codex policy"
