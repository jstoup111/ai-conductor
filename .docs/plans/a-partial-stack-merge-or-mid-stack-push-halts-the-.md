# Implementation Plan: stack teardown deletes a merged child whose GitHub head moved

**Date:** 2026-10-31
**Stories:** .docs/stories/a-partial-stack-merge-or-mid-stack-push-halts-the-.md
**Conflict check:** Not required at Tier S

## Summary

`deleteStackChildren` replaces its exact-head condition with an accounted-for proof, so a merged child whose GitHub head moved after publication is deleted. Its engine refs are then removed. A child holding a commit that reached neither the push nor the PR is still kept, and an unreadable proof still retries. The plan has 7 tasks, all in `src/conductor/src/engine/stack-teardown.ts` and its test.

## Technical Approach

- **Where.** Only `deleteStackChildren` in `src/conductor/src/engine/stack-teardown.ts` changes. Its callers stay as they are: the mergeable sweep (`sweepMergeableLabels`) and park reclaim. So do its three results (`deleted`, `kept`, `failed`), the merged and `origin/main` preconditions, the sealed-position enumeration, and the final ref deletion through `deleteFeatureConductorRefs` and the `positions`/`publication` transaction.
- **Proof.** A new exported helper, `accountForChildCommits(input)`, returns `accounted`, `unaccounted` or `failed`. It takes `{ slug, branch, localTip, mergedHead, git }`.
  - If `localTip === mergedHead`, it returns `accounted` with no further reads. This keeps today's behavior and calls.
  - Otherwise it ensures the head object is present with `git cat-file -e <H>^{commit}`. When the object is missing it runs `git fetch origin <H>`, which is the `ensureCommitAvailable` shape in `shipment-audit.ts`. A failing fetch gives `failed`.
  - It reads `pushedTipRef(slug, branch)` (`push-lease.ts`) with `rev-parse --quiet --verify`. Exit 0 yields P, exit 1 means no P, and any other exit gives `failed`.
  - It runs `git rev-list <L> --not [<P>] <H>`. A nonzero exit gives `failed`.
  - Each listed commit must pass `isHaltRecordOnlyCommit(commit, slug, git)` (`restack/halt-record-bookkeeping.ts`). The first commit that fails gives `unaccounted`. A thrown classifier error gives `failed`.
- **Delete.** In `deleteStackChildren`, the old `local !== head` keep becomes the helper call. `unaccounted` sets `kept` and continues to later members, as today. `failed` returns `{ kind: 'failed' }` at once. `accounted` deletes with `update-ref -d refs/heads/<branch> <L>`, a compare-and-swap on the local tip the proof read rather than on H. A nonzero result stays `failed`.
- **Test pattern.** Use real temporary git repositories for the proof, like the first test in `src/conductor/test/engine/stack-teardown.test.ts`: `mkdtemp`, `git init`, explicit commits, and `update-ref` for `origin/main` and the conductor refs. Make H a real commit so no network is used. For a fetch, add a second bare repository as `origin` and give it a commit the work repository lacks. Use a mocked `git` runner only where a failure must be injected (Story 3); its calls are recorded the way the existing mocked tests record them. Existing mocked tests whose fixtures do not model the new reads are updated so each keeps its asserted outcome. Search hint: `mergedGh`, `runGit`, `deleteStackChildren(` in that test file.

## Prerequisites

- None. Both ADR amendments are committed in this spec.

## Tasks

### Task 1: The accounted-for proof accepts commits reached by the push, the merged head, or a halt-record-only commit
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests for `accountForChildCommits` in `src/conductor/test/engine/stack-teardown.test.ts`. Each fixture builds base, then child commits C1 and C2 with P at C2, and asserts the result for one shape:
   - L = P and H = P plus a merge of `main` and a fix commit;
   - L = P and H a rewritten rebase of the child onto a new base, sharing no child commit with L;
   - L = P plus two commits that change only `.docs/halted/<slug>.md`;
   - L ahead of P by one commit, with H containing that commit;
   - L = H.
