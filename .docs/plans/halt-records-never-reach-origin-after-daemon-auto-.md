# Implementation Plan: Halt records never reach origin after daemon auto-rebase

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/halt-records-never-reach-origin-after-daemon-auto-.md`; decision 5 of `adr-2026-08-23-committed-halt-record` amended for #2891)
**Stories:** .docs/stories/halt-records-never-reach-origin-after-daemon-auto-.md
**Conflict check:** Not required (Tier S)
**Source:** jstoup111/ai-conductor#2891

## Summary

Publish halt records and their resolutions with a lease push, leased on the branch's
remote-tracking ref, so they reach origin after the daemon's own rebase while a remote moved by
anyone else is still refused and reported. Three tasks: the lease argument with the write-path
integration proof, the write-path refusal and guard cases, and the supersede-path proof.

## Technical Approach

- **One argument at one seam.** `publishHaltRecord` in `src/conductor/src/engine/halt-record.ts`
  is the only push for both `recordHalt` and `supersedeHaltRecord`. Its argument vector becomes
  `['push', 'origin', `HEAD:refs/heads/${branch}`, '--force-with-lease']`. This is the bare-lease
  form `openShipDraftPr` uses for `pushMode: 'lease'` (`ship-draft-pr.ts`, search
  `'--force-with-lease'`) and `pushRefreshedBranch` uses in `autoresolve.ts`. Git then compares
  origin's branch tip with `refs/remotes/origin/<branch>`, the tip the daemon last pushed. Never add
  `--force`, `-f`, a `+` refspec, an explicit `=<sha>` lease, or a fetch before the push. Keep
  `executeRemoteGit`, the mutation resolution, and the credential runner unchanged. The guarded push
  grammar already admits `--force-with-lease` (`remote-git-targets.ts` `isKnownPushOption`).
- **Failure reporting is unchanged.** A stale lease makes git exit non-zero with
  `! [rejected] … (stale info)`. `executeRemoteGit` returns `failed`, `recordHalt` and
  `supersedeHaltRecord` return `pushFailed` with that text, and `writeHaltRecord` in
  `halt-marker.ts` emits `halt_record_push_failed` as it does today. No new event, result kind, or
  reason mapping.
- **The engine guard already agrees.** The provisioned `pre-push` hook (`PRE_PUSH_HOOK` in
  `git-hook-assets.ts`) admits a non-fast-forward exactly when the remote-tracking ref equals the
  remote's current SHA. That is the condition this lease checks.
- **Real-git proof.** The tests use the local bare-remote pattern already in
  `test/engine/halt-record-commit.test.ts`: `git init --bare`, `git remote add origin`, and an
  initial push. Inject `HaltRecordRemoteOptions.remoteGit` with an adapter that runs the supplied
  argument vector through real `git` in `dependencies.cwd`. It returns
  `{ kind: 'executed', targets: [] }` on exit 0 and
  `{ kind: 'failed', error: <stderr>, targets: [] }` otherwise. The lease, the hook, and the
  rejection then come from git itself, not a fake. Simulate the daemon rebase with
  `git commit --amend --allow-empty -m rebased` after the initial push. Simulate a foreign mover
  with a second clone of the bare remote that commits and pushes the branch. Never use
  `reset --hard`.
- **Coordination note.** #2942 (`adr-2026-10-07-per-child-build-region` decision 11) makes stacked
  child branches skip this push entirely. That is a textual overlap in `halt-record.ts`, not a
  semantic conflict: leaf and non-stacked branches keep the push, and this plan changes only its
  arguments.

## Prerequisites

- None.

## Tasks

### Task 1: Lease the halt-record push; a post-rebase halt reaches origin
**Story:** Story 1 (happy path 1; negative path 2)
**Type:** happy-path

**Steps:**
1. Create `src/conductor/test/engine/halt-record-lease.test.ts` with the bare-remote fixture and real-git `remoteGit` adapter described in Technical Approach. The worktree is a `git worktree add -b feat/<x>` checkout of a scratch repository whose default branch is `main`, so `resolveRecordability` passes. Write a failing test: push the branch, amend its tip (`git commit --amend --allow-empty -m rebased`), then call `writeHaltMarker(worktree, 'operator decision required\n', 'needs-human', emitter, { remoteGit: realGitAdapter, git: makeLocalGit() })` with a `ConductorEventEmitter` that records `halt_record_written` and `halt_record_push_failed`. Assert three things: `git --git-dir <bare> rev-parse refs/heads/<branch>` equals the worktree's `git rev-parse HEAD`; `git --git-dir <bare> show refs/heads/<branch>:.docs/halted/<basename(worktree)>.md` contains `Status: halted`; and exactly one `halt_record_written` event (with that path) and zero `halt_record_push_failed` events were emitted.
2. In `src/conductor/test/engine/halt-record-commit.test.ts`, change the exact-argument assertion in `sends the committed record through the injected remote mutation boundary` to `[['push', 'origin', `HEAD:refs/heads/${input.branch}`, '--force-with-lease']]`. Add an assertion that no recorded argument equals `--force` or `-f` and no refspec starts with `+`. Add a sibling case that commits a halted record, calls `supersedeHaltRecord(worktree, input.slug, 'operator', successfulRemote(pushes))`, and asserts the same exact argument vector and the same no-bare-force properties for the resolution push.
3. Verify RED: the integration test fails with a non-fast-forward rejection, and the argument assertion fails.
4. In `publishHaltRecord` (`src/conductor/src/engine/halt-record.ts`), append `'--force-with-lease'` to the push argument vector. Change nothing else in the function.
5. Verify GREEN; commit "fix(halt-record): publish halt records with a lease push after daemon rebase".

**Done when:**
- [test] `halt-record-lease.test.ts` asserts that after a local history rewrite with an unmoved remote, `writeHaltMarker` leaves the bare remote's branch tip equal to the worktree's local HEAD and the record at that tip contains `Status: halted`.
- [test] The same test asserts exactly one `halt_record_written` event naming `.docs/halted/<slug>.md` and zero `halt_record_push_failed` events.
- [test] `halt-record-commit.test.ts` asserts both the `recordHalt` push and the `supersedeHaltRecord` push issue exactly `['push', 'origin', 'HEAD:refs/heads/feat/operator-decision', '--force-with-lease']`, with no `--force`, no `-f`, and no `+`-prefixed refspec.

**Files likely touched:**
- `src/conductor/src/engine/halt-record.ts` — `--force-with-lease` in `publishHaltRecord`
- `src/conductor/test/engine/halt-record-lease.test.ts` — new real-git fixture and post-rebase write test
- `src/conductor/test/engine/halt-record-commit.test.ts` — updated argument-vector assertion

**Dependencies:** none

### Task 2: A foreign remote move is refused and reported; the engine guard admits the lease push
**Story:** Story 1 (happy path 2; negative path 1)
**Type:** negative-path

**Steps:**
1. In `halt-record-lease.test.ts`, add a foreign-mover test. Push the branch and amend locally. Then clone the bare remote into a second scratch directory, check out the branch, make an empty commit, and push it; record that SHA. Call `writeHaltMarker` as in Task 1. Assert: the call resolves `{ status: 'written' }` and `.pipeline/HALT` exists; the bare remote's branch tip still equals the foreign SHA; the worktree's `HEAD` commit changed only `.docs/halted/<slug>.md`; and exactly one `halt_record_push_failed` event names `.docs/halted/<slug>.md` with a `reason` containing `stale info`, and no `halt_record_written` event was emitted.
2. Add a guard test. Write `PRE_PUSH_HOOK` from `src/conductor/src/engine/git-hook-assets.ts` to `<worktree>/.pipeline/git-hooks/pre-push`, `chmod 755` it, and run `git config core.hooksPath <that dir>` in the worktree. Then run the Task 1 rewrite scenario and assert the bare remote's branch tip equals the worktree's local HEAD.
3. Run. These cases lock in behavior Task 1 delivered, so they may pass at once; if so, commit only the tests. If either fails, fix `publishHaltRecord` without adding any force form.
4. Commit "test(halt-record): foreign remote move refused and reported; pre-push guard admits lease".

**Done when:**
- [test] `halt-record-lease.test.ts` asserts that when another clone advanced the remote branch, the bare remote's branch tip still equals that clone's commit after `writeHaltMarker`.
- [test] The same test asserts `writeHaltMarker` resolves `{ status: 'written' }`, `.pipeline/HALT` exists, and the worktree HEAD commit (the halt record commit) remains on the local branch.
- [test] The same test asserts exactly one `halt_record_push_failed` event naming `.docs/halted/<slug>.md` with a reason containing `stale info`, and no `halt_record_written` event.
- [test] `halt-record-lease.test.ts` asserts that with `PRE_PUSH_HOOK` installed as the worktree's `core.hooksPath` pre-push hook, the post-rewrite halt record push is admitted and the bare remote's branch tip equals the local HEAD.

**Files likely touched:**
- `src/conductor/test/engine/halt-record-lease.test.ts` — foreign-mover and guard cases

**Dependencies:** Task 1

### Task 3: A post-rebase halt resolution reaches origin; a foreign move is refused
**Story:** Story 2 (happy path 1; negative path 1)
**Type:** happy-path

**Steps:**
1. In `halt-record-lease.test.ts`, add a supersede happy test. Call `recordHalt(worktree, input, remote)` with the real-git adapter, where `input.slug` equals the slug passed to supersede. The record is committed and pushed. Amend the tip locally (`git commit --amend --allow-empty -m rebased`). Then call `supersedeHaltRecord(worktree, input.slug, 'operator', remote)`. Assert: the result is `{ kind: 'written' }`; the bare remote's branch tip equals the worktree's local HEAD; and the record at that tip contains `Status: resolved` and `Resolution cause: operator`.
2. Add a supersede negative test. Use the same setup, but before superseding, advance the remote branch from a second clone and record that SHA. Assert: the result is `{ kind: 'pushFailed' }` with a `reason` containing `stale info`; the bare remote's branch tip still equals the foreign SHA; and the worktree's `HEAD:.docs/halted/<slug>.md` contains `Status: resolved`.
3. Run. Task 1's lease already covers the shared seam, so these may pass at once; if so, commit only the tests.
4. Commit "test(halt-record): post-rebase halt resolution reaches origin; foreign move refused".

**Done when:**
- [test] `halt-record-lease.test.ts` asserts `supersedeHaltRecord` on a locally rewritten branch with an unmoved remote returns `{ kind: 'written' }` and leaves the bare remote's branch tip equal to the local HEAD.
- [test] The same test asserts the record at the bare remote's branch tip contains `Status: resolved` and `Resolution cause: operator`.
- [test] `halt-record-lease.test.ts` asserts that when another clone advanced the remote, `supersedeHaltRecord` returns `pushFailed` with a reason containing `stale info`, and the bare remote's tip still equals that clone's commit.
- [test] The same negative test asserts the worktree's local HEAD keeps the resolved-record commit, whose `.docs/halted/<slug>.md` contains `Status: resolved`.

**Files likely touched:**
- `src/conductor/test/engine/halt-record-lease.test.ts` — supersede happy and foreign-mover cases

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
```

