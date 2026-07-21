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
- a rebase state directory actually exists — check with `test -d` on BOTH:

  ```bash
  test -d "$(git rev-parse --git-path rebase-merge)" && echo REBASE-IN-PROGRESS
  test -d "$(git rev-parse --git-path rebase-apply)" && echo REBASE-IN-PROGRESS
  ```

  ⚠️ `git rev-parse --git-path rebase-merge` prints the path UNCONDITIONALLY,
  whether or not the directory exists. Output from `rev-parse` alone is NOT
  evidence of a rebase — only `test -d` on that path is. Treating the printed
  path as "rebase in progress" is a false positive that wrongly blocks finish
  (issue #634). **Or**
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

1. **Full test suite** — Run it fresh. Read the output. Count passing/failing/pending. This is the SINGLE in-pipeline full-suite checkpoint before push — it complements, and is not duplicated by, intermediate steps (which run scoped tests) or CI's authoritative `conductor` job.
2. **Git status** — Check for uncommitted files, untracked files, unexpected changes.
3. **Linting/type checking** — If the project has linters or type checkers, run them.

All must pass before proceeding.

**When the fresh suite fails — flake-check, then record the evidence:**

1. **Flake-check**: re-run JUST the failing specs once. A failure that passes on
   re-run, or that is plainly transient infra (DB not up, port in use, network
   timeout), is a flake — note it and proceed normally.
2. **Real failures remain** → this is NOT a finishable state:
   - Write **`.pipeline/test-failures.md`** (run evidence — overwrite any prior
     one): one section per failing test file with the test names, a one-line
     failure reason each, and your read on the cause — an implementation bug, or
     tests lagging an intentional contract change (say which contract/commit).
     This file is what the conductor hands `/remediate` to route the fix
     autonomously; without it the daemon can only HALT blind.
   - Do NOT push, do NOT create a PR, and do NOT write `.pipeline/finish-choice`
     (the missing marker is how the conductor knows finish refused).
   - Report the blocker plainly and end.

### 1b. Push Direction — Canonical Is Proven, Not Assumed

**GATE: Prove remote staleness before force-pushing — never `git pull` after a sanctioned rebase.**

The daemon's finish-time rebase (ADR-001/9.0) creates a common scenario: your branch
has been rebased on HEAD, but `origin/<branch>` still holds the pre-rebase commits.
This causes `git status` to report "diverged from / behind origin/<branch>" — a normal,
intended state, not a blocker.

**Before pushing this state, you MUST prove that `origin/<branch>` is stale:**

1. **Fast path — merge-base proof:** Run:
   ```
   git merge-base --is-ancestor origin/<branch> ORIG_HEAD
   ```
   If this exits 0 (true), `origin/<branch>` is an ancestor of your pre-rebase HEAD.
   This proves the remote is behind and safe to overwrite.

2. **Fallback — reflog proof:** If merge-base is unavailable or fails, check the reflog:
   ```
   git reflog | grep -E "rebase \(finish\)"
   ```
   Note: git writes this reflog entry as `rebase (finish): returning to refs/heads/<branch>`
   — parenthesized, no colon after "rebase" — never as `"rebase: finish"`. A literal grep for
   `"rebase: finish"` never matches real git output and silently defeats this fallback proof
   (jstoup111/ai-conductor#587); use the pattern above.

   If you see a "rebase (finish):" entry, the daemon rebased this branch as part of
   completion. The pre-rebase state exists in ORIG_HEAD and the reflog. This proves
   staleness.

**Once proof is obtained, reconcile with force-with-lease:**

```
git push --force-with-lease origin <branch>
```

This is safe because `--force-with-lease` aborts if the remote has new commits you
don't know about — you've already verified it only has pre-rebase ones.

**Explicitly forbidden — never do these:**
- `git pull` — pulls `origin/<branch>` and merges; creates conflicts or undoes the rebase
- `git fetch && git rebase origin/<branch>` — same effect, undoing the rebase
- `git merge origin/<branch>` — creates a merge commit that contradicts the rebase

All three corrupt the finish-time rebase and break the feature's shipped state.

**No new marker is introduced.** The `.pipeline/finish-choice` semantics are unchanged
(still one of: `pr`, `merge-local`, `keep`, `discard`). This rule applies to all
completion paths: whether you merge locally, push a PR, or keep the branch, the
staleness proof and force-with-lease discipline must hold.

**Failed Staleness Proof — Foreign Commits Detected**

If the staleness proof fails — i.e., `git merge-base --is-ancestor origin/<branch> ORIG_HEAD`
exits non-zero AND no reflog "rebase (finish):" entry exists — then another writer has pushed
real commits to `origin/<branch>` after your pre-rebase HEAD. This means `origin/<branch>`
is NOT an ancestor of your work; it has diverged.

**GATE: STOP immediately — do NOT force-push.** Even if `--force-with-lease` would
succeed (i.e., the remote head hasn't changed since the last fetch), a passing lease
does NOT authorize the push when the staleness proof failed. The proof's failure is
the blocking signal: real, authored work exists on the remote that you do not have.
Forcing would lose that work.

When this gate triggers:
- Do NOT attempt any push (not even `--force`, `--force-with-lease`, or `push --set-upstream`)
- Do NOT pull, rebase, or merge `origin/<branch>`
- Do NOT create or update a PR
- Do NOT write `.pipeline/finish-choice`
- Report the foreign commits plainly to the user:
  ```
  git log HEAD..origin/<branch> --oneline
  ```
  This shows what work exists on the remote that you don't have.
- End the skill — the conductor's failed-step handling will HALT for human decision.

**Failed Lease — Remote Changed After Last Fetch**

If `git push --force-with-lease` exits non-zero, the remote has moved. This can happen
even if the staleness proof passed: the remote was behind at the time of the proof, but
a concurrent writer pushed new commits between your proof check and your push attempt.

**GATE: STOP immediately — do NOT retry with `--force`.** The lease failure is an
explicit signal that the remote state changed. Pushing with `--force` (without lease)
would overwrite the remote writer's work — the exact scenario force-with-lease is
designed to prevent.

When this gate triggers:
- Do NOT attempt any push (not `--force`, not `push --set-upstream`)
- Do NOT create or update a PR
- Do NOT write `.pipeline/finish-choice`
- Report the lease failure plainly to the user with the branch and the push command output:
  ```
  Branch: <branch>
  Expected remote head: <expected-oid>
  Actual remote head: <actual-oid> (obtained from `git ls-remote origin <branch>`)
  ```
- End the skill — the conductor's failed-step handling will HALT for human review and decision.

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
  Push & PR** (never merge). **Before recording**, verify using the §5 Option 2
  STOP gate — if the push did not land or the PR does not exist, do NOT run
  `finish-record`; halt for human review.
- Otherwise (no remote, or `gh` unavailable/unauthenticated) → **Option 3: Keep
  as-is** — leave the work committed on the branch.

**The final act in auto mode is always `conduct-ts finish-record`** — it is the
single source of truth for the `.pipeline/finish-choice` marker and (for `pr`)
`state.pr_url`; do not hand-write these files yourself in auto mode. Use the
absolute pipeline directory supplied in the step's system prompt:

- PR variant (after the §5 Option 2 STOP gate passes):
  ```
  conduct-ts finish-record --choice pr --pr-url <PR_URL> --pipeline-dir /abs/path/to/.pipeline
  ```
- Keep variant (no remote, or `gh` unavailable/unauthenticated):
  ```
  conduct-ts finish-record --choice keep --pipeline-dir /abs/path/to/.pipeline
  ```

`finish-record` itself re-verifies the PR exists and that HEAD was pushed
before writing anything — so it is safe to run as the terminal step even if
your own verification was imperfect; it fails closed (exit 1, nothing
written) rather than recording a false completion.

**Refusal contract:** any gate above (GATE 0, fresh-verification failures, push
staleness/lease failures, the §5 Option 2 STOP gate) that says STOP means do
NOT run `conduct-ts finish-record` in that pass — an absent `finish-choice`
marker IS the refusal signal the conductor watches for. Never write the marker
by hand to paper over a blocked gate.

The conductor's finish completion gate (artifacts.ts) requires a fresh
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

- **Auto mode (`pr` or `keep`)**: the outcome MUST be recorded by running
  `conduct-ts finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir
  /abs/path/to/.pipeline` (see §4) — this is the final act, and it writes both
  `.pipeline/finish-choice` and, for `pr`, `state.pr_url` atomically after
  re-verifying the PR/push. Do NOT hand-write these files yourself when
  running auto/unattended.
- **Interactive mode (Options 1–4, user chose manually)**: marker semantics
  are unchanged — write the outcome by hand as described below:
  - **Always**: write the chosen option to `.pipeline/finish-choice` as one of
    the literal strings `pr`, `merge-local`, `keep`, or `discard`.
  - **Option 2 (PR) only**: also write the resulting PR URL to
    `.pipeline/conduct-state.json` as `pr_url` (the conductor will pick it up
    from there; if the underlying `/pr` skill prints the URL to stdout the
    conductor can also scrape it).

Without one of these, the conductor will treat the step as failed and re-run
it, even if the skill itself reports success.

**Refusal contract:** if any gate blocked before reaching this step (see the
refusal contract in §4), do NOT write `finish-choice` by hand and do NOT run
`finish-record` — the absent marker is itself the refusal signal the
conductor reads.

**Option 1: Merge locally**
- **Shipped record (before the merge):** on the feature branch, run
  `conduct-ts shipped-record --slug <slug> --pr local` (where `<slug>` is the
  plan-file stem, `.docs/plans/<slug>.md`). It commits `.docs/shipped/<slug>.md`
  on the branch so the merge lands the code and the shipped-fact atomically.
  The command NEVER blocks the ship: on any failure it warns and exits 0 —
  continue regardless.
- Determine the base branch (main, master, develop)
- Merge the feature branch
- Run tests again after merge to verify no merge issues
- Delete the feature branch after successful merge
- Write `merge-local` to `.pipeline/finish-choice`

**Option 2: Push & PR**
- Run the `/pr` skill — it handles pre-push verification, title/body generation, push, and
  PR creation
- **Engine Behavior — Halt-PR Rehabilitation:** After the agent creates or updates the PR,
  the conductor automatically rehabilitates any reused halt PR:
  - Removes the `needs-remediation` label (if present)
  - Rewrites the title to remove `needs-remediation:` prefix (if present)
  - Injects or updates the `Closes` reference to match the actual implementation
  - Flips the PR from draft to ready (if it was drafted)
  
  This automation runs before the completion gate checks the PR state
  (adr-2026-07-03-halt-pr-rehabilitation-at-finish), so the finish gate only
  succeeds if the PR's final title does NOT start with `needs-remediation:`.

#### STOP Gate: Verify Push + PR Before Recording Choice

Before writing `finish-choice=pr` and `pr_url`, verify both the PR and the push:

1. **PR exists and has a non-empty URL:**
   ```
   gh pr view --json url -q .url
   ```
   If this returns empty or fails, the PR does not exist or is inaccessible.

2. **The branch was pushed (remote-tracking ref contains HEAD):**
   ```
   git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>
   ```
   If this exits non-zero, `HEAD` is not an ancestor of the remote tracking ref —
   the push did not land, or the remote never updated locally (stale tracking ref).

**If EITHER check fails, STOP immediately.** Do NOT write `finish-choice=pr` or `pr_url`.
Explain what failed and what to do next:

- **If the PR check failed:** "The PR URL is empty or inaccessible. Verify `gh pr view`
  works and the PR exists on GitHub. Then retry `/finish`."
- **If the push check failed:** "The branch was not pushed, or the remote tracking ref
  is stale. Run `git push --force-with-lease origin <branch>` to push the branch,
  then retry `/finish`."

**In daemon mode:** a missing `finish-choice` marker leaves the completion gate unsatisfied
(Story 1), routing to HALT for human review.

- **Shipped record (before handing the PR to the human):** on the feature
  branch, run `conduct-ts shipped-record --slug <slug> --pr <PR_URL>` (where
  `<slug>` is the plan-file stem, `.docs/plans/<slug>.md`), then `git push` so
  the record commit rides the PR branch — the human merge lands the code and
  the shipped-fact atomically. The command NEVER blocks the ship: on any
  failure it warns and exits 0 — continue (dedup degrades to the local ledger).
- Return the PR URL to the user
- Write the PR URL to `.pipeline/conduct-state.json` (`pr_url` field)
- Write `pr` to `.pipeline/finish-choice`

**Option 3: Keep as-is**
- No action needed
- Remind the user which branch they're on
- Write `keep` to `.pipeline/finish-choice`
- Never run `conduct-ts shipped-record` for `keep` (or `discard`) — nothing
  ships, so no `.docs/shipped/` record may exist for the slug

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
- Suggest next step: `/manual-test` → `/retro`

## Verification

- [ ] GATE 0: checked `git status` first — confirmed NO rebase/merge in progress and no unmerged paths (else stopped without pushing/PR/`finish-choice`)
- [ ] Test suite ran fresh (not cached) — output read
- [ ] If the fresh suite failed: flake-check performed; real failures recorded in `.pipeline/test-failures.md`; NO `finish-choice` written
- [ ] Git status clean (no unexpected uncommitted changes)
- [ ] Outcome recorded via `conduct-ts finish-record --choice <c> [--pr-url <url>]` — the
      completion gate reads `.pipeline/finish-choice` AND the recorded PR URL; a choice of
      `pr` without a recorded URL fails the gate
- [ ] Reused halt-PR verified for engine rehabilitation: PR title does not start with
      `needs-remediation:` and does not carry the `needs-remediation` label (engine
      automatically removes/rewrites these after `/pr` completes; if title still contains
      `needs-remediation:`, halt-PR rehabilitation failed — check conductor logs)
- [ ] HEAD pushed and present at the recorded PR's head (push evidence — the gate verifies
      `refs/remotes/origin/<branch>` contains HEAD)
- [ ] Diverged branch: staleness proven (ORIG_HEAD ancestry / reflog `rebase (finish):` entry) before `--force-with-lease` (never pulled)
- [ ] On unproven staleness (foreign commits): stopped with no force of any kind
- [ ] On lease failure: stopped with no plain `--force`, no pull, no `finish-choice`
- [ ] All story acceptance criteria verified as covered
- [ ] Changes shown to user for review before options presented
- [ ] Option presented to user and their choice executed
- [ ] `.pipeline/finish-choice` written with the chosen outcome
- [ ] If Option 2 (PR): `pr_url` written to `.pipeline/conduct-state.json`
- [ ] Cleanup completed (worktrees, pipeline state)
- [ ] Manual-test suggested as next step
