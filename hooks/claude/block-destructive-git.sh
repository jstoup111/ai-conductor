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

# Scannable copy: first drop heredoc bodies, then drop single- and double-quoted
# spans (content and quotes). A heredoc delimiter may be quoted, but its body is
# command data rather than shell syntax and must never be interpreted as a git
# operation by this hook.
SCAN=$(COMMAND="$COMMAND" python3 - <<'PY'
import os
import re

heredoc_start = re.compile(
    r"(?<!<)<<(?P<strip>-?)(?!<)[ \t]*(?:(?P<quote>['\"])(?P<quoted>[^'\"]+)(?P=quote)|(?P<bare>[^\s;|&]+))"
)

def arithmetic_expansion_spans(line, depth):
    spans = []
    start = 0 if depth else None
    i = 0
    while i < len(line):
        if start is None:
            if line.startswith("$((", i):
                start = i
                depth = 1
                i += 3
                continue
            if line.startswith("((", i):
                start = i
                depth = 1
                i += 2
                continue
        elif line[i] == "(":
            depth += 1
        elif line[i] == ")":
            if depth == 1 and line.startswith(")", i + 1):
                spans.append((start, i + 2))
                start = None
                i += 2
                continue
            depth -= 1
        i += 1
    if start is not None:
        spans.append((start, len(line)))
    return spans, depth

delimiters = []
arithmetic_depth = 0

for line in os.environ["COMMAND"].splitlines(keepends=True):
    if delimiters:
        candidate = line.rstrip("\n")
        delimiter, strip_tabs = delimiters[0]
        if strip_tabs:
            candidate = candidate.lstrip("\t")
        if candidate == delimiter:
            delimiters.pop(0)
        continue

    print(line, end="")
    arithmetic_spans, arithmetic_depth = arithmetic_expansion_spans(line, arithmetic_depth)
    for match in heredoc_start.finditer(line):
        if not any(start <= match.start() < end for start, end in arithmetic_spans):
            delimiters.append((match.group("quoted") or match.group("bare"), match.group("strip") == "-"))
PY
)
SCAN=$(printf '%s' "$SCAN" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

# Patterns that are destructive and hard to reverse
# Allow --force-with-lease (safe) but block exact bare --force/-f tokens.
# A lease option never suppresses detection of a later bare force option.
# Split unquoted compound commands before looking for a direct `git push`, so
# an option belonging to a neighbouring command cannot be mistaken for push.
if printf '%s' "$SCAN" | tr ';|&' '\n' | grep -qE 'git[[:space:]]+push([[:space:]]+[^[:space:]]+)*[[:space:]]+(--force|-f)([[:space:]]|$)'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force push blocked by harness. Use --force-with-lease instead, or ask the user for explicit confirmation."}}' >&2
  exit 2
fi

if echo "$SCAN" | grep -qE 'git\s+reset\s+--hard'; then
  echo "BLOCKED: git reset --hard is destructive and irreversible. Investigate the issue or ask the user before discarding work." >&2
  exit 2
fi

# Block ad-hoc rebases of a feature branch onto a base. A mid-build rebase onto an
# advanced `main` rewrites history under active work and triggers surprise
# conflicts (it bit two feature branches during Phase 9). That discipline now
# lives in the skill prompts (build/tdd/pipeline) and HARNESS.md → Rebase Policy,
# NOT in a hard block: a hard block also rejected the legitimate operator rebase
# (refreshing a stale PR) and the /rebase resolver. So ad-hoc `git rebase` is
# ALLOWED here; we emit a NON-blocking reminder so a manual rebase stays a
# conscious choice. The daemon's finish-time rebase runs via execa (not this
# hook). --continue/--abort/--skip/--edit-todo pass silently (no reminder).
if echo "$SCAN" | grep -qE 'git\s+rebase\b'; then
  if echo "$SCAN" | grep -qE 'git\s+rebase\s+(--continue|--abort|--skip|--edit-todo|--quit)\b'; then
    : # advancing/aborting an in-progress rebase — always fine, no note
  else
    echo "NOTE: 'git rebase' is allowed but should be rare — only the daemon finish-time rebase-on-latest and the /rebase resolver rebase feature branches; never rebase mid-build (HARNESS.md → Rebase Policy). Proceeding." >&2
  fi
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
