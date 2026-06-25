#!/bin/bash
# Block destructive git operations: force push, hard reset, branch delete.
#
# Detection runs against a "scannable" copy of the command with quoted spans
# removed, so a pattern that merely appears INSIDE a quoted argument (a commit
# message, an `echo`, a comment) does not trigger a false block — only the real,
# unquoted operation does. Trade-off: a destructive command fully wrapped in
# quotes (e.g. `bash -c "git reset --hard"`) is not caught; the agent runs git
# directly, so this is acceptable.
set -e

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# Scannable copy: drop single- and double-quoted spans (content and quotes).
SCAN=$(printf '%s' "$COMMAND" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

# Patterns that are destructive and hard to reverse
# Allow --force-with-lease (safe) but block bare --force/-f (destructive)
if echo "$SCAN" | grep -qE 'git\s+push\s+.*--force-with-lease'; then
  : # safe — allows push if remote hasn't changed since last fetch
elif echo "$SCAN" | grep -qE 'git\s+push\s+.*--force|git\s+push\s+-f\b'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force push blocked by harness. Use --force-with-lease instead, or ask the user for explicit confirmation."}}' >&2
  exit 2
fi

if echo "$SCAN" | grep -qE 'git\s+reset\s+--hard'; then
  echo "BLOCKED: git reset --hard is destructive and irreversible. Investigate the issue or ask the user before discarding work." >&2
  exit 2
fi

if echo "$SCAN" | grep -qE 'git\s+branch\s+-D\b'; then
  # Force-delete is dangerous only for UNMERGED branches. A squash- or
  # rebase-merged branch (the GitHub default) is NOT an ancestor of the default
  # branch, so plain `git branch -d` refuses it — forcing -D for routine
  # post-merge cleanup. Allow -D ONLY when every named branch is provably
  # merged; still block genuinely unmerged force-deletes.
  default=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed -E 's@^refs/remotes/origin/@@' || true)
  [ -z "$default" ] && default=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

  # Branch operands: tokens after `git branch` that are not options. Use the
  # original command (quote chars stripped) so quoted branch names still resolve.
  branches=$(printf '%s' "$COMMAND" \
    | tr -d "\"'" \
    | sed -E 's/.*git[[:space:]]+branch[[:space:]]+//' \
    | tr ' ' '\n' \
    | grep -vE '^-' || true)

  unsafe=""
  for b in $branches; do
    [ -z "$b" ] && continue
    # (1) Ancestor of the default branch → a normal merge → safe.
    if git merge-base --is-ancestor "$b" "$default" 2>/dev/null; then
      continue
    fi
    # (2) Has a merged PR → squash/rebase-merged upstream → safe.
    if command -v gh >/dev/null 2>&1 \
      && [ -n "$(gh pr list --head "$b" --state merged --json number --jq '.[0].number' 2>/dev/null || true)" ]; then
      continue
    fi
    unsafe="$unsafe $b"
  done

  if [ -n "$unsafe" ]; then
    echo "BLOCKED: git branch -D would force-delete UNMERGED branch(es):$unsafe. Use -d for a safe delete, or ask the user. (Merged or squash/rebase-merged branches are allowed for cleanup.)" >&2
    exit 2
  fi
  # All named branches are merged → fall through and allow the cleanup.
fi

if echo "$SCAN" | grep -qE 'git\s+clean\s+-f'; then
  echo "BLOCKED: git clean -f permanently removes untracked files. Ask the user before cleaning." >&2
  exit 2
fi

if echo "$SCAN" | grep -qE 'git\s+checkout\s+--\s+\.|git\s+restore\s+\.'; then
  echo "BLOCKED: This discards all unstaged changes. Ask the user before reverting." >&2
  exit 2
fi

exit 0