2. Verify the tests fail (RED): the helper does not exist.
3. Implement `accountForChildCommits` as the Technical Approach describes, but only the present-object branch for now. Task 3 adds the fetch.
4. Verify GREEN.
5. Commit: "feat(stack-teardown): accounted-for proof for merged child commits".

**Done when:**
- [test] `accountForChildCommits` returns `accounted` for the merged-main-plus-fix head, the server-side-rebase head, the two halt-record-only commits beyond P, and the L-ahead-within-H fixture, each built in a real temporary git repository.
- [test] For the L = H fixture `accountForChildCommits` returns `accounted`, and its recorded git calls contain no `rev-list` and no `fetch`.
- [test] For the halt-record-only fixture the `rev-list <L> --not <P> <H>` result is the two halt-record commits, and each is classified by `isHaltRecordOnlyCommit` for the slug.

**Files likely touched:**
- `src/conductor/src/engine/stack-teardown.ts` — add `accountForChildCommits`
- `src/conductor/test/engine/stack-teardown.test.ts` — proof fixtures

**Dependencies:** none

### Task 2: The proof rejects every commit that reached neither the push nor the merged head
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing real-git tests for `accountForChildCommits`. Each fixture has exactly one unaccounted commit beyond P that H does not contain:
   - a production-file change;
   - a commit changing only `.docs/halted/<other-slug>.md`;
   - a commit changing this slug's halt record plus `src/x.ts`;
   - a merge commit: H = P + X, and L = a `--no-ff` merge of X onto P, so the merge is the only commit that neither P nor H reaches.
   A further fixture has no `pushed/<branch>` ref and a child commit absent from H.
2. Verify RED. Before the implementation handles these shapes, some return `accounted` or throw.
3. Implement: the classifier loop returns `unaccounted` on the first commit that fails `isHaltRecordOnlyCommit`. When the pushed ref is absent (`rev-parse` exit 1), it is left out of the `--not` set and the result is not `failed`.
4. Verify GREEN.
5. Commit: "feat(stack-teardown): keep children with unaccounted commits".

**Done when:**
- [test] `accountForChildCommits` returns `unaccounted` for the production-file commit, the other-slug halt-record commit, the mixed-path halt-record commit and the merge-commit fixture.
- [test] With no `refs/conductor/<slug>/pushed/<branch>` ref and a child commit absent from H, `accountForChildCommits` returns `unaccounted`, not `failed`, and its recorded `rev-list` call has no pushed-tip argument.

**Files likely touched:**
- `src/conductor/src/engine/stack-teardown.ts` — classifier loop and absent pushed ref
- `src/conductor/test/engine/stack-teardown.test.ts` — negative fixtures

**Dependencies:** Task 1

### Task 3: A missing merged head is fetched by SHA, and a failed fetch is a retryable failure
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - a real-git fixture with a bare `origin` holding H, a commit the work repository lacks, where H accounts for L's commits;
   - a mocked-`git` case where `cat-file -e` exits 1 and `fetch` exits 128.
2. Verify RED.
3. Implement: before computing the range, check `cat-file -e <H>^{commit}`. When the object is missing, run `fetch origin <H>`. A nonzero fetch returns `failed`.
4. Verify GREEN.
5. Commit: "feat(stack-teardown): fetch a missing merged head by SHA".

**Done when:**
- [test] In the bare-origin fixture `accountForChildCommits` runs `fetch origin <H>` and returns `accounted`, and `cat-file -e <H>^{commit}` succeeds in the work repository afterwards.
- [test] With `fetch` exiting 128, `accountForChildCommits` returns `failed` and its recorded calls contain no `rev-list`.

**Files likely touched:**
- `src/conductor/src/engine/stack-teardown.ts` — head-presence check and fetch
- `src/conductor/test/engine/stack-teardown.test.ts` — fetch fixtures

