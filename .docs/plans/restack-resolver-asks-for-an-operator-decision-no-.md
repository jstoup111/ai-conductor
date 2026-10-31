# Implementation Plan: Restack resolver accepts an operator decision (#3478)

**Date:** 2026-10-31
**Stories:** .docs/stories/restack-resolver-asks-for-an-operator-decision-no-.md
**Conflict check:** Clean as of 2026-10-31 (1 degrading conflict resolved; `.docs/conflicts/2026-10-31-restack-resolver-asks-for-an-operator-decision-no-.md`)
**Architecture:** `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`; `architecture-review-2026-10-31-restack-resolver-asks-for-an-operator-decision-no-` (APPROVED)

## Summary

The plan has 15 tasks. They add `stack restack-resolve --decision`, a decision ref the next restack hands to the provider resolver, and a `restack_decision` event. They also extend #3522's conflict record, its recipe and its tip consumption from `feature-repair` to `base-refresh` restacks.

## Technical Approach

- **Durable decision.**
  - `restack/restack-conflict-record.ts` gains the decision ref family `refs/conductor/<slug>/restack/decision/c<k>`. It holds a JSON blob of child, `oldParent`, `oldTip`, commit, paths, answer (1–4,000 characters) and operator.
  - It gains a fail-closed parser that mirrors `parseConflictRecord`, and a matcher on child, `oldParent` and `oldTip`.
  - It gains one transaction writer that writes one answer kind and deletes the other kind for the same child with compare-and-swap. It also gains `decisionDeleteLines`.
  - `featureConductorRefNames` adds the decision ref for every child id.
- **Event.** A new `ConductorEvent` member, `restack_decision {child, action: 'recorded' | 'applied' | 'stale', commit, paths, operator?, opId?}`, is registered in `EVENT_SINKS` with the same flags as `restack_resolution`.
- **Both causes.**
  - `haltRecordedRestackConflict` drops its `cause === 'feature-repair'` gate for the record and recipe. `haltRestackConflict` in `restack-move.ts` prints the `--decision` command beside the shipped `--tip` recipe.
  - The `cause === 'feature-repair'` guards around `consumeRecordedResolution` in `runRestack` and `resumePlanned` are lifted. A base-refresh tip is then consumed by the same tree-matched rebuild.
- **Delivery.**
  - **Lookup.** Before each `resolveRestackConflict` call, `runRestack` and `resumePlanned` read the child's decision ref.
  - **Match.** A matching decision is passed as `operatorDecision` on `ResolveRestackConflictOptions`. `restack-resolver.ts` spreads it into the `RestackResolutionContext`, and `ResolutionContext` (`rebase.ts`) gains the optional field. The engine emits `restack_decision` `applied` first.
  - **No match.** A non-matching decision emits `stale` and is not passed. A malformed blob is not passed and is named in any escalation halt.
  - **Prompt.** `StepRunner.resolveRebaseConflict` adds one prompt paragraph only when `operatorDecision` is present.
- **Lifecycle.**
  - **Journal.** A decision-assisted `resolved` status records `deliveredDecision {child, blob}` in the journal, beside `consumedResolution` (`restack-journal.ts`).
  - **Move and apply.** `applyRestackMove` verifies it, and `appliedTransactionLines` deletes it with the conflict refs. An abort or halt keeps it.
  - **Escalation.** The conflict halt detail names an applied or stale decision.
- **CLI.**
  - `cli.ts` and `cli-pre-dispatch.ts` accept exactly one of `--tip` and `--decision`.
  - `dispatchStackRestackResolve` reuses its daemon-session refusal, its lease and its record and live-HALT checks. It then writes through the transaction writer, appends `restack_decision` `recorded`, and calls `clearHaltAtomically`.
- **Local pattern.** Every new piece copies #3522's shape. The decision blob mirrors the conflict-record blob (`writeConflictRecord` / `readConflictRecord`). The CLI decision path mirrors the tip path's order: ref, event, clear, with "recorded but could not" on a late failure. Real-git tests extend the fixtures in `test/engine/restack/restack-conflict-record.realgit.test.ts` and `restack-recovery-conflict-recipe.realgit.test.ts`. Search hints: `conflictRecordRefFor`, `consumedResolutionVerifyLines`, `appendRecordedResolution`.
- **Sequencing.** Event and decision-ref infrastructure come first (Tasks 1–2), then both causes (3–5), the CLI (6–8), resolver context (9), delivery (10–12), escalation (13–14) and parity (15).

