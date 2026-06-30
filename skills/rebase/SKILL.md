---
name: rebase
description: "Resolve an in-progress paused rebase conflict, stage fixes, and drive git rebase --continue to completion; invoked by the conductor's finish-time rebase step or by an operator running /rebase."
enforcement: advisory
phase: ship
standalone: true
requires: []
model: opus
---

## Purpose

Resumes a **paused rebase** that stopped on a conflict hunk. The conductor's
finish-time `runRebaseStep` calls this skill when `git rebase` exits mid-flight
(exit code 1 with conflict markers in the working tree). The operator can also
invoke it manually as `/rebase`.

This skill has ONE job: resolve the conflict markers in the affected files,
stage the fixes, and run `git rebase --continue` to advance — repeating for any
additional conflict hunks — until the rebase completes cleanly or a hunk is
judged unsafe to resolve automatically.

The conductor retries this skill up to a configured cap (default 3) before
issuing a HALT. Each invocation is **one bounded attempt**.

## Practices

### 1. Confirm Rebase State

Verify a rebase is actually in progress before touching anything:

```bash
git status
ls .git/rebase-merge/ 2>/dev/null || ls .git/rebase-apply/ 2>/dev/null
```

If no rebase is in progress, emit `{"resolved": false, "reason": "no rebase in progress"}` and stop.

### 2. Identify Conflicted Files

```bash
git diff --name-only --diff-filter=U
```

List every file with conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). Read
each file fully before touching it — you need to understand both sides
(ours = the branch being rebased onto, theirs = the commit being applied).

### 3. Resolve Each Conflict

For each conflicted file:

1. Read the conflict hunk carefully. Understand what `HEAD` (ours) and the
   incoming commit (theirs) each intended.
2. Apply the correct merged content — typically the union of both changes when
   they touch different code, or the incoming change when ours is already
   superseded. Use judgment; do not blindly accept either side.
3. Remove all conflict markers. The file must parse/compile cleanly.
4. If the conflict is in a generated file (lock files, compiled artifacts):
   prefer `theirs` unless the project has a clear policy.

**If you cannot determine the correct resolution with confidence** — conflicting
business logic, missing context, overlapping semantic changes — **do not guess**.
Emit `{"resolved": false, "reason": "<specific description of what makes this
unsafe>"}` immediately. A wrong guess is worse than a HALT.

### 4. Stage and Continue

After resolving all conflicted files in this round:

```bash
git add <resolved-files>
git rebase --continue
```

`git rebase --continue` may open an editor for the commit message or encounter
another conflict hunk. If another conflict hunk appears, return to step 2 and
resolve it (still within this single invocation). Continue until the rebase
completes or an unsafe hunk is reached.

### 5. Safety Rules (Non-Negotiable)

- **NEVER run `git rebase --abort`** — this drops the in-progress commit work.
  The conductor's engine guards (FR-8 not-current / FR-9 dropped-commit) will
  reject it, but do not attempt it in the first place.
- **NEVER run `git rebase --skip`** — this discards the conflicting commit
  entirely, causing data loss. The engine guards reject this too; do not attempt it.
- **NEVER run `git push --force` or any destructive branch operation** during
  rebase resolution.
- **NEVER invoke this skill mid-build** — only the conductor's finish-time rebase
  step or an operator `/rebase` invocation is sanctioned. Implementation agents
  running during BUILD must not call this skill; doing so violates the
  harness "no ad-hoc rebase mid-build" rule.

### 6. Result Contract

The conductor's `DefaultStepRunner` parses the last JSON object emitted to
stdout. This contract is **load-bearing** — the conductor decides whether to
retry or HALT based on it.

Print exactly one of these as the **final line of output**, on its own line:

```
{"resolved": true}
```
when the rebase completed fully (all commits applied, `git status` shows a
clean working tree on the rebased branch).

```
{"resolved": false, "reason": "<human-readable explanation>"}
```
when any conflict hunk was judged unsafe to resolve, the rebase is still
in progress, and a human must intervene. Be specific in `reason` — name the
files and what made the conflict ambiguous.

No other output format is accepted. Do not emit JSON anywhere else in your
output; the runner takes the **last** JSON line.

## Verification

- [ ] `git status` confirmed an in-progress rebase before proceeding
- [ ] All conflicted files identified via `git diff --name-only --diff-filter=U`
- [ ] Both sides of every conflict hunk read and understood before editing
- [ ] No conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) remain in any file
- [ ] `git add` run on every resolved file before `git rebase --continue`
- [ ] `git rebase --abort` and `git rebase --skip` were NOT used
- [ ] Final line of stdout is exactly `{"resolved": true}` or `{"resolved": false, "reason": "..."}`
- [ ] If `{"resolved": true}`: `git status` shows clean working tree on rebased branch