**Dependencies:** Task 1

### Task 4: Teardown deletes accounted children by their local tip and keeps unaccounted ones, end to end through the mergeable sweep
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests:
   - a: drive `sweepMergeableLabels` the way the existing first test does. Child 1 has L = P and H = P plus a merge of `main` and a CI-fix commit, plus a `push-intent` ref. Child 3 has H = P and L = P plus two commits changing only `.docs/halted/demo.md`.
   - b: call `deleteStackChildren` directly. Child 1 has L = P plus one commit changing `src/app.ts`, and H = P. Child 3 has L = H.
2. Verify RED: today both moved-head children in (a) are kept.
3. Implement: in `deleteStackChildren`, replace `local.stdout.trim() !== head` with `accountForChildCommits`. Map `unaccounted` to `kept = true; continue`, `failed` to `return { kind: 'failed' }`, and `accounted` to `update-ref -d refs/heads/<branch> <L>`. Update the existing mocked tests to model the new reads so their asserted outcomes hold. The "advanced child" test then models one unaccounted non-halt commit and still expects `kept`. The real-git "lagging child branch is kept" test builds child 3 behind its merged head, a shape the new proof correctly deletes. Rebuild that test so child 3 carries one unaccounted commit changing `src/app.ts`, and keep its assertions on `kept`, the dropped watch entry and the reap log line.
4. Verify GREEN.
5. Commit: "fix(stack-teardown): delete merged children whose head moved after publication".

**Done when:**
- [test] Fixture (a), run through `sweepMergeableLabels`, is built as follows. Child 1 has L = P and H = P plus a merge of `main` and a CI-fix commit. Child 3 has H = P and L = P plus two commits changing only `.docs/halted/demo.md`. Afterwards `refs/heads/feat/c1/demo` and `refs/heads/feat/c3/demo` are absent and the watch entry is gone.
- [test] On fixture (a), `deleteStackChildren` called directly returns `deleted`. Its recorded child deletes are exactly `update-ref -d refs/heads/feat/c1/demo <L1>` and `update-ref -d refs/heads/feat/c3/demo <L3>`, where L1 and L3 are the local tips read before the proof.
- [test] After fixture (a)'s teardown, the recorded `update-ref --stdin` inputs name each ref explicitly in `delete <ref>` lines: `refs/conductor/demo/pushed/feat/c1/demo`, `refs/conductor/demo/push-intent/feat/c1/demo`, `refs/conductor/demo/positions` and `refs/conductor/demo/publication`. No recorded call is `for-each-ref`, and all four refs are absent.
- [test] Fixture (b) is built as follows. Child 1 has L = P plus one commit changing `src/app.ts`, and H = P. Child 3 has L = H. `deleteStackChildren` returns `kept`, `refs/heads/feat/c1/demo` still resolves to its L, and `refs/heads/feat/c3/demo` is absent.
- [test] Every pre-existing test in `src/conductor/test/engine/stack-teardown.test.ts` passes with its original asserted result kind (`deleted`, `kept` or `failed`) unchanged. The lagging-child test is the only fixture rebuilt: child 3 now carries one unaccounted `src/app.ts` commit, and the test still asserts `kept`, the dropped watch entry and its reap log line.

**Files likely touched:**
- `src/conductor/src/engine/stack-teardown.ts` — use the proof and CAS on L
- `src/conductor/test/engine/stack-teardown.test.ts` — integration fixtures and the updated mocked tests

**Dependencies:** Tasks 2, 3

### Task 5: An unreadable proof or a moved branch fails teardown retryably and deletes nothing more
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests on `deleteStackChildren` with a recording `git` wrapper over a real fixture. In every case, child 1's L differs from its H (L = P plus one commit, with H = P plus a different commit), so the proof cannot take the L = H shortcut:
   - a: H is missing locally, and `fetch` exits 128 for child 1;
   - b: the wrapper moves `refs/heads/feat/c1/demo` to a new commit after the proof and right before the `update-ref -d` call;
   - c: `rev-list` exits 128 for child 1;
   - d: `diff-tree` exits 128 while child 1's listed commit is being classified.
