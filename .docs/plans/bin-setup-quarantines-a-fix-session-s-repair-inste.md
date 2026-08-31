# Implementation Plan: Setup fix-session repairs must converge (#1346)

**Date:** 2026-08-29
**Design:** [approved architecture review](../decisions/architecture-review-2026-08-29-bin-setup-quarantines-a-fix-session-s-repair-inste.md)
**Stories:** [accepted stories](../stories/bin-setup-quarantines-a-fix-session-s-repair-inste.md)
**Conflict check:** Clean as of 2026-08-29 after two operator-approved inherited-story corrections

## Summary

Make the bounded daemon setup fix-session converge by proving its original HEAD, snapshotting the
provider's complete Git tree, force-running setup, and retaining only an unchanged verified repair.
Fourteen small TDD tasks add the Git transaction, preserve rejected attempts before restoration,
and publish one typed repair disposition through the existing event spine.

## Technical Approach

- Keep the change inside `engine/setup-triage.ts` and the existing daemon-only
  `runSetupTriage` closure. Before provider dispatch, resolve the original HEAD and require an empty
  porcelain result. A failed precondition parks before dispatch and emits no `setup_repair`, because
  no repair session was attempted.
- Represent the provider candidate by a Git tree OID plus HEAD and paths. For dirty candidates,
  stage the complete worktree with `git add -A`, obtain the tree via `git write-tree`, then restore
  the clean-start index with `git reset --mixed <candidate-head>`; this preserves working-tree bytes
  while making modifications, deletions, modes, and untracked additions part of one comparable Git
  identity. Repeating that snapshot after forced setup makes setup-added drift a tree-ID mismatch.
- Partition success mechanically. An unchanged HEAD with no Git-visible change is
  `verified-no-tree-change`. A clean forward descendant of the original HEAD is
  `accepted-existing-commit`. An unchanged HEAD with a dirty, setup-stable candidate is staged and
  committed as `fix(setup): retain verified repair` through the existing worktree-rooted
  `makeGitRunner`, whose `git commit` path already sets `CONDUCT_ENGINE_COMMIT=1`. The engine then
  verifies the new parent, committed tree, HEAD, and final clean porcelain before `fixed-pass`.
- Do not reuse stage-1 `quarantine()` for rejected fix sessions: its `HEAD~1` reset assumes exactly
  one temporary commit. Add a repair-attempt preservation helper that gathers committed and
  uncommitted paths, creates a preservation commit only when residue exists, force-moves
  `wip/setup-quarantine-<slug>` to the complete attempted state, verifies that ref, and only then
  resets the feature branch to the original HEAD. Ref, commit, or verification failure performs no
  destructive restore; restoration failure retains the already-verified ref.
- Use this closed rejection vocabulary:
  `provider-failure`, `history-rewritten`, `mixed-commit-and-residue`,
  `setup-still-failing`, `setup-drift`, `snapshot-failed`, `repair-commit-failed`,
  `repair-postcondition-failed`, `preservation-failed`, and `restoration-failed`.
  `precondition-failed` is a pre-dispatch contract outcome, not a repair event reason.
- Add `setup_repair` to `ConductorEvent` as a discriminated success/rejection union. A single
  settlement helper in `fixSession` emits exactly once after every attempted fix-session terminal
  path; `runSetupTriage` passes its existing feature-scoped emitter. The exhaustive `EVENT_SINKS`
  registry declares render + persist, the daemon renderer writes one line, and `EventPersister`
  requires no new code.
- Follow the existing real-local-Git fixtures in `test/engine/setup-triage.test.ts`: isolated
  `mkdtemp`, pinned initial branch and local identity, no remotes, exact cleanup. Use injected
  provider and forced-prepare callbacks; ordinary tests never invoke a real LLM, third-party
  service, package command, or consumer `bin/setup` process.

## Prerequisites

- The #1346 amendment to `adr-2026-07-09-setup-failure-triage`, accepted stories, clean conflict
  report, and approved lightweight architecture review are present on this spec branch.
