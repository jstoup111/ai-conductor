#!/usr/bin/env bash
set -euo pipefail

# Verify that every repository-local skill is visible to both supported hosts.

ROOT=${1:-}

if [ -z "$ROOT" ] || [ ! -d "$ROOT/.agents/skills" ] \
  || [ ! -d "$ROOT/.claude/skills" ]; then
  echo "usage: $0 <harness-root>" >&2
  exit 2
fi

VIOLATIONS=""
SKILL_COUNT=0

for skill_file in "$ROOT"/.agents/skills/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  SKILL_COUNT=$((SKILL_COUNT + 1))
  skill_name=$(basename "$(dirname "$skill_file")")
  host_link="$ROOT/.claude/skills/$skill_name"

  if [ ! -e "$host_link" ] && [ ! -L "$host_link" ]; then
    VIOLATIONS+="${skill_name} — missing .claude/skills symlink"$'\n'
    continue
  fi

  if [ ! -L "$host_link" ]; then
    VIOLATIONS+="${skill_name} — .claude/skills entry is not a symlink"$'\n'
    continue
  fi

  expected_target=$(cd -P "$ROOT/.agents/skills/$skill_name" && pwd -P)
  actual_target=$(cd -P "$host_link" 2>/dev/null && pwd -P || true)
  if [ "$actual_target" != "$expected_target" ]; then
    VIOLATIONS+="${skill_name} — .claude/skills symlink resolves to unexpected target $(readlink "$host_link")"$'\n'
  fi
done

if [ "$SKILL_COUNT" -eq 0 ]; then
  echo "enumerated no local skills" >&2
  exit 2
fi

for host_entry in "$ROOT"/.claude/skills/*; do
  [ -e "$host_entry" ] || [ -L "$host_entry" ] || continue
  skill_name=$(basename "$host_entry")
  if [ ! -f "$ROOT/.agents/skills/$skill_name/SKILL.md" ]; then
    VIOLATIONS+="${skill_name} — orphaned .claude/skills entry"$'\n'
  fi
done

if [ -n "$VIOLATIONS" ]; then
  printf '%s' "$VIOLATIONS" >&2
  exit 1
fi