2. Verify RED where the current code differs.
3. Implement any missing mapping, so that every one of these returns `{ kind: 'failed' }` before later members are touched.
4. Verify GREEN.
5. Commit: "test(stack-teardown): unreadable proofs fail retryably".

**Done when:**
- [test] Case (a), with child 1's H missing locally and `fetch origin <H>` exiting 128: `deleteStackChildren` returns `failed`, both child branches still resolve, `refs/conductor/demo/publication`, `refs/conductor/demo/positions`, `refs/conductor/demo/pushed/feat/c1/demo` and `refs/conductor/demo/push-intent/feat/c1/demo` (created by the fixture) are still present, and the recorded calls contain no `update-ref --stdin` call.
- [test] Case (b), with the wrapper moving `refs/heads/feat/c1/demo` to a new commit after the proof read L and before the `update-ref -d` call: `deleteStackChildren` returns `failed`, `refs/heads/feat/c1/demo` resolves to the moved commit, and `refs/conductor/demo/publication` is still present.
- [test] Case (c), with `rev-list` exiting 128 for child 1, and case (d), with `diff-tree` exiting 128 while child 1's listed commit is being classified: each makes `deleteStackChildren` return `failed`, its recorded calls contain no `update-ref -d refs/heads/feat/c3/demo`, and `refs/heads/feat/c3/demo` still resolves.

**Files likely touched:**
- `src/conductor/src/engine/stack-teardown.ts` — failure mapping, if any is missing
- `src/conductor/test/engine/stack-teardown.test.ts` — failure fixtures

**Dependencies:** Task 4

### Task 6: Teardown deletes children for every accounted head shape, including a server-side rebase and a fetched head
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write real-git tests on `deleteStackChildren`:
   - c: child 1 has L = P, and its H is a rewritten rebase of the child's commits onto a new base, sharing no child commit with L;
   - d: child 1's L is P plus one commit that H contains, and child 3's L equals its H;
   - e: child 1's H exists only in a bare `origin` repository and contains L.
2. Verify the result. These shapes may already pass after Task 4; a test that passes on first run still stays as the regression proof.
3. Implement any gap in the proof's wiring that these fixtures expose.
4. Verify GREEN.
5. Commit: "test(stack-teardown): delete children for every accounted head shape".

**Done when:**
- [test] Fixture (c) is built so that child 1 has L = P and an H that is a rewritten rebase of the child's commits onto a new base, sharing no child commit with L. `deleteStackChildren` returns `deleted` and `refs/heads/feat/c1/demo` is absent.
- [test] Fixture (d) is built so that child 1's L is ahead of P by one commit that H contains, and child 3's L equals its H. `deleteStackChildren` returns `deleted`, both `refs/heads/feat/c1/demo` and `refs/heads/feat/c3/demo` are absent, and child 3's delete is recorded as `update-ref -d refs/heads/feat/c3/demo <H>`.
- [test] Fixture (e) is built so that child 1's H exists only in a bare `origin` repository and contains L. `deleteStackChildren` runs `fetch origin <H>` before child 1's `rev-list`, returns `deleted`, and `refs/heads/feat/c1/demo` is absent.

**Files likely touched:**
- `src/conductor/test/engine/stack-teardown.test.ts` — accounted-shape fixtures
- `src/conductor/src/engine/stack-teardown.ts` — only if a fixture exposes a wiring gap

**Dependencies:** Task 4

