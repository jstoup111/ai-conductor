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

**GATE 0 — Refuse to finish a tree that is mid-rebase or mid-merge.** This is the
FIRST thing you do, before the test suite or anything else. Run `git status` and
check for an in-progress rebase/merge:

- `git status` reports `rebase in progress` / `You are currently rebasing` / `You
  have unmerged paths`, **or**
- a `git rev-parse --git-path rebase-merge` / `rebase-apply` directory exists, **or**
- `git diff --name-only --diff-filter=U` is non-empty (unresolved conflicts).

If ANY of these hold, **STOP immediately**: do NOT run the test suite, do NOT push,
do NOT create a PR, and do NOT write `.pipeline/finish-choice`. Finishing here would
push a detached, half-rebased branch (or grind for many minutes on a tree it can
never ship). This is **not** a finishable state — the rebase must be completed/
resolved first (the conductor's rebase step or `/rebase` does that). Report the
blocker plainly and end. Leaving no `finish-choice` lets the conductor re-evaluate
and HALT for resolution rather than ship broken work.

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

### 2. Verify Against Stories and ADRs

Cross-reference the completed work against the stories in `.docs/stories/`:
- Are ALL happy path criteria implemented and tested?
- Are ALL negative path criteria implemented and tested?
- If any are missing, this is NOT complete — go back to the appropriate BUILD skill.

**ADR compliance check:**
- Verify no DRAFT ADRs remain in `.docs/decisions/` — all must be APPROVED
- Verify implementation does not contradict any APPROVED ADR
- If architecture-review had "APPROVED WITH CONDITIONS", verify all conditions are met
- BLOCK if any ADR violation is detected — the ADR must be superseded or the code changed

### 3. Review Changes

Before presenting options, show the user what was built so they can review:

1. Determine the base branch (`main`, `master`, or `develop`)
2. Show a summary: `git diff --stat <base>..HEAD` and `git log --oneline <base>..HEAD`
3. Ask the user if they want to see the full diff before deciding
4. If yes, show the full diff (use Agent for very large diffs to avoid context overflow)

Do not skip this step. The user must have the opportunity to review before choosing.

### 4. Present Options

After review, present these options to the user:

```
Feature implementation complete. All tests pass. Options:

1. Merge locally     — Merge this branch into the base branch
2. Push & create PR  — Push the branch and create a pull request
3. Keep as-is        — Leave the branch for later; no merge or PR
4. Discard           — Delete the branch and all changes (requires confirmation)
```

Wait for the user to choose. Do not assume.

**Unattended/auto mode:** If you are running in print mode (no user attached) or
`--auto`, do NOT prompt — decide deterministically and **act** (do not merely
describe the choice):
- If the repo has a configured git remote and `gh` is authenticated → **Option 2:
  Push & PR** (never merge). Record `pr_url` in `.pipeline/conduct-state.json`.
- Otherwise (no remote, or `gh` unavailable/unauthenticated) → **Option 3: Keep
  as-is** — leave the work committed on the branch.

In both cases write the corresponding value to `.pipeline/finish-choice`. The
conductor's finish completion gate (artifacts.ts) requires a fresh
`.pipeline/finish-choice` (and, for `pr`, `state.pr_url`); without it the
feature is left "complete-but-unshipped" and the loop stalls.

**Daemon mode — write markers to the worktree, before cleanup.** When the daemon
runs finish, the feature's `.pipeline` lives in the *worktree*, but branch/PR/
worktree cleanup (the worktree-manager agent) `cd`s into the *main* repo — so a
relative `.pipeline/...` write can land in the wrong repo and the gate (which
reads the worktree) never sees it. Write `finish-choice` and the `pr_url` in
`conduct-state.json` to the **absolute worktree `.pipeline` path** (the conductor
supplies it in the step's system prompt) and do so **before** any merge/cleanup
step — never from inside a `cd`'d main checkout. If a PR for the branch already
exists, reuse it (`gh pr view --json url -q .url`) rather than failing.

### 5. Execute Choice

After executing any choice, **record the outcome** so the conductor's
completion gate can verify the step actually did something:

- **Always**: write the chosen option to `.pipeline/finish-choice` as one of
  the literal strings `pr`, `merge-local`, `keep`, or `discard`.
- **Option 2 (PR) only**: also write the resulting PR URL to
  `.pipeline/conduct-state.json` as `pr_url` (the conductor will pick it up
  from there; if the underlying `/pr` skill prints the URL to stdout the
  conductor can also scrape it).

Without one of these, the conductor will treat the step as failed and re-run
it, even if the skill itself reports success.

**Option 1: Merge locally**
- Determine the base branch (main, master, develop)
- Merge the feature branch
- Run tests again after merge to verify no merge issues
- Delete the feature branch after successful merge
- Write `merge-local` to `.pipeline/finish-choice`

**Option 2: Push & PR**
- Run the `/pr` skill — it handles pre-push verification, title/body generation, push, and
  PR creation
- Return the PR URL to the user
- Write the PR URL to `.pipeline/conduct-state.json` (`pr_url` field)
- Write `pr` to `.pipeline/finish-choice`

**Option 3: Keep as-is**
- No action needed
- Remind the user which branch they're on
- Write `keep` to `.pipeline/finish-choice`

**Option 4: Discard**
- Require explicit confirmation: "Are you sure? This deletes all work on this branch."
- If confirmed: checkout base branch, delete feature branch, write `discard` to
  `.pipeline/finish-choice`
- If not confirmed: return to options (do NOT write the marker)

### 6. Cleanup

After executing the chosen option:
- **Worktree merge/cleanup:** Dispatch the `worktree-manager` agent with `model="haiku"` (see `agents/worktree-manager.md`):
  - Options 1 (merge) and 2 (PR): agent merges the feature branch, runs post-merge tests,
    then removes the worktree and prunes the branch
  - Option 4 (discard): agent removes the worktree and deletes the branch
  - Option 3 (keep): no cleanup — worktree stays for later
- Update `.pipeline/task-status.json` if pipeline was active
- Suggest next step: `/manual-test` → `/retro`

## Verification

- [ ] GATE 0: checked `git status` first — confirmed NO rebase/merge in progress and no unmerged paths (else stopped without pushing/PR/`finish-choice`)
- [ ] Test suite ran fresh (not cached) — output read
- [ ] Git status clean (no unexpected uncommitted changes)
- [ ] All story acceptance criteria verified as covered
- [ ] Changes shown to user for review before options presented
- [ ] Option presented to user and their choice executed
- [ ] `.pipeline/finish-choice` written with the chosen outcome
- [ ] If Option 2 (PR): `pr_url` written to `.pipeline/conduct-state.json`
- [ ] Cleanup completed (worktrees, pipeline state)
- [ ] Manual-test suggested as next step