- No dependency, database, configuration, CLI, hook-wiring, or migration change is required.

## Tasks

### Task 1: Declare the repair event and exhaustive sink contract
**Story:** Story 4 — typed dispositions, closed rejection reasons, and sink omission failure
**Type:** infrastructure

**Steps:**
1. Write a failing event-sink registry test that constructs success and rejected `setup_repair`
   events and expects `{ render: true, persist: true, audit: false, otel: false }`.
2. Verify RED through the test-inclusive typecheck and the focused registry test.
3. Add exported repair disposition/rejection types and the discriminated `setup_repair` member to
   `ConductorEvent`; add the exhaustive sink declaration.
4. Verify GREEN, including that deleting the sink entry produces the compile-time missing-key
   failure supplied by `Record<ConductorEvent['type'], SinkDeclaration>`.
5. Commit with message: `feat(setup-triage): declare repair disposition event (#1346)`.

**Done when:**
1. `npm run typecheck:test` accepts all three success dispositions, the rejected variant, and all ten rejection reasons.
2. `test/event-sink-registry.test.ts` asserts render + persist and no audit/OTel subscription.
3. The exhaustive `EVENT_SINKS` record is the named mechanism preventing an undeclared sink.

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/event-sink-registry.test.ts`

**Dependencies:** none

### Task 2: Render one concise repair disposition line
**Story:** Story 4 — daemon-log visibility for accepted and rejected repairs
**Type:** happy-path

**Steps:**
1. Add failing renderer cases for `engine-committed`, `accepted-existing-commit`,
   `verified-no-tree-change`, and a rejected event with reason plus quarantine ref.
2. Verify RED in the focused renderer test.
3. Add one `setup_repair` switch case to `renderDaemonEventUnsafe`; render the disposition once and
   append rejection reason/ref only when present.
4. Verify GREEN and retain the renderer's existing catch-and-drop safety behavior.
5. Commit with message: `feat(daemon): render setup repair dispositions (#1346)`.

**Done when:**
1. Each success disposition renders one line naming that disposition.
2. A rejected event renders its closed reason and optional quarantine ref without inventing a ref.
3. `test/engine/daemon-render.test.ts` passes in isolation.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/daemon-render.test.ts`

**Dependencies:** Task 1

### Task 3: Snapshot a complete repair candidate as a Git tree
**Story:** Story 1 — exact candidate tree before and after forced setup
**Type:** infrastructure

**Steps:**
1. Add failing real-local-Git tests for a clean tree and for a candidate containing a tracked edit,
   deletion, executable-mode change, and untracked addition; assert HEAD/worktree content are
   unchanged after capture and the index is reset to the candidate HEAD.
2. Verify RED in `setup-triage.test.ts`.
3. Implement a focused snapshot helper returning HEAD, tree OID, dirty flag, and parsed paths via
   `status --porcelain`, `add -A`, `write-tree`, and `reset --mixed`; return a typed failure for
   every non-zero Git operation.
4. Verify GREEN and prove a second snapshot after a no-op callback returns the same tree OID.
5. Commit with message: `feat(setup-triage): capture exact repair tree (#1346)`.

**Done when:**
1. The real-Git fixture's tree resolves to the expected tracked edit, deletion, mode, and untracked file.
2. Snapshotting changes neither HEAD nor working-tree bytes, and leaves the index at HEAD.
3. Each `status`/`add`/`write-tree`/`reset --mixed` failure returns `snapshot-failed` in a table test.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** none

### Task 4: Preserve a complete rejected attempt before restoration
**Story:** Story 3 — provider commits and residue remain recoverable before reset
**Type:** happy-path

**Steps:**
1. Add failing real-local-Git tests for a clean provider-commit chain and for provider commits plus
   tracked/untracked residue; assert the quarantine ref contains the full attempted history/tree
   and is verified before restoration.
2. Verify RED in the focused setup-triage test.
3. Implement the repair-attempt preservation helper: union `git diff --name-only
   <original> <attempted>` with porcelain paths, make a preservation commit only for residue,
   force-move and verify the slug-scoped ref, then reset hard to the original HEAD.
4. Verify GREEN and leave the existing stage-1 `quarantine()` behavior unchanged.
5. Commit with message: `feat(setup-triage): preserve full rejected repair attempt (#1346)`.

**Done when:**
1. A clean rejected commit chain is reachable from the quarantine ref with no synthetic empty preservation commit.
2. A mixed commit-plus-residue attempt's ref contains both provider history and every residue path.
3. The feature branch restores to the original HEAD only after `rev-parse --verify` proves the ref.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 3

### Task 5: Accept verified no-change and clean forward-commit repairs
**Story:** Story 2 — existing safe repair outcomes remain accepted
**Type:** happy-path

**Steps:**
1. Replace/add failing `fixSession` tests for a provider that changes no Git state and for one or
   more clean commits that are forward descendants of the original HEAD.
2. Verify RED against the new disposition assertions.
3. Record/prove the original clean HEAD before provider dispatch; after dispatch classify ancestry,
   run the injected forced prepare once, and require HEAD plus the complete Git tree to remain
   unchanged before returning `fixed-pass` without an engine commit.
4. Add the precondition negative: dirty/indeterminate initial state parks as
   `precondition-failed`, dispatches no provider, and emits no repair event.
5. Commit with message: `feat(setup-triage): accept safe existing repair states (#1346)`.

**Done when:**
1. No-change repair returns `fixed-pass` without an empty commit.
2. A clean forward commit chain returns `fixed-pass` without an additional engine commit.
3. Initial HEAD/status failure or dirt dispatches zero fix sessions and returns
   `precondition-failed`.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 3

### Task 6: Commit an unchanged uncommitted repair exactly
**Story:** Story 1 — verified uncommitted repair becomes durable branch history
**Type:** happy-path

**Steps:**
1. Add a failing real-local-Git acceptance case whose injected fix callback creates a tracked edit
   and untracked addition without moving HEAD and whose injected prepare callback is a no-op.
2. Verify RED: current behavior quarantines and parks.
3. On unchanged original HEAD plus a dirty candidate, snapshot before and after prepare, require
   equal tree OIDs, stage/commit with `fix(setup): retain verified repair`, then verify parent,
   committed tree, HEAD, and empty porcelain.
4. Verify GREEN and assert the fix callback and prepare callback each ran exactly once before the
   normal continuation sentinel is reached.
5. Commit with message: `fix(setup-triage): retain verified uncommitted repair (#1346)`.

**Done when:**
1. The feature branch advances by one commit whose parent is the original HEAD and whose tree equals the pre-setup candidate tree.
2. The committed tree contains both the tracked edit and untracked addition, and porcelain is empty.
3. The acceptance fixture observes one fix dispatch, one forced-prepare callback, and continuation.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`
- `src/conductor/test/acceptance/bin-setup-quarantines-a-fix-session-s-repair-inste.acceptance.test.ts`

**Dependencies:** Task 3, Task 5

### Task 7: Reject a still-failing setup without inventing a repair
**Story:** Story 2 negative — no-change failure creates no empty commit; Story 3 preservation rule
**Type:** negative-path

**Steps:**
1. Add failing tests for a no-change provider whose forced prepare throws and a clean provider
   commit whose forced prepare throws.
2. Verify RED against the expected `setup-still-failing` outcomes.
3. Route no-change failure directly to park with no commit/ref; route a changed attempt through the
   full preservation helper before restoring the original HEAD.
4. Verify GREEN and preserve the original setup error tail in the outcome.
5. Commit with message: `fix(setup-triage): preserve changed repairs when setup still fails (#1346)`.

**Done when:**
1. No-change failure creates neither an empty commit nor a quarantine ref.
2. A committed repair that still fails setup is reachable from the quarantine ref before restore.
3. Both cases park with `setup-still-failing` and never return `fixed-pass`.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 4, Task 5

### Task 8: Reject setup-added or setup-altered Git drift
**Story:** Story 1 negative — forced setup must not contaminate the candidate
**Type:** negative-path

**Steps:**
1. Add failing real-local-Git cases where the injected prepare callback modifies the candidate,
   deletes one candidate path, and adds a new untracked path.
2. Verify RED against the expected `setup-drift` preserve-and-park outcome.
3. Compare the pre/post setup tree OIDs and route every mismatch through full-attempt preservation;
   never stage the mismatched tree as the accepted repair commit.
4. Verify GREEN and assert the quarantine ref contains the complete post-setup attempted state
   before the feature branch returns to the original HEAD.
5. Commit with message: `fix(setup-triage): reject setup drift from repair commits (#1346)`.

**Done when:**
1. Modified, deleted, and newly added setup-drift fixtures all produce `setup-drift`.
2. No accepted repair commit remains on the feature branch in any drift fixture.
3. Each quarantine ref contains the attempted state that existed immediately before restoration.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 4, Task 6

### Task 9: Reject rewritten history and mixed commits with residue
**Story:** Story 2 negative and Story 3 happy — off-contract history remains recoverable
**Type:** negative-path

**Steps:**
1. Add failing real-local-Git cases where the provider rewrites away the original HEAD and where it
   creates forward commits plus uncommitted residue.
2. Verify RED against `history-rewritten` and `mixed-commit-and-residue`.
3. Classify ancestry with `merge-base --is-ancestor` and partition clean commits from residue before
   prepare acceptance; send both rejected classes through full-attempt preservation.
4. Verify GREEN, including committed path names in `preservedPaths` and restoration to the original
   HEAD only after ref verification.
5. Commit with message: `fix(setup-triage): reject unsafe repair history shapes (#1346)`.

**Done when:**
1. Non-forward history cannot return `fixed-pass` and is preserved under `history-rewritten`.
2. Forward commits plus any residue cannot return `fixed-pass` and are preserved under
   `mixed-commit-and-residue`.
3. The mixed fixture's quarantine ref retains both provider commits and residue in one reachable
   history.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 4, Task 5

### Task 10: Reject repair-commit and postcondition failures
**Story:** Story 1 negative and Story 3 happy — failed engine transaction is recoverable
**Type:** negative-path

**Steps:**
1. Add failing injected-Git cases for commit failure and for each postcondition family: wrong
   parent, wrong committed tree/HEAD, and final dirty porcelain.
2. Verify RED against `repair-commit-failed` or `repair-postcondition-failed` as applicable.
3. Funnel each failure through the full-attempt preservation helper and restore only after its ref
   verification; include the failed postcondition in `outputTail`.
4. Verify GREEN and assert no failure path reports `fixed-pass` or a clean/restored claim it did not
   prove.
5. Commit with message: `fix(setup-triage): fail closed on repair commit postconditions (#1346)`.

**Done when:**
1. Commit exit failure produces `repair-commit-failed` and preserves the candidate when possible.
2. Parent, tree/HEAD, and porcelain mismatches each produce `repair-postcondition-failed` naming the
   failed check.
3. Every case either restores after a verified ref or leaves the attempted state in place.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 4, Task 6

### Task 11: Make preservation and restoration failures non-destructive
**Story:** Story 3 — preservation failure, ref refresh failure, and restoration failure
**Type:** negative-path

**Steps:**
1. Add failing fault-injection cases for residue commit failure, force-refresh failure over an
   existing ref, ref-verification failure, and reset-hard failure after a verified ref.
2. Verify RED in the focused setup-triage test.
3. Return `preservation-failed` before any destructive restore for commit/ref/verification faults;
   return `restoration-failed` with the durable ref after reset failure.
4. Verify GREEN and assert an older ref is never reported as proof of the current attempt.
5. Commit with message: `fix(setup-triage): retain rejected state on recovery faults (#1346)`.

**Done when:**
1. Commit, ref-refresh, and ref-verification failures execute zero `reset --hard <original>` calls.
2. Reset failure reports `restoration-failed` and the refreshed ref still resolves to the complete
   attempted state.
3. The outcome never claims restored/clean state unless both ref verification and reset succeeded.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 4, Task 8, Task 9, Task 10

### Task 12: Emit exactly one success disposition per attempted fix-session
**Story:** Story 4 happy — all accepted terminal dispositions are structured occurrences
**Type:** happy-path

**Steps:**
1. Add failing emitter-spy cases around the no-change, clean-forward-commit, and exact-engine-commit
   paths.
2. Verify RED because `fixSession` currently emits no repair event.
3. Add one settlement helper used by every post-dispatch return; accept an optional injected feature
   emitter and emit `verified-no-tree-change`, `accepted-existing-commit`, or `engine-committed`.
4. Verify GREEN and assert the precondition-failed/no-dispatch path emits zero events.
5. Commit with message: `feat(setup-triage): emit successful repair dispositions (#1346)`.

**Done when:**
1. Each accepted repair shape emits exactly one `setup_repair` with its matching disposition.
2. No accepted path emits `rejected`, and no path emits more than once.
3. Precondition refusal before provider dispatch emits no `setup_repair`.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 1, Task 5, Task 6

### Task 13: Emit one closed rejection disposition for every attempted failure
**Story:** Story 4 happy/negative — rejected event reason, ref accuracy, and provider failure
**Type:** negative-path

**Steps:**
1. Add a failing table test that drives all ten closed rejection reasons through their owning
   terminal paths and records emitted events.
2. Verify RED against missing or duplicate events.
3. Route every attempted-session rejection through the settlement helper; attach a quarantine ref
   and paths only after current-attempt preservation succeeds, and emit `provider-failure` without
   an invented ref when dispatch throws before changing state.
4. Verify GREEN and assert the returned HALT evidence fields agree with the emitted reason/ref.
5. Commit with message: `feat(setup-triage): emit closed repair rejection evidence (#1346)`.

**Done when:**
1. The table covers provider, history, mixed residue, setup failure, setup drift, snapshot, repair commit, repair postcondition, preservation, and restoration rejection reasons.
2. Every row emits exactly one rejected event and returns a park outcome with the same reason.
3. Only successfully preserved rows carry the current attempt's ref; provider/preservation failures
   carry none.

**Files:**
- `src/conductor/src/engine/setup-triage.ts`
- `src/conductor/test/engine/setup-triage.test.ts`

**Dependencies:** Task 7, Task 8, Task 9, Task 10, Task 11, Task 12

### Task 14: Wire feature-scoped persistence, rendering, and durable park behavior
**Story:** Story 3 scan/unpark bound; Story 4 persistence, HALT evidence, and unaffected-path silence
**Type:** infrastructure

**Steps:**
1. Add failing wiring/acceptance cases proving production `runSetupTriage` passes `featureEvents` to
   `fixSession`, a terminal event reaches a real `EventPersister` and renderer once, and ordinary
   setup/stage-1-only recovery produces no `setup_repair` record.
2. Add a focused rejected-repair case to the existing automatic-park acceptance fixture: subsequent
   backlog scans invoke zero additional triage sessions; explicit unpark permits one new attempt.
3. Verify RED for missing event wiring while the existing generic park behavior remains green.
4. Pass the feature emitter at the production call site; rely on the existing feature persister,
   renderer subscription, HALT formatter, and durable park boundary rather than adding another
   writer or state file.
5. Verify GREEN and commit with message: `feat(daemon): persist setup repair outcomes on feature spine (#1346)`.

**Done when:**
1. The production call structurally passes its feature-scoped emitter, and one emitted event yields exactly one `events.jsonl` record plus one rendered daemon line.
2. A rejected HALT names its reason, current quarantine ref/paths when present, or the preservation
   failure when absent; ordinary setup and stage-1-only recovery write no `setup_repair` record.
3. After a rejected repair parks, repeated backlog discovery dispatches zero new fix sessions until
   unpark; after unpark, at most one new attempt runs before a fresh park.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/daemon-cli-setup-triage.test.ts`
- `src/conductor/test/acceptance/bin-setup-quarantines-a-fix-session-s-repair-inste.acceptance.test.ts`
- `src/conductor/test/acceptance/automatic-park-outcome-writes-no-park-marker-so-an.acceptance.test.ts`

**Dependencies:** Task 2, Task 11, Task 13

## Task Dependency Graph

```text
Task 1 ──> Task 2
   │
   ├──────────────────────────────> Task 12 ──> Task 13 ──> Task 14
   │                                   ▲           ▲
Task 3 ──> Task 4 ──┬─> Task 7 ────────┘           │
   │                ├─> Task 8 ─────────────────────┤
   ├─> Task 5 ──────┼─> Task 9 ─────────────────────┤
   │      │         └─> Task 10 ─> Task 11 ─────────┘
   └──────┴─> Task 6 ────────────────┘
```

## Integration Points

- After Task 6: the three accepted repair shapes are mechanically distinguishable and the
  uncommitted path produces an exact, verified engine commit.
- After Task 11: every state-changing rejection is either reachable from the slug-scoped ref before
  restore or remains untouched in the worktree when preservation fails.
- After Task 14: the production feature emitter persists/renders the disposition and the existing
  HALT/park boundary prevents automatic redispatch of a rejected repair.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| S1 happy — exact stable repair commit, original parent/tree, clean continuation | 3, 6 |
| S1 negative — setup changes candidate | 8 |
| S1 negative — commit or parent/tree/HEAD/porcelain postcondition failure | 10 |
| S2 happy — clean forward provider commits, no extra commit | 5 |
| S2 happy — no Git change, no empty commit | 5 |
| S2 negative — rewritten history or commits plus residue | 9 |
| S2 negative — no-change setup still fails | 7 |
| S3 happy — complete attempted state preserved before original-HEAD restore | 4, 8, 9, 10 |
| S3 happy — preservation failure performs no reset | 11 |
| S3 happy — repeated scans dispatch no additional fix-session | 14 |
| S3 negative — existing ref refresh failure is not false proof | 11 |
| S3 negative — restoration failure retains ref and accurate evidence | 11 |
| S3 negative — explicit unpark permits at most one new rotation attempt | 14 |
| S4 happy — exactly one of four dispositions per attempted session | 12, 13 |
| S4 happy — persisted/rendered once; rejected HALT carries durable evidence | 1, 2, 14 |
| S4 negative — provider failure has no invented ref | 13 |
| S4 negative — ordinary setup/stage-1 recovery emits no repair event | 14 |
| S4 negative — omitted sink/renderer/persister wiring fails verification | 1, 2, 14 |

## Verification

- [ ] `cd src/conductor && npm test -- test/engine/setup-triage.test.ts test/event-sink-registry.test.ts test/engine/daemon-render.test.ts test/engine/daemon-cli-setup-triage.test.ts test/acceptance/bin-setup-quarantines-a-fix-session-s-repair-inste.acceptance.test.ts test/acceptance/automatic-park-outcome-writes-no-park-marker-so-an.acceptance.test.ts` prints `AGGREGATE_TEST_SUITE_PASS`.
- [ ] `cd src/conductor && npm run typecheck:test` exits 0 and covers source plus tests.
- [ ] `cd src/conductor && npm run lint` exits 0 with zero warnings.
- [ ] The configured aggregate `cd src/conductor && npm test` completes under five minutes and
      prints `AGGREGATE_TEST_SUITE_PASS` at the normal test-suite gate.
- [ ] All happy and negative story criteria map to tasks above; all task dependencies are explicit
      and acyclic; no task is a terminal catch-all validation task.