### Task 7: Teardown keeps a child for every unaccounted commit shape
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write real-git tests on `deleteStackChildren`. In each fixture, child 1's only commit beyond P that H lacks is one of these:
   - a commit changing only `.docs/halted/other.md`;
   - a commit changing `.docs/halted/demo.md` and `src/app.ts`;
   - a merge commit: H = P + X, and L = a `--no-ff` merge of X onto P.
   A fourth fixture has no `refs/conductor/demo/pushed/feat/c1/demo` ref and a child-1 commit absent from H.
2. Verify the result. These shapes may already pass after Task 4; a test that passes on first run still stays as the regression proof.
3. Implement any gap in the wiring that these fixtures expose.
4. Verify GREEN.
5. Commit: "test(stack-teardown): keep children for every unaccounted commit shape".

**Done when:**
- [test] Three fixtures are built in which child 1's only commit beyond P that H lacks is, respectively, a commit changing only `.docs/halted/other.md`, a commit changing `.docs/halted/demo.md` and `src/app.ts`, and a merge commit. In each, `deleteStackChildren` returns `kept` and `refs/heads/feat/c1/demo` still resolves to its L.
- [test] A fixture is built with no `refs/conductor/demo/pushed/feat/c1/demo` ref and a child-1 commit absent from H. `deleteStackChildren` returns `kept`, not `failed`, and `refs/heads/feat/c1/demo` still resolves to its L.

**Files likely touched:**
- `src/conductor/test/engine/stack-teardown.test.ts` — unaccounted-shape fixtures
- `src/conductor/src/engine/stack-teardown.ts` — only if a fixture exposes a wiring gap

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ─┐
        └─ Task 3 ─┴─ Task 4 ─┬─ Task 5
                              ├─ Task 6
                              └─ Task 7
