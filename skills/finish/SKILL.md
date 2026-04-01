---
name: finish
description: "Use when implementation is complete and all tests pass. Verifies with fresh evidence, presents completion options (merge, PR, keep, discard), and cleans up."
enforcement: gating
phase: ship
standalone: true
requires: []
---

## Purpose

Ensures that completion claims are backed by fresh evidence — not cached results or assumptions.
Presents structured options for integrating the work and handles cleanup.

## Practices

### 1. Fresh Verification

**GATE: No completion claims without running verification commands NOW.**

Do NOT trust:
- Test results from earlier in the session
- "It was passing last time I checked"
- Agent reports from subagents (verify their claims independently)

Run these commands and read the full output:

1. **Full test suite** — Run it fresh. Read the output. Count passing/failing/pending.
2. **Git status** — Check for uncommitted files, untracked files, unexpected changes.
3. **Linting/type checking** — If the project has linters or type checkers, run them.

All must pass before proceeding.

### 2. Verify Against Stories

Cross-reference the completed work against the stories in `.docs/stories/`:
- Are ALL happy path criteria implemented and tested?
- Are ALL negative path criteria implemented and tested?
- If any are missing, this is NOT complete — go back to the appropriate BUILD skill.

### 3. Present Options

After verification passes, present these options to the user:

```
Feature implementation complete. All tests pass. Options:

1. Merge locally     — Merge this branch into the base branch
2. Push & create PR  — Push the branch and create a pull request
3. Keep as-is        — Leave the branch for later; no merge or PR
4. Discard           — Delete the branch and all changes (requires confirmation)
```

Wait for the user to choose. Do not assume.

### 4. Execute Choice

**Option 1: Merge locally**
- Determine the base branch (main, master, develop)
- Merge the feature branch
- Run tests again after merge to verify no merge issues
- Delete the feature branch after successful merge

**Option 2: Push & PR**
- Push the branch with `-u` to set upstream
- Create a PR with:
  - Title: concise description of the feature
  - Body: reference to stories, summary of changes, test plan
- Return the PR URL to the user

**Option 3: Keep as-is**
- No action needed
- Remind the user which branch they're on

**Option 4: Discard**
- Require explicit confirmation: "Are you sure? This deletes all work on this branch."
- If confirmed: checkout base branch, delete feature branch
- If not confirmed: return to options

### 5. Cleanup

After executing the chosen option:
- **Worktree merge/cleanup:** Dispatch the `worktree-manager` agent (see `agents/worktree-manager.md`):
  - Options 1 (merge) and 2 (PR): agent merges the feature branch, runs post-merge tests,
    then removes the worktree and prunes the branch
  - Option 4 (discard): agent removes the worktree and deletes the branch
  - Option 3 (keep): no cleanup — worktree stays for later
- Update `.pipeline/task-status.json` if pipeline was active
- Suggest next step: `/manual-test` → `/retro`

## Verification

- [ ] Test suite ran fresh (not cached) — output read
- [ ] Git status clean (no unexpected uncommitted changes)
- [ ] All story acceptance criteria verified as covered
- [ ] Option presented to user and their choice executed
- [ ] Cleanup completed (worktrees, pipeline state)
- [ ] Manual-test suggested as next step