## Prerequisites

- #3522 (`stack restack-resolve --tip`, the conflict record, `consumedResolution`) is on main at `2bd1d440f8`.

## Tasks

### Task 1: `restack_decision` event member
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and `src/conductor/test/engine/restack/restack-resolution-events.test.ts` for every Done-when check below.
2. Implement: add the `restack_decision` member to `ConductorEventBody` in `types/events.ts`, and register it in `EVENT_SINKS` with `render: false, persist: true, audit: false, otel: false`.
3. Verify GREEN and commit.

**Done when:**
- [test] `restack-resolution-events.test.ts` persists a `restack_decision` event with `action: recorded`, child 2, commit, paths and operator through `EventPersister` to `.pipeline/events.jsonl`, and reads it back with those fields.
- [test] `event-sinks.test.ts` asserts `EVENT_SINKS.restack_decision` exists with `persist: true` and the union's exhaustive sink check still compiles.
- The `restack_decision` type in `types/events.ts` admits only `action` values `recorded`, `applied` and `stale`, and has no field that carries the answer text.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new member
- `src/conductor/src/engine/event-sinks.ts` — sink registration
- `src/conductor/test/engine/event-sinks.test.ts` — registration test
- `src/conductor/test/engine/restack/restack-resolution-events.test.ts` — persistence test

**Dependencies:** none

### Task 2: Decision ref, fail-closed parser, cross-kind transaction and teardown
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` and `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` for every Done-when check below.
2. Implement in `restack-conflict-record.ts`, following `writeConflictRecord` / `readConflictRecord`:
   - `decisionRefFor`, `writeRestackDecision`, `readRestackDecision` (fail-closed: `missing`, `unreadable` or `decision`) and `decisionMatchesRange`;
   - `recordAnswer`, which runs one `git update-ref --stdin` transaction that writes one answer kind and deletes the other kind's ref for the same child, both with compare-and-swap;
   - `decisionDeleteLines`.

   Add `restack/decision/c<k>` for every child id to `featureConductorRefNames`.
3. Verify GREEN and commit.

**Done when:**
- [test] `restack-conflict-record.realgit.test.ts` writes a decision for child 2 and reads back child 2, oldParent, oldTip, commit, paths, answer and operator, and `readRestackDecision` returns `unreadable` for a blob with a missing field, a bad sha or an empty answer.
- [test] The same test asserts `recordAnswer` with a decision deletes an existing `restack/resolution/c2` and writes `restack/decision/c2` in one transaction, and with a tip deletes `restack/decision/c2`, and that a changed expected old value fails the whole transaction with neither ref changed.
- [test] `decisionMatchesRange` returns true only when child, oldParent and oldTip all equal the range's, and false when any one differs.
- [test] `restack-refs-cleanup.test.ts` asserts feature teardown deletes `refs/conductor/demo/restack/decision/c<k>` by name for every child id of `demo` and leaves every ref under `refs/conductor/other/`, including `refs/conductor/other/restack/decision/c1`, unchanged.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-record.ts` — decision ref helpers
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts` — teardown names
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` — helper tests
- `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` — teardown test

**Dependencies:** none