```

## Integration Points

- After Task 4: the mergeable sweep reaps a published stack whose child heads moved, and removes every child branch and stack ref.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a sealed child whose L equals P and whose H has P as an ancestor plus later commits (a merge of `main` and a CI fix), when teardown runs, then the local child branch is deleted with a compare-and-swap expecting L, and the result is `deleted` once every other child is also deleted. | 4 | "On fixture (a), `deleteStackChildren` called directly returns `deleted`. Its recorded child deletes are exactly `update-ref -d refs/heads/feat/c1/demo <L1>` and `update-ref -d refs/heads/feat/c3/demo <L3>`, where L1 and L3 are the local tips read before the proof." | diff-local |
| Story 1 happy: Given a sealed child whose L equals P and whose H is a server-side rebase that shares no commit with L, when teardown runs, then the local child branch is deleted, because every commit reachable from L is reachable from P. | 6 | "Fixture (c) is built so that child 1 has L = P and an H that is a rewritten rebase of the child's commits onto a new base, sharing no child commit with L. `deleteStackChildren` returns `deleted` and `refs/heads/feat/c1/demo` is absent." | diff-local |
| Story 1 happy: Given a sealed child whose L is P plus two halt-record-only commits that never reached the PR, when teardown runs, then the local child branch is deleted. | 4 | "Fixture (a), run through `sweepMergeableLabels`, is built as follows. Child 1 has L = P and H = P plus a merge of `main` and a CI-fix commit. Child 3 has H = P and L = P plus two commits changing only `.docs/halted/demo.md`. Afterwards `refs/heads/feat/c1/demo` and `refs/heads/feat/c3/demo` are absent and the watch entry is gone." | diff-local |
| Story 1 happy: Given a sealed child whose L is ahead of P by commits that are all reachable from H, when teardown runs, then the local child branch is deleted. | 6 | "Fixture (d) is built so that child 1's L is ahead of P by one commit that H contains, and child 3's L equals its H. `deleteStackChildren` returns `deleted`, both `refs/heads/feat/c1/demo` and `refs/heads/feat/c3/demo` are absent, and child 3's delete is recorded as `update-ref -d refs/heads/feat/c3/demo <H>`." | diff-local |
| Story 1 happy: Given a sealed child whose L equals H, as before this change, when teardown runs, then the local child branch is deleted exactly as it was before. | 6 | "Fixture (d) is built so that child 1's L is ahead of P by one commit that H contains, and child 3's L equals its H. `deleteStackChildren` returns `deleted`, both `refs/heads/feat/c1/demo` and `refs/heads/feat/c3/demo` are absent, and child 3's delete is recorded as `update-ref -d refs/heads/feat/c3/demo <H>`." | diff-local |
| Story 1 happy: Given every sealed child is deleted under these proofs, when teardown finishes, then the feature's pushed, push-intent, `positions` and `publication` refs are deleted by explicit name and the result is `deleted`, not `kept`. | 4 | "After fixture (a)'s teardown, the recorded `update-ref --stdin` inputs name each ref explicitly in `delete <ref>` lines: `refs/conductor/demo/pushed/feat/c1/demo`, `refs/conductor/demo/push-intent/feat/c1/demo`, `refs/conductor/demo/positions` and `refs/conductor/demo/publication`. No recorded call is `for-each-ref`, and all four refs are absent." | diff-local |
| Story 1 negative: Given the commit H is not present in the local object store, when teardown runs, then it fetches H from `origin` by SHA before computing the proof, and deletes the branch when the fetched H accounts for L's commits. | 6 | "Fixture (e) is built so that child 1's H exists only in a bare `origin` repository and contains L. `deleteStackChildren` runs `fetch origin <H>` before child 1's `rev-list`, returns `deleted`, and `refs/heads/feat/c1/demo` is absent." | diff-local |
| Story 2 happy: Given a sealed child whose L carries one commit that changes a production file and is reachable from neither P nor H, when teardown runs, then that child branch is kept at L, the result is `kept`, and a later sealed child that passes the proof is still deleted. | 4 | "Fixture (b) is built as follows. Child 1 has L = P plus one commit changing `src/app.ts`, and H = P. Child 3 has L = H. `deleteStackChildren` returns `kept`, `refs/heads/feat/c1/demo` still resolves to its L, and `refs/heads/feat/c3/demo` is absent." | diff-local |
| Story 2 negative: Given a sealed child whose only unaccounted commit changes the halt record of a different slug, when teardown runs, then that child branch is kept. | 7 | "Three fixtures are built in which child 1's only commit beyond P that H lacks is, respectively, a commit changing only `.docs/halted/other.md`, a commit changing `.docs/halted/demo.md` and `src/app.ts`, and a merge commit. In each, `deleteStackChildren` returns `kept` and `refs/heads/feat/c1/demo` still resolves to its L." | diff-local |
| Story 2 negative: Given a sealed child whose only unaccounted commit changes this slug's halt record and also another file, when teardown runs, then that child branch is kept. | 7 | "Three fixtures are built in which child 1's only commit beyond P that H lacks is, respectively, a commit changing only `.docs/halted/other.md`, a commit changing `.docs/halted/demo.md` and `src/app.ts`, and a merge commit. In each, `deleteStackChildren` returns `kept` and `refs/heads/feat/c1/demo` still resolves to its L." | diff-local |
| Story 2 negative: Given a sealed child whose only unaccounted commit is a merge commit, when teardown runs, then that child branch is kept. | 7 | "Three fixtures are built in which child 1's only commit beyond P that H lacks is, respectively, a commit changing only `.docs/halted/other.md`, a commit changing `.docs/halted/demo.md` and `src/app.ts`, and a merge commit. In each, `deleteStackChildren` returns `kept` and `refs/heads/feat/c1/demo` still resolves to its L." | diff-local |
| Story 2 negative: Given a sealed child with no recorded pushed tip and an unaccounted commit not reachable from H, when teardown runs, then that child branch is kept, and the missing P is treated as contributing no reachable commits rather than as a failure. | 7 | "A fixture is built with no `refs/conductor/demo/pushed/feat/c1/demo` ref and a child-1 commit absent from H. `deleteStackChildren` returns `kept`, not `failed`, and `refs/heads/feat/c1/demo` still resolves to its L." | diff-local |
| Story 3 happy: Given a sealed child whose H is missing locally and whose fetch from `origin` fails, when teardown runs, then the result is `failed`, no child branch is deleted, and the conductor refs are not deleted. | 5 | "Case (a), with child 1's H missing locally and `fetch origin <H>` exiting 128: `deleteStackChildren` returns `failed`, both child branches still resolve, `refs/conductor/demo/publication`, `refs/conductor/demo/positions`, `refs/conductor/demo/pushed/feat/c1/demo` and `refs/conductor/demo/push-intent/feat/c1/demo` (created by the fixture) are still present, and the recorded calls contain no `update-ref --stdin` call." | diff-local |
| Story 3 negative: Given the local branch moves to a new commit after the proof read L, when the compare-and-swap delete runs, then it is refused, the result is `failed`, and the branch points at the new commit. | 5 | "Case (b), with the wrapper moving `refs/heads/feat/c1/demo` to a new commit after the proof read L and before the `update-ref -d` call: `deleteStackChildren` returns `failed`, `refs/heads/feat/c1/demo` resolves to the moved commit, and `refs/conductor/demo/publication` is still present." | diff-local |
| Story 3 negative: Given the commit-range read or the halt-record classification exits with an error, when teardown runs, then the result is `failed` and no later child branch is deleted. | 5 | "Case (c), with `rev-list` exiting 128 for child 1, and case (d), with `diff-tree` exiting 128 while child 1's listed commit is being classified: each makes `deleteStackChildren` return `failed`, its recorded calls contain no `update-ref -d refs/heads/feat/c3/demo`, and `refs/heads/feat/c3/demo` still resolves." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D1 | no-change | none | Publication eligibility from durable child state is untouched; only `stack-teardown.ts` changes. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D2 | no-change | none | The publication record schema and its CAS writes in `stack-publication-record.ts` are unchanged. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D3 | no-change | none | No FINISH publication transition is added or changed. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D4 | no-change | none | `establish_child_prs` pushing and opening is untouched. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D5 | no-change | none | `assemble_stack` retargeting and assembly are untouched. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D6 | no-change | none | Child and leaf body rendering is untouched. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D7 | no-change | none | The top-down ready flip is untouched. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D8 | no-change | none | Required-check contracts are untouched. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D9 | no-change | none | The ship gate is unchanged; teardown still runs only after the leaf merges and its shipped record reaches main. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D10 | no-change | none | `observeStackMemberLifecycle` and its events are untouched. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D11 | no-change | none | The published-stack freeze and the tip guard are untouched; teardown runs after the leaf merged and writes no remote ref. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D12 | task | task-4 | where L1 and L3 are the local tips read before the proof |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D13 | no-change | none | No new remote write; the only new remote operation is a `git fetch` read of the merged head by SHA. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D14 | no-change | none | No event is added; teardown's existing sweep log lines are unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D1 | task | task-4 | `deleteStackChildren` returns `kept`, `refs/heads/feat/c1/demo` still resolves to its L, and `refs/heads/feat/c3/demo` is absent. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D2 | no-change | none | The changed stack-member proof is recorded as a D1 amendment in this spec before it ships, as D2 requires. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D3 | no-change | none | The park sweep's refusal taxonomy is untouched; stack teardown keeps its `kept` result. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D4 | no-change | none | `ParkedSweepResult.counts` is untouched. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D5 | no-change | none | The ancestry and merged-PR head-identity proofs for park deletion are untouched. |

## Verification

- [ ] All happy-path criteria are covered by at least one task.
- [ ] All negative-path criteria are covered by at least one task.
- [ ] No task exceeds 5 minutes of work.
- [ ] Every task has a falsifiable `Done when:` block.
- [ ] Dependencies are explicit and acyclic.
