---
name: rebase
disable-model-invocation: true
description: "Resolve an in-progress paused rebase conflict, stage fixes, and drive git rebase --continue to completion; invoked by the conductor's finish-time rebase step or by an operator running /rebase."
enforcement: advisory
phase: ship
standalone: true
requires: []
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
test -d "$(git rev-parse --git-path rebase-merge)" || test -d "$(git rev-parse --git-path rebase-apply)"
```

(`--git-path` resolves the state dir correctly in linked worktrees, where `.git`
is a file and `ls .git/rebase-merge/` always fails. Note that `rev-parse
--git-path` prints the path unconditionally — only `test -d` on it proves a
rebase is in progress.)

If no rebase is in progress, emit `{"resolved": false, "reason": "no rebase in progress"}` and stop.

### 2. Capture Replay Intent Before Editing

Before touching a conflicted file, capture an evidence ledger for the **replay
source commit** currently being applied. `REBASE_HEAD` identifies the commit
being replayed during a paused rebase; record its object ID and its parent
commit before making edits:

```bash
git rev-parse REBASE_HEAD
git rev-parse REBASE_HEAD^
git show --format=fuller --stat REBASE_HEAD
git diff --find-renames REBASE_HEAD^ REBASE_HEAD
```

Read the source commit and its parent context/diff to establish what behavior
the replay source commit intended to introduce or change. Then read the
upstream context that is currently checked out and caused the conflict:

```bash
git show --format=fuller --stat HEAD
git log --oneline --decorate -n 20 HEAD
git diff --find-renames REBASE_HEAD^ HEAD
```

Record, for the current replay source commit, its ID, parent ID, source intent,
and relevant upstream change/intent. If the source or upstream context is
unavailable or leaves the intended behavior ambiguous, do not guess: emit
`{"resolved": false, "reason": "..."}` and stop.

### Ambiguity Gate — Stop at the First Cannot-Resolve Judgment

At the **first semantic ambiguity**, stop this bounded attempt immediately. Do
not edit, stage, run `git rebase --continue`, inspect another conflict, or
consume a later attempt while this ambiguity remains unresolved. Do not defer
the decision to a later replay hunk or guess which behavior wins.

The false-result `reason` must name the replay commit, affected file and line
range or conflict region, the competing source intent and upstream intent, and
the missing decision that prevents a safe merge. Use this shape when the facts
are known:

```
replay commit <REBASE_HEAD SHA>; <file> <lines or hunk>; source intends <behavior>; upstream intends <behavior>; missing decision: <what must be decided>
```

When a required fact cannot be obtained, say `unavailable context: <fact and
why it is unavailable>` explicitly in the reason. Preserve every known part of
the evidence rather than inventing the unavailable fact.

Do not use a vague confidence claim (for example, "cannot determine with
confidence" or a confidence percentage) as the reason for ambiguity. State the
specific competing intentions and missing decision instead.

Removing conflict markers or reaching a clean index is **not** evidence that
the replay is correct. Do not infer correctness from conflict-marker removal
alone; the captured source and upstream intent must support the resolution.

### 3. Identify Conflicted Files

```bash
git diff --name-only --diff-filter=U
```

List every file with conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). Read
each file fully before touching it — you need to understand both sides
(ours = the branch being rebased onto, theirs = the commit being applied).

### 4. Resolve Each Conflict

For each conflicted file:

1. Read the conflict hunk carefully. Understand what `HEAD` (ours) and the
   incoming commit (theirs) each intended.
2. Apply the correct merged content — typically the union of both changes when
   they touch different code, or the incoming change when ours is already
   superseded. Use judgment; do not blindly accept either side.
3. Remove all conflict markers. The file must parse/compile cleanly.
4. If the conflict is in a generated file (lock files, compiled artifacts):
   prefer `theirs` unless the project has a clear policy.

**If the correct resolution is semantically ambiguous** — conflicting business
logic, missing context, overlapping semantic changes — apply the Ambiguity Gate
above. Emit its actionable `{"resolved": false, "reason": "..."}` and stop
immediately. A wrong guess is worse than a HALT.

### 5. Stage and Validate the Complete Replay

Stage the resolution and every intended supporting edit, then inspect the
**complete staged diff** before continuing. Do not limit this review to
conflict markers, conflicted hunks, or the files that originally conflicted:

```bash
git add <resolved-files> <supporting-edits>
git diff --cached
git diff --cached --summary
git diff --cached --check
```

Every intended supporting edit must be staged before the complete staged-replay
review; do not leave a justified supporting edit unstaged. The names passed to
`git add` are not a file allowlist or an acceptance boundary: the complete
staged replay remains subject to the attribution review below.

Review every staged change, including content, file additions or deletions,
renames, and mode changes. Every staged change must be attributable to the
replay source intent or a necessary upstream adaptation. An unexplained staged
change means the replay is unsafe: do not continue; emit
`{"resolved": false, "reason": "..."}` and stop. An unexplained cross-file
edit likewise means the replay is unsafe: do not continue; emit
`{"resolved": false, "reason": "..."}` and stop.

Coordinated supporting edits outside the directly conflicted hunk or file are
permitted when needed to adapt the replay after upstream refactoring. Explain
and validate every coordinated cross-file edit against both the replay source
intent and the necessary upstream adaptation before continuing.

The complete-replay attribution judgment is the acceptance boundary:

- Do not use a file allowlist as the acceptance boundary.
- Do not use a hunk-only restriction as the acceptance boundary.
- Do not use whole-patch equality as the acceptance boundary.
- Do not use a deterministic resolver as the acceptance boundary.

Those mechanical restrictions reject valid semantic adaptations; they do not
establish whether the staged replay preserves its intent.

### 6. Continue and Validate the Resulting Replay Commit

Only after the staged replay passes attribution review:

```bash
git rebase --continue
```

Before running continue, retain the **pre-continue replay identity** and the
validated source/upstream intent in the evidence ledger. The retained identity
must identify the source commit being replayed, so the resulting commit can be
reviewed as the same replay rather than treated as an unrelated new `HEAD`.

After `git rebase --continue` returns, inspect the **newly created replay
commit** before advancing to another conflict or reporting success:

```bash
git rev-parse HEAD
git show --format=fuller --stat HEAD
git diff --find-renames HEAD^ HEAD
git diff --check HEAD^ HEAD
```

Compare the resulting replay commit's content, files, modes, and intent with
the retained pre-continue replay identity and the intent validated in step 5.
Confirm that the newly created commit preserves that validated intent, allowing
only the already-explained upstream adaptations. Do not rely on a matching
subject line, clean working tree, or successful `rebase --continue` as proof
that the replay is correct.

If the resulting replay commit cannot be reconciled with the validated intent,
or its changes cannot be explained by the retained replay source plus necessary
upstream adaptation, stop immediately. Emit `{"resolved": false, "reason":
"..."}`; do not report `{"resolved": true}` or advance to another replay.

`git rebase --continue` may open an editor for the commit message, stop at a
subsequent conflict, or complete the rebase:

- If it stops at another conflict, first finish the resulting-commit inspection
  above, then return to step 2 to capture replay intent for that subsequent
  conflicted commit. Do not reuse the prior commit's identity or validation
  ledger for the new replay.
- If it completes the rebase, inspect and validate that final replay commit
  before reporting success. Emit `{"resolved": true}` only after every replay
  commit, including the final replay, has reconciled with its validated intent
  and `git status` is clean on the rebased branch.

Continue this review loop until the rebase completes or an unsafe replay is
reached, still within this single invocation.

### 7. Safety Rules (Non-Negotiable)

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

### 8. Result Contract

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
replay commit, file and line range or hunk, competing source/upstream
intentions, and the missing decision. If required context is unavailable, say
`unavailable context: ...` explicitly. For example:

```
{"resolved": false, "reason": "replay commit abc1234; src/auth.ts lines 41-58; source intends session renewal; upstream intends token removal; missing decision: whether renewal remains supported"}
```

No other output format is accepted. Do not emit JSON anywhere else in your
output; the runner takes the **last** JSON line.

## Verification

- [ ] `git status` confirmed an in-progress rebase before proceeding
- [ ] Replay source commit and parent captured before edits
- [ ] Source parent/diff and relevant upstream context read before resolving
- [ ] Conflict-marker removal was not treated as correctness evidence
- [ ] All conflicted files identified via `git diff --name-only --diff-filter=U`
- [ ] Both sides of every conflict hunk read and understood before editing
- [ ] No conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) remain in any file
- [ ] Complete staged diff, summary, and whitespace errors reviewed before continue
- [ ] Every staged change attributed to source intent or necessary upstream adaptation
- [ ] Every coordinated edit outside a conflicted hunk/file explained and validated
- [ ] Unexplained staged and cross-file changes halted rather than continued
- [ ] No file allowlist, hunk-only restriction, whole-patch equality, or deterministic resolver used as the acceptance boundary
- [ ] `git add` run on every resolved file and intended supporting edit before staged replay review and `git rebase --continue`
- [ ] Pre-continue replay identity and validated intent retained before every continue
- [ ] Newly created replay commit inspected after every continue before advancing
- [ ] Each resulting replay reconciled with its validated intent before another conflict or success
- [ ] A post-continue mismatch emitted `{"resolved": false}` and never `{"resolved": true}`
- [ ] A subsequent conflict started a fresh source-intent and staged-replay validation cycle
- [ ] Final replay commit inspected and reconciled before reporting `{"resolved": true}`
- [ ] `git rebase --abort` and `git rebase --skip` were NOT used
- [ ] Final line of stdout is exactly `{"resolved": true}` or `{"resolved": false, "reason": "..."}`
- [ ] If `{"resolved": true}`: `git status` shows clean working tree on rebased branch