### Task 3: A base-refresh conflict halt writes the conflict record and moves nothing
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts`, using a `base-refresh` restack of the three-slice stack that conflicts replaying child 2's commit on `src/flag.ts`, for every Done-when check below.
2. Implement: remove the `cause === 'feature-repair'` gate from `haltRecordedRestackConflict` in `restack-conflict-halt.ts`. Use the resolver's ordered replay-candidate subjects for a base-refresh record. Pass the recipe for both causes.
3. Verify GREEN and commit.

**Done when:**
- [test] After a base-refresh conflict on child 2, `readConflictRecord` returns a record naming child 2, the run's opId, child 2's oldParent and oldTip, the new parent and its tree id, the ordered replay-candidate subjects, the conflicting commit and `src/flag.ts`, and `restack/conflict/parent` names the new parent.
- [test] The same test asserts no `refs/heads/feat/*` ref, no `refs/conductor/demo/closed/*` ref and the default-branch ref are unchanged from before the restack.
- [test] A base-refresh restack of a stack whose child 2 range contains a merge commit halts with the shipped `flatten_refused` reason and text, and no `refs/conductor/demo/restack/conflict/*` ref exists.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-halt.ts` — cause gate removed
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` — base-refresh fixtures

**Dependencies:** Task 2

### Task 4: Conflict halt text carries both recipes for both causes, from executor and recovery
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-recovery-conflict-recipe.realgit.test.ts` for every Done-when check below.
2. Implement: `haltRestackConflict` in `restack-move.ts` appends the line `ai-conductor stack restack-resolve --slug <slug> --child <k> --decision "<answer>"` after the shipped `--tip` line, for both causes.
3. Verify GREEN and commit.

**Done when:**
- [test] For a base-refresh conflict on child 2, `.pipeline/HALT` contains `Restack-Conflict: 2 <opId>`, the `git switch -c restack-resolve/demo/c2 <old tip>` and `git rebase --onto <new parent> <old parent>` lines with real shas, the `--tip <sha>` command and `ai-conductor stack restack-resolve --slug demo --child 2 --decision "<answer>"`.
- [test] For a repair conflict on child 2, `.pipeline/HALT` contains the shipped `--tip` recipe and also the `--decision` command line.
- [test] A base-refresh conflict halt written by `resumePlanned` resuming a planned journal produces the same conflict record fields and the same HALT recipe lines as the executor-written halt.
- [test] Neither halt text contains an instruction to rebase or commit on `feat/c2/demo` or `feat/daemon-demo`, or to move any `refs/conductor/demo/*` ref by hand.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-move.ts` — recipe text
- `src/conductor/test/engine/restack/restack-recovery-conflict-recipe.realgit.test.ts` — halt text tests

**Dependencies:** Task 3

### Task 5: A recorded base-refresh tip is consumed, or halts as stale
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` for every Done-when check below.
2. Implement: lift the `cause === 'feature-repair'` guard around `consumeRecordedResolution` in `runRestack` (`restack-executor.ts`) and `resumePlanned` (`restack-recovery.ts`).
3. Verify GREEN and commit.

**Done when:**
- [test] After a base-refresh conflict on child 2 and a valid tip recorded through `dispatchStackRestackResolve`, the next base-refresh `runRestack` onto a default with the recorded parent's tree applies, emits `restack_resolution` with `action: consumed`, and moves `feat/c2/demo` and `refs/conductor/demo/closed/c2` to the rebuilt commits, with no test step writing any ref.
- [test] When the default branch advanced after the recorded tip so the parent tree differs, `runRestack` halts `restack-resolution-stale` naming the parent tree, leaves every `feat/` and `closed/` ref unchanged, and keeps `restack/resolution/c2` and `restack/conflict/record`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — guard lifted
- `src/conductor/src/engine/restack/restack-recovery.ts` — guard lifted
- `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` — base-refresh consumption tests

**Dependencies:** Task 3

### Task 6: `stack restack-resolve --decision` records the decision and clears the halt
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/stack-restack-resolve-decision.realgit.test.ts` that drive the CLI through `dispatchStackRestackResolve`, for every Done-when check below.
2. Implement:
   - **Parsing.** `cli.ts` (the `restack-resolve` command and its pre-dispatch parser) and `cli-pre-dispatch.ts` accept `--decision <answer>` as an alternative to `--tip`.
   - **Command.** `dispatchStackRestackResolve` runs its shipped checks, then:
     - writes through `recordAnswer`;
     - appends `restack_decision` `recorded` with the identity from `resolveMachineOperatorIdentity`;
     - calls `clearHaltAtomically`;
     - prints `stack restack-resolve: recorded decision for child <k>`.
3. Verify GREEN and commit.

**Done when:**
- [test] For a repair conflict and for a base-refresh conflict on child 2, the decision command exits 0, `readRestackDecision` returns the answer with child 2, oldParent, oldTip, commit, `src/flag.ts` and the operator, and `.pipeline/HALT` and `.pipeline/HALT.class` no longer exist.
- [test] `.pipeline/events.jsonl` gains exactly one `restack_decision` event with `action: recorded`, child 2, commit, paths `["src/flag.ts"]` and the operator, and the serialized event does not contain the answer string.
- [test] With a decision already recorded for child 2 and a later live conflict halt on child 2, running the command with a different answer exits 0 and `readRestackDecision` returns the new answer, written by compare-and-swap against the prior blob.
- [test] With `restack/resolution/c2` recorded and the conflict HALT still live because its clear failed, `--decision` exits 0, `restack/resolution/c2` no longer exists, `restack/decision/c2` holds the answer, both changed by the one `recordAnswer` transaction, and `.pipeline/HALT` is removed, and the transaction compare-and-swaps each ref against its expected old value so a changed old value fails it with neither ref changed.
- [test] With `restack/decision/c2` recorded and the conflict HALT still live because its clear failed, `--tip <valid sha>` exits 0, `restack/decision/c2` no longer exists and `restack/resolution/c2` names the tip, both changed by the one `recordAnswer` transaction, which compare-and-swaps each ref against its expected old value.

**Files likely touched:**
- `src/conductor/src/cli.ts` — flag and dispatch shape
- `src/conductor/src/cli-pre-dispatch.ts` — pre-dispatch parse
- `src/conductor/src/engine/stack-restack-resolve-cli.ts` — decision path
- `src/conductor/test/engine/stack-restack-resolve-decision.realgit.test.ts` — CLI tests

**Dependencies:** Tasks 1, 2

### Task 7: `--decision` refuses invalid input, the wrong child, a missing halt and an unstacked feature
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-restack-resolve-decision.realgit.test.ts` for every Done-when check below. Each test snapshots every ref under `refs/conductor/demo/`, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` before the run.
2. Implement the refusals in the pre-dispatch parser and `dispatchStackRestackResolve`, each printing `stack restack-resolve: refused — <cause>` and exiting 1.
3. Verify GREEN and commit.

**Done when:**
- [test] Passing both `--tip` and `--decision`, or neither, exits 1 with `stack restack-resolve: refused — ` naming the flag conflict, and every `refs/conductor/demo/*` ref, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` equal their snapshots.
- [test] An empty answer and a 4,001-character answer each exit 1 with a refusal naming the answer length, and every `refs/conductor/demo/*` ref, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` equal their snapshots.
- [test] With the conflict record naming child 3, `--child 2 --decision` exits 1 with `record names child 3`, and every `refs/conductor/demo/*` ref, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` equal their snapshots.
- [test] With no live HALT carrying `Restack-Conflict: 2 <opId>`, including after a `--tip` run already cleared it, `--decision` exits 1 with `no matching restack-conflict halt is live`, and every `refs/conductor/demo/*` ref, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` equal their snapshots.
- [test] For a flat N=1 feature with no child state, and for a feature run with `stacked_prs.enabled: false`, `--decision` exits 1 with `feature is not stacked`, and every `refs/conductor/<slug>/*` ref, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` equal their snapshots.

**Files likely touched:**
- `src/conductor/src/cli-pre-dispatch.ts` — flag refusals
- `src/conductor/src/engine/stack-restack-resolve-cli.ts` — answer and record refusals
- `src/conductor/test/engine/stack-restack-resolve-decision.realgit.test.ts` — refusal tests

**Dependencies:** Task 6

### Task 8: `--decision` refuses an unavailable lease and a daemon session, and survives partial failure
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-restack-resolve-decision.realgit.test.ts` and `src/conductor/test/execution/daemon-session-enforcement.test.ts` for every Done-when check below. Inject `acquireLease`, `appendEvent` and `resolveOperator` through `StackRestackResolveDeps`, and race the ref write with a concurrent `update-ref`.
2. Implement: a compare-and-swap failure from `recordAnswer` prints `stack restack-resolve: refused — could not record decision`. Late failures reuse the tip path's `recorded but could not` messages.
3. Verify GREEN and commit.

**Done when:**
- [test] With the feature dispatch lease held by another owner, `--decision` exits 1 with the lease refusal naming that owner, and every `refs/conductor/demo/*` ref, `.pipeline/events.jsonl`, `.pipeline/HALT` and `.pipeline/HALT.class` equal their pre-run snapshots.
- [test] `daemon-session-enforcement.test.ts` asserts `stack restack-resolve --decision` inside a daemon session is refused as a non-sanctioned subcommand before any feature read, and writes nothing.
- [test] When the decision ref changes concurrently between read and write, the command exits 1 with `could not record decision`, `.pipeline/HALT` is still present, and the ref holds the concurrent value.
- [test] When the event append fails or no operator identity is available after the ref write, the command exits 1 with `stack restack-resolve: recorded but could not` naming that step, `.pipeline/HALT` is still present, and rerunning with a working append exits 0 and removes the HALT.

**Files likely touched:**
- `src/conductor/src/engine/stack-restack-resolve-cli.ts` — failure messages
- `src/conductor/test/engine/stack-restack-resolve-decision.realgit.test.ts` — failure tests
- `src/conductor/test/execution/daemon-session-enforcement.test.ts` — daemon-session refusal

**Dependencies:** Task 6

### Task 9: The resolver context and prompt carry an operator decision only when present
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolver-wiring.test.ts` and `src/conductor/test/engine/rebase-resolution-runner.test.ts` for every Done-when check below.
2. Implement:
   - `ResolutionContext.operatorDecision?: { answer; commit; paths }` in `rebase.ts`;
   - `ResolveRestackConflictOptions.operatorDecision`, spread into the context passed to `options.resolver` in `restack-resolver.ts`;
   - in `StepRunner.resolveRebaseConflict` (`step-runners.ts`), one paragraph appended only when it is present: `Operator decision for commit <commit> on <paths>: <answer>. Apply this decision; do not escalate the same question again.`
3. Verify GREEN and commit.

**Done when:**
- [test] `restack-resolver-wiring.test.ts` passes `operatorDecision` to `resolveRestackConflict` and asserts the resolver wired in `daemon-cli.ts` reaches `stepRunner.resolveRebaseConflict` with a context whose `operatorDecision` carries the answer, commit and paths.
- [test] `rebase-resolution-runner.test.ts` asserts the `resolveRebaseConflict` prompt with `operatorDecision` contains `Operator decision for commit <C> on src/flag.ts: keep upstream's resolveReviewScope seam`, the instruction `Apply this decision;` and the sentence `do not escalate the same question again`.
- [test] The same test asserts the prompt built for a flat feature's plain rebase context without `operatorDecision` is byte-identical (`toBe`) to the prompt captured from the pre-change implementation.

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — context field
- `src/conductor/src/engine/restack/restack-resolver.ts` — option spread
- `src/conductor/src/engine/step-runners.ts` — prompt paragraph
- `src/conductor/test/engine/restack/restack-resolver-wiring.test.ts` — wiring test
- `src/conductor/test/engine/rebase-resolution-runner.test.ts` — prompt tests

**Dependencies:** none

### Task 10: The routed exit restack delivers a matching decision, applies, and deletes it
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts`. They use the fake resolver at `requestRoutedExit`'s resolver seam, for every Done-when check below.
2. Implement in `runRestack`, before each `resolveRestackConflict` call:
   - read `readRestackDecision`. On a match, emit `restack_decision` `applied` with child and opId, then pass `operatorDecision`;
   - record `deliveredDecision {child, blob}` with the `resolved` status through `updateRestackChildStatus` (`restack-journal.ts`, parsed fail-closed like `consumedResolution`);
   - extend `consumedResolutionVerifyLines` in `restack-move.ts` and the applied lines in `restack-executor.ts` with the decision `verify` and `decisionDeleteLines`.
3. Verify GREEN and commit.

**Done when:**
- [test] After a recorded decision for a repair conflict on child 2, the next `requestRoutedExit` restack calls the fake resolver with a context carrying the answer, commit and `src/flag.ts`, and `.pipeline/events.jsonl` holds `restack_decision` `applied` with child 2 and the running opId before the resolver returns.
- [test] With the fake resolver settling child 2, the restack applies through `applyRestackMove`, `feat/c2/demo` and `refs/conductor/demo/closed/c2` name the resolved commits, the revalidation queue lists child 2 before the leaf, and no `closed-child-rewritten` divergence is reported by `resolveActiveChild`.
- [test] After that applied restack, `restack/decision/c2`, `restack/conflict/record` and `restack/conflict/parent` no longer exist.
- [test] `parseJournal` accepts a journal with `deliveredDecision`, and returns `undefined` for one whose `deliveredDecision` has a malformed child or blob sha.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — decision lookup and applied lines
- `src/conductor/src/engine/restack/restack-journal.ts` — `deliveredDecision` field
- `src/conductor/src/engine/restack/restack-move.ts` — verify lines
- `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` — delivery tests

**Dependencies:** Tasks 2, 9

### Task 11: Delivery holds for base-refresh, for a replaced tip, and under concurrent change or abort
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` for every Done-when check below.
2. Implement whatever the tests expose in `runRestack` and `applyRestackMove`.
3. Verify GREEN and commit.

**Done when:**
- [test] After a recorded decision for a base-refresh conflict on child 2 and an advanced default branch, the next base-refresh `runRestack` passes the decision to the fake resolver and emits `restack_decision` `applied` with child 2.
- [test] After a tip recorded for child 2 is replaced by `--decision` through `dispatchStackRestackResolve`, the next restack emits no `restack_resolution` `consumed` for child 2 and passes the decision to the fake resolver.
- [test] When `restack/decision/c2` is rewritten after delivery and before the move, `applyRestackMove` fails its compare-and-swap, no `feat/` or `closed/` ref moves, and the restack halts `stack-ref-changed` naming `restack/decision/c2`.
- [test] When a restack that delivered the decision aborts or halts for another reason, `restack/decision/c2` still names the recorded blob.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — base-refresh delivery
- `src/conductor/src/engine/restack/restack-move.ts` — verify failure naming
- `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` — negative tests

**Dependencies:** Tasks 5, 6, 10

### Task 12: Journal recovery delivers a matching decision too
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` for every Done-when check below.
2. Implement in `resumePlanned` (`restack-recovery.ts`) the same lookup, the `applied` and `stale` events, the `operatorDecision` pass-through and the `deliveredDecision` record as Task 10. Recovery's apply path verifies and deletes it through the shared move and applied lines.
3. Verify GREEN and commit.

**Done when:**
- [test] With a recorded decision for child 2 and a planned journal resumed by `resumePlanned`, the fake resolver receives a context carrying the answer, and `restack_decision` `applied` with child 2 is persisted.
- [test] The resumed restack applies, and afterwards `restack/decision/c2` no longer exists and `feat/c2/demo` names the resolved commit.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts` — recovery delivery
- `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` — recovery tests

**Dependencies:** Task 10

### Task 13: An ignored decision escalates with the decision named and kept
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts`. They use a fake resolver that ignores the decision and returns unresolved, for every Done-when check below.
2. Implement: when a delivered decision ends in an unresolved conflict, `haltUnresolvedConflict` adds `operator decision applied: <answer>` to the halt detail, before the resolver's reason.
3. Verify GREEN and commit.

**Done when:**
- [test] The restack halts needs-human, and `.pipeline/HALT` contains `operator decision applied: keep upstream's resolveReviewScope seam`, the resolver's new reason, and both recipe commands.
- [test] After that halt, `readConflictRecord` returns a record carrying this run's opId, `restack/decision/c2` still names the recorded blob, and no `feat/` or `refs/conductor/demo/closed/*` ref moved.
- [test] With a decision recorded for child 2, a conflict replaying child 3 calls the fake resolver with no `operatorDecision` and emits no `restack_decision` `applied` for child 3.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — escalation detail
- `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` — escalation tests

**Dependencies:** Task 10

### Task 14: A stale or unreadable decision is not delivered and is named
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` for every Done-when check below.
2. Implement: a non-matching decision emits `restack_decision` `stale` with child, commit and paths, and an escalation adds `stale operator decision: <answer>` to the halt detail. An `unreadable` decision adds `unreadable operator decision at refs/conductor/<slug>/restack/decision/c<k>`. Neither is passed to the resolver.
3. Verify GREEN and commit.

**Done when:**
- [test] With a decision for child 2 whose oldTip differs from child 2's current range, the restack emits `restack_decision` `stale` with child 2, commit and paths, and calls the fake resolver with no `operatorDecision`.
- [test] When that resolver escalates, `.pipeline/HALT` contains `stale operator decision: keep upstream's resolveReviewScope seam`, the `--tip` recipe and the `--decision` command.
- [test] With `restack/decision/c2` holding a malformed blob, the resolver is called with no `operatorDecision`, and the escalation halt contains `unreadable operator decision at refs/conductor/demo/restack/decision/c2`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — stale and unreadable handling
- `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` — stale tests

**Dependencies:** Task 13

### Task 15: Restacks without an operator decision are unchanged
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` for every Done-when check below. Compare against snapshots captured from the pre-change implementation.
2. Implement only what the parity assertions expose.
3. Verify GREEN and commit.

**Done when:**
- [test] For a repair conflict on child 2 with no decision or resolution ref, the fake resolver's context has no `operatorDecision` key, `.pipeline/events.jsonl` holds no `restack_decision` event, and `.pipeline/HALT` equals the pre-change conflict halt text plus exactly the `--decision` command line.
- [test] A restack the fake resolver settles without a decision produces applied refs, journal statuses and emitted events equal to the pre-change snapshot for the same input.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-decision-delivery.realgit.test.ts` — parity tests

**Dependencies:** Tasks 4, 10

## Task Dependency Graph

```text
1 ─┐
2 ─┼─> 6 ─> 7
   │     └> 8
2 ─> 3 ─> 4 ──────────────┐
      └─> 5 ─┐            │
9 ─┐         │            │
2 ─┴─> 10 ─┬─> 11 <─ 5,6  │
           ├─> 12         │
           ├─> 13 ─> 14   │
           └─> 15 <───────┘
```

## Integration Points

- After Task 6, an operator can record a decision through the real CLI.
- After Task 10, a recorded decision reaches the provider resolver through the routed exit restack and is applied end to end.
- After Task 12, a restarted daemon resumes a journal with the same delivery.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D1 | task | task-3, task-4 | `.pipeline/HALT` contains `Restack-Conflict: 2 <opId>` |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D2 | task | task-6, task-7, task-8, task-2 | the decision command exits 0, `readRestackDecision` returns the answer with child 2, oldParent, oldTip, commit, `src/flag.ts` and the operator |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D3 | task | task-9, task-10, task-12, task-13, task-14 | calls the fake resolver with a context carrying the answer, commit and `src/flag.ts` |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D4 | task | task-10, task-11, task-2 | `restack/decision/c2`, `restack/conflict/record` and `restack/conflict/parent` no longer exist |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D5 | task | task-1 | persists a `restack_decision` event with `action: recorded` |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D6 | task | task-15, task-9 | produces applied refs, journal statuses and emitted events equal to the pre-change snapshot for the same input |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D7 | task | task-4 | Neither halt text contains an instruction to rebase or commit on `feat/c2/demo` or `feat/daemon-demo` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D1 | task | task-3 | `readConflictRecord` returns a record naming child 2, the run's opId |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D2 | task | task-4 | the `--tip <sha>` command and `ai-conductor stack restack-resolve --slug demo --child 2 --decision "<answer>"` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D3 | task | task-6, task-2 | written by compare-and-swap against the prior blob |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D4 | task | task-5 | emits `restack_resolution` with `action: consumed` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D5 | task | task-10, task-11 | `applyRestackMove` fails its compare-and-swap |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D6 | existing | none | Post-restack guarantees remain `applyRestackTransition` and `returnToLeaf`, reached unchanged by a `resolved` child. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D7 | existing | none | `requestRoutedExit` already passes the provider resolver and cap to `runRestack`; this spec does not change it. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D8 | task | task-1 | persists a `restack_decision` event with `action: recorded` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D9 | task | task-15 | equal to the pre-change snapshot for the same input |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D10 | task | task-4 | or to move any `refs/conductor/demo/*` ref by hand |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | existing | none | Only stacked features reach `runRestack`; N=1 rebases stay on `performRebase`, and `--decision` refuses a flat feature. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | `planRestackRanges` is not modified; decision lookup runs inside the replay loop after planning. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | existing | none | Decision-assisted results pass the shipped `checkPathOwnership` unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-10 | `parseJournal` accepts a journal with `deliveredDecision` |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | existing | none | The atomic move and sync are `applyRestackMove` and `syncRestackedWorktree`; only verify lines are added. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-9, task-10 | reaches `stepRunner.resolveRebaseConflict` with a context whose `operatorDecision` carries the answer, commit and paths |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | The shared stack preflight `runStackPreflight` is unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | existing | none | Closed-child invalidation stays `applyRestackTransition`, reached unchanged by a decision-resolved child. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | no-change | none | No restack trigger is added or changed. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | no-change | none | The cascade cap `checkCascadeCap` is unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | This spec pushes nothing. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-1 | persists a `restack_decision` event with `action: recorded` |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | task | task-15 | `.pipeline/events.jsonl` holds no `restack_decision` event |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
