#!/usr/bin/env bash
set -euo pipefail

# Mutation tests for check_local_skill_host_wiring.sh. These fixtures prove the
# checker rejects local skills that are wired for only one supported host.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HARNESS_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
CHECKER="$SCRIPT_DIR/check_local_skill_host_wiring.sh"
FIXTURE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/local-skill-host-wiring.XXXXXX")

cleanup() {
  case "$FIXTURE_ROOT" in
    "${TMPDIR:-/tmp}"/local-skill-host-wiring.*)
      rm -rf -- "$FIXTURE_ROOT"
      ;;
    *)
      echo "refusing to remove unexpected fixture path: $FIXTURE_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT

expect_rejection() {
  local description=$1
  local case_root=$2
  local expected_diagnostic=$3
  local output

  if output=$(bash "$CHECKER" "$case_root" 2>&1); then
    echo "FAIL $description — checker accepted invalid wiring" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_diagnostic" <<<"$output"; then
    echo "FAIL $description — missing diagnostic: $expected_diagnostic" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
  echo "PASS $description"
}

mkdir -p "$FIXTURE_ROOT/baseline/.agents" "$FIXTURE_ROOT/baseline/.claude"
cp -RP "$HARNESS_DIR/.agents/skills" "$FIXTURE_ROOT/baseline/.agents/skills"
cp -RP "$HARNESS_DIR/.claude/skills" "$FIXTURE_ROOT/baseline/.claude/skills"

if ! bash "$CHECKER" "$FIXTURE_ROOT/baseline"; then
  echo "FAIL baseline local skill host-wiring fixture is invalid" >&2
  exit 1
fi
echo "PASS baseline local skill host-wiring fixture"

reset_case() {
  local case_name=$1
  local case_root="$FIXTURE_ROOT/$case_name"

  mkdir -p "$case_root/.agents" "$case_root/.claude"
  cp -RP "$FIXTURE_ROOT/baseline/.agents/skills" "$case_root/.agents/skills"
  cp -RP "$FIXTURE_ROOT/baseline/.claude/skills" "$case_root/.claude/skills"
  printf '%s\n' "$case_root"
}

usage_output=$(bash "$CHECKER" 2>&1) || usage_status=$?
if [ "${usage_status:-0}" -ne 2 ]; then
  echo "FAIL missing root argument exits 2" >&2
  printf '%s\n' "$usage_output" >&2
  exit 1
fi
echo "PASS missing root argument exits 2"

case_root=$(reset_case missing-claude-symlink)
rm "$case_root/.claude/skills/scope-check"
expect_rejection "missing .claude/skills symlink" "$case_root" \
  "scope-check — missing .claude/skills symlink"

case_root=$(reset_case dangling-claude-symlink)
rm "$case_root/.claude/skills/scope-check"
ln -s ../../.agents/skills/does-not-exist "$case_root/.claude/skills/scope-check"
expect_rejection "dangling .claude/skills symlink" "$case_root" \
  "scope-check — .claude/skills symlink resolves to unexpected target ../../.agents/skills/does-not-exist"

case_root=$(reset_case wrong-claude-symlink)
rm "$case_root/.claude/skills/scope-check"
ln -s ../../.agents/skills/event-spine "$case_root/.claude/skills/scope-check"
expect_rejection "wrong .claude/skills symlink" "$case_root" \
  "scope-check — .claude/skills symlink resolves to unexpected target ../../.agents/skills/event-spine"

case_root=$(reset_case orphaned-claude-symlink)
ln -s ../../.agents/skills/ghost "$case_root/.claude/skills/ghost"
expect_rejection "orphaned .claude/skills entry" "$case_root" \
  "ghost — orphaned .claude/skills entry"

case_root=$(reset_case copied-claude-skill)
rm "$case_root/.claude/skills/scope-check"
cp -R "$case_root/.agents/skills/scope-check" "$case_root/.claude/skills/scope-check"
expect_rejection "copied .claude/skills entry" "$case_root" \
  "scope-check — .claude/skills entry is not a symlink"

case_root=$(reset_case no-local-skills)
rm -rf "$case_root/.agents/skills"
mkdir -p "$case_root/.agents/skills"
expect_rejection "empty local skill catalog" "$case_root" "enumerated no local skills"