Tasks 2 and 3 share the new test file, so they run in sequence.

## Integration Points

- After Task 1: `writeHaltMarker`, the production halt seam every operator-actionable halt goes through, publishes the record to a real bare remote after a local rewrite.
- After Task 3: `supersedeHaltRecord`, the shared seam called by `conduct halt clear`, the daemon re-kick, and stall remediation, publishes the resolution after a local rewrite.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature branch whose already-pushed history was rewritten locally after its last push and whose remote branch is unmoved, when an operator-actionable halt is raised through the halt-marker seam, then origin's branch tip equals the worktree's local HEAD, that tip contains the halt record with `Status: halted`, a `halt_record_written` event names the record path, and no `halt_record_push_failed` event is emitted. | 1 | "asserts that after a local history rewrite with an unmoved remote, `writeHaltMarker` leaves the bare remote's branch tip equal to the worktree's local HEAD and the record at that tip contains `Status: halted`" | diff-local |
| Story 1 happy: Given the same rewritten branch with the engine-provisioned `pre-push` guard installed in the repository, when the halt record is published, then the guard admits the push and origin's branch tip equals the worktree's local HEAD. | 2 | "the post-rewrite halt record push is admitted and the bare remote's branch tip equals the local HEAD" | diff-local |
| Story 1 negative: Given a rewritten feature branch whose remote branch was advanced by another clone after the daemon's last push, when an operator-actionable halt is raised through the halt-marker seam, then origin's branch tip is still the other clone's commit, the halt record commit remains on the local branch, the HALT marker is still written, and a `halt_record_push_failed` event names the record path with a reason containing git's `stale info` rejection. | 2 | "asserts exactly one `halt_record_push_failed` event naming `.docs/halted/<slug>.md` with a reason containing `stale info`, and no `halt_record_written` event" | diff-local |
| Story 1 negative: Given any halt-record publication, when the push command is issued, then it carries `--force-with-lease` and carries no bare force (`--force`, `-f`, or a `+`-prefixed refspec). | 1 | "with no `--force`, no `-f`, and no `+`-prefixed refspec" | diff-local |
| Story 2 happy: Given a feature branch carrying a committed halt record with `Status: halted`, rewritten locally after its last push, with its remote branch unmoved, when the halt record is superseded, then the supersede result is `written`, origin's branch tip equals the worktree's local HEAD, and the record at that tip reads `Status: resolved` with the resolution cause. | 3 | "returns `{ kind: 'written' }` and leaves the bare remote's branch tip equal to the local HEAD" | diff-local |
| Story 2 negative: Given the same rewritten branch whose remote branch was advanced by another clone after the daemon's last push, when the halt record is superseded, then the result is `pushFailed` with a reason containing `stale info`, origin's branch tip is still the other clone's commit, and the local branch keeps the resolved-record commit. | 3 | "`supersedeHaltRecord` returns `pushFailed` with a reason containing `stale info`, and the bare remote's tip still equals that clone's commit" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
