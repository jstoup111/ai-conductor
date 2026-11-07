# Implementation Plan: Stack preflight refusals end the run with no HALT or reason

**Date:** 2026-10-26
**Design:** none (technical track, Tier S; track at `.docs/track/stack-preflight-refusals-end-the-run-with-no-halt-.md`)
**Stories:** .docs/stories/stack-preflight-refusals-end-the-run-with-no-halt-.md
**Conflict check:** Not required at Tier S

## Summary

Make every stack preflight result that stops a run state its specific reason durably, for all three
entry points that run it: the conductor's resume path, the rebase step, and the daemon re-kick.
8 tasks, single PR.

## Technical Approach

- **One guarantee, owned by the preflight.** Rename the current body of `runStackPreflight` in
  `src/conductor/src/engine/restack/stack-preflight.ts` to a private `runStackPreflightInner`. The
  exported `runStackPreflight` wraps it and is the only place a preflight stop becomes durable.
  - **Stop with no HALT.** On `halted` / `unavailable` with no `.pipeline/HALT`, it calls
    `writeHaltMarker(worktree, detail + '\n', haltClass ?? 'needs-human', events)`, so the first
    line contains the detail. It then emits `{ type: 'loop_halt', reason: detail }`.
  - **Stop with a HALT written by anything else.** That includes a HALT that was live before the
    preflight and not crossed, and one written by a nested `haltRestack`, `haltRestackConflict` or
    recovery halt. The wrapper never rewrites the file. It emits `loop_halt` with
    `reason: \`${detail}: ${firstLine}\``.
  - **Stop with a crossed HALT.** If the preflight crossed a live HALT under a matching resume
    authorization and the HALT is still byte-identical to its entry snapshot, the HALT no longer
    explains the stop and the wrapper writes the new detail as if no HALT existed. The wrapper
    detects the crossing by passing the inner function a `hasMatchingResumeAuthorization` that
    records a `true` answer, and by snapshotting the HALT bytes at entry.
  - **HALT write fails.** `writeHaltMarker` does not throw: it returns `{ status: 'failed', reason }`
    after emitting `halt_marker_write_failed` (verified in `halt-marker.ts`). On `failed` the wrapper
    throws `new Error(\`stack preflight stopped (${detail}) but its HALT could not be written:
    ${reason}\`)`. The daemon's existing catch in `makeRunFeature` (`daemon-runner.ts`) turns a
    thrown message into the dispatch reason.
- **Result contract.** `StackPreflightResult`'s stopping arms become
  `{ kind: 'halted'; detail: string; haltClass?: 'mechanical' }` and
  `{ kind: 'unavailable'; detail: string }`, so the compiler rejects a stop without a detail.
  - `haltUnresolvableCursor` and the foreign-round branch stop writing markers and emitting events
    themselves. They return `halted` with their existing text as `detail`, so the wrapper is the
    single writer and emits exactly one `loop_halt`.
  - A private `stageDetail(stage, detail)` returns `detail.trim()` or
    `stack preflight: <stage> refused`. It is applied at the four sites that forward a callee's
    detail: `routed exit` (`exited.detail`), `round reconciliation` (`reconciled.detail`),
    `feature-repair restack` and `base-refresh restack` (`repair` / `followOn` unavailable detail).
    Every other detail in the file is a non-empty literal or template.
- **Detail sources.** These are the preflight's own refusals:
  - the routed `resume-exit` arm forwards `exited.detail`;
  - the live-HALT gate uses `live HALT without resume authorization`;
  - recovery, restack, executor and move refusals already wrote their HALT, so the wrapper reuses
    its first line.

  This spec does not depend on spec PR #3435's `RunRestackResult.detail`. Verified:
  `applyRestackMove` writes its HALT through `haltRestack` before returning `refused`, and every
  other `halted` return in `restack-executor.ts` calls a halt helper first.
- **Live owner (operator decision 2026-10-26: mechanical HALT).** `recoverRestackJournal`'s
  `live-owner` arm gains an optional `owner: RestackJournalOwner` (`host`, `pid`). The inner function
  maps it on both recovery passes:
  - it emits `emitRestackRefused({ reason: 'journal-live-owner', detail })`;
  - it returns `{ kind: 'halted', detail, haltClass: 'mechanical' }`.

  The detail is `restack journal owned by live process <pid> on <host>`, or
  `journal owner unreadable` when no owner was read. `RestackRefusalReason` gains
  `'journal-live-owner'`, and `restack_refused` is already `persist: true` in `event-sinks.ts`.
  `resolveHaltRetention` returns `retained: false` for `mechanical` (`daemon-rekick.ts`), so the
  existing base-advance re-kick may clear it. The daemon needs no new termination type or retry path.
- **Callers.**
  - The conductor's resume path (`run()`) already returns on `halted` / `unavailable`; the HALT
    the wrapper writes is what the daemon reads through `readWorktreeOutcome`.
  - `runRebaseStep` (`conductor.ts`) puts `stack preflight <kind>: <detail>` in its failure
    `output`.
  - `runDaemonRekickStackPreflight` (`daemon-cli.ts`) logs `stack preflight <slug>: <kind> —
    <detail>`.
- **Test pattern.** Extend the realgit fixture pattern of
  `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`: a `fixture()` repo, an
  injected `git` runner or injected `reconcileRounds` / `routedRoundOpen`, then assertions on
  `.pipeline/HALT`, `.pipeline/HALT.class`, and events from a recording `ConductorEventEmitter` or an
  attached `EventPersister`. Search hints: `describe('stack preflight dispatch boundaries'`,
  `runDaemonRekickStackPreflight`, `new Conductor({ ... stackPreflight`.
  - For modules with no injection seam (`reconcileReceiptLedger`, `drainRoutingOutboxes`,
    `consumeLowestQueued`, `requestRoutedExit`, `runRestack`, `recoverRestackJournal`), use
    `vi.mock` of that module path. Every such mock keeps the real module by default (`importOriginal`, with each overridden export a `vi.fn` wrapping the real one) and is overridden only inside the test that needs it (`mockResolvedValueOnce` / `mockImplementationOnce`), so the file's other tests run the real path.
  - The existing gating tests assert `toEqual({ kind: 'halted' })` and move to
    `toMatchObject({ kind: 'halted' })` plus a detail assertion.
  - For daemon-level assertions, use `makeRunFeature` in
    `src/conductor/test/engine/daemon-runner.test.ts` with a stub `runConductor` that runs the real
    `runStackPreflight` on the fixture worktree, together with the real `readWorktreeOutcome`.

## Prerequisites

- None. Independent of spec PR #3435 by operator decision (2026-10-26).

## Tasks

### Task 1: Recovery names a live journal owner
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-recovery.sweepG3.realgit.test.ts`. A journal owned by the current live process returns `live-owner` with `owner.host` and `owner.pid` equal to the journal's recorded owner. A journal whose recorded owner is on another host, or whose process start time no longer matches, does not return `live-owner`.
2. Verify RED.
3. Add `'journal-live-owner'` to `RestackRefusalReason` in `restack-types.ts`. Change `recoverRestackJournal`'s `live-owner` arm in `restack-recovery.ts` to `{ kind: 'live-owner'; owner?: RestackJournalOwner }`. Set `owner` from `read.journal.owner` on the liveness branch. On the follow-on replacement `refused` branch, set it from a re-read of the journal when that read succeeds and leave it unset otherwise.
4. Verify GREEN and commit.

**Done when:**
- [test] A realgit recovery test asserts `recoverRestackJournal` on a journal owned by the live test process returns `{ kind: 'live-owner', owner }` whose `host` equals `os.hostname()` and whose `pid` equals `process.pid`.
- [test] A realgit recovery test asserts a journal whose recorded owner host differs from `os.hostname()`, and one whose recorded `processStartTime` does not match, are each recovered as today: the result kind is not `live-owner` and the test's pre-change expected result for that fixture is unchanged.
- `RestackRefusalReason` in `restack-types.ts` includes `'journal-live-owner'`, and `tsc --noEmit` for `src/conductor` exits 0.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-types.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/restack/restack-recovery.sweepG3.realgit.test.ts`

**Dependencies:** none

### Task 2: The preflight wrapper turns an unavailable stop into a reasoned HALT
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/restack/stack-preflight-stop-reason.test.ts`, using the realgit `fixture()` pattern from `stack-preflight-gating.test.ts` with routing enabled and an `EventPersister` attached to the emitter. Inject `reconcileRounds` returning `{ kind: 'unavailable', detail: 'round advance cas-failed' }`. With `vi.mock` of the owning modules, also drive:
   - `reconcileReceiptLedger` throwing;
   - `drainRoutingOutboxes` returning `{ kind: 'unavailable' }`;
   - `consumeLowestQueued` returning `{ kind: 'unavailable' }`;
   - `readRestackJournal` returning a non-applied journal after a base-refresh-due repair, which is the lost follow-on.
2. Verify RED. Every `vi.mock` here keeps the real module by default (`importOriginal`, with each overridden export a `vi.fn` wrapping the real one) and is overridden only inside the test that needs it (`mockResolvedValueOnce` / `mockImplementationOnce`), so the file's other tests run the real path.
3. In `stack-preflight.ts`:
   - Add the required `detail` (and optional `haltClass`) to the `halted` arm, and keep `detail` required on `unavailable`.
   - Rename the body to `runStackPreflightInner`. The exported wrapper writes the HALT and emits `loop_halt` as in Technical Approach when no `.pipeline/HALT` exists.
   - Make `haltUnresolvableCursor` and the foreign-round branch return `{ kind: 'halted', detail }` without writing or emitting, and give every inner `halted` return a detail.
   - Update the `toEqual({ kind: 'halted' })` assertions in `stack-preflight-gating.test.ts` to `toMatchObject` plus a detail check.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-stop-reason.test.ts` asserts that with injected `reconcileRounds` unavailable `round advance cas-failed`, `runStackPreflight` returns `unavailable` with that detail, `.pipeline/HALT`'s first line contains `round advance cas-failed`, `.pipeline/HALT.class` is `needs-human`, and `.pipeline/events.jsonl` contains exactly one `loop_halt` event whose reason contains `round advance cas-failed`.
- [test] `stack-preflight-stop-reason.test.ts` asserts that for each of the four other unavailable causes (receipt-ledger reconcile, routing-outbox drain, revalidation-queue consume, lost base-refresh follow-on), the HALT first line and the persisted `loop_halt` reason contain that cause's own text (`routed receipt ledger`, `routing outbox`, `revalidation queue`, `base-refresh follow-on`) and are not just `stack preflight unavailable`.
- [test] The existing `stack preflight dispatch boundaries` cases in `stack-preflight-gating.test.ts` still pass: each cause's HALT contains the cause name, and exactly one `loop_halt` is emitted per stop.
- `StackPreflightResult` in `stack-preflight.ts` declares `detail: string` as required on its `halted` and `unavailable` arms, and `tsc --noEmit` for `src/conductor` exits 0.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-stop-reason.test.ts`
- `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`

**Dependencies:** none

### Task 3: A failed HALT write is never a silent stop
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - In `stack-preflight-stop-reason.test.ts`, with no `.pipeline/HALT` present, inject `reconcileRounds` unavailable `round advance cas-failed` and `vi.mock` `../halt-marker.js` (spreading `importOriginal`) so `writeHaltMarker` resolves `{ status: 'failed', path, reason: 'injected write failure' }`. Do not create anything at the HALT path: an existing HALT would take the preserve path instead of the write.
   - In `src/conductor/test/engine/daemon-runner.test.ts` (`makeRunFeature`), stub `deps.runConductor` to run the real `runStackPreflight` on that fixture, with the same mocked failed write, and let its rejection propagate.
2. Verify RED. Every `vi.mock` here keeps the real module by default (`importOriginal`, with each overridden export a `vi.fn` wrapping the real one) and is overridden only inside the test that needs it (`mockResolvedValueOnce` / `mockImplementationOnce`), so the file's other tests run the real path.
3. In the exported wrapper, when `writeHaltMarker` returns `status: 'failed'`, throw `new Error(\`stack preflight stopped (${detail}) but its HALT could not be written: ${reason}\`)`.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-stop-reason.test.ts` asserts that when `writeHaltMarker` reports `status: 'failed'` with reason `injected write failure`, `runStackPreflight` rejects with an Error whose message contains `round advance cas-failed`, `could not be written` and `injected write failure`, and does not resolve to a stop result.
- [test] `daemon-runner.test.ts` asserts that when that rejection propagates from `runConductor`, `makeRunFeature`'s result reason contains `round advance cas-failed`, `could not be written` and `injected write failure`, and no captured feature-log line contains `loop ended without DONE or HALT marker`.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-stop-reason.test.ts`
- `src/conductor/test/engine/daemon-runner.test.ts`

**Dependencies:** Task 2

### Task 4: An existing HALT is preserved unless it was crossed under authorization
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `stack-preflight-stop-reason.test.ts`, with an `EventPersister` attached:
   - A nested restack halt that writes its own HALT through `haltRestack`, using the existing published-stack or divergent fixture; snapshot the HALT bytes.
   - A seeded HALT with no `hasMatchingResumeAuthorization`.
   - A seeded HALT with `hasMatchingResumeAuthorization` resolving `true`, on a fixture that then returns `clear`.
   - The same authorized seeded HALT on a fixture whose injected `reconcileRounds` then returns unavailable `round advance cas-failed`.
   - Results `clear`, `no-stack`, `recovered`, `repaired`, `navigate-host` and `navigate-leaf-to-build`, driven through the existing fixtures and injected `reconcileRounds`.
2. Verify RED.
3. In the wrapper:
   - Snapshot the entry HALT bytes, and record a `true` authorization answer through the wrapped `hasMatchingResumeAuthorization`.
   - On a stop where a HALT exists and was not crossed, or differs from the entry snapshot, leave the file untouched and emit `loop_halt` with `reason: \`${detail}: ${firstLine}\``.
   - On a stop where the crossed HALT is still byte-identical to its snapshot, write the new detail.
   - Set the live-HALT gate's detail to `live HALT without resume authorization`.
   - Pass non-stopping results through with no write and no emit.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-stop-reason.test.ts` asserts that after a nested restack halt, `.pipeline/HALT` is byte-identical (`Buffer.equals`) to the bytes the restack wrote, and `.pipeline/events.jsonl` contains one `loop_halt` event whose reason contains that HALT's first line.
- [test] `stack-preflight-stop-reason.test.ts` asserts that a seeded HALT with no matching authorization is byte-identical after the call, the result is `halted`, and one persisted `loop_halt` reason contains both `live HALT without resume authorization` and the seeded HALT's first line.
- [test] `stack-preflight-stop-reason.test.ts` asserts that a seeded HALT with authorization resolving `true` on a `clear` fixture is byte-identical after the call, and no `loop_halt` or `restack_refused` event was emitted.
- [test] `stack-preflight-stop-reason.test.ts` asserts that a seeded HALT with authorization resolving `true`, followed by an unavailable `round advance cas-failed` stop, leaves `.pipeline/HALT` whose first line contains `round advance cas-failed`.
- [test] `stack-preflight-stop-reason.test.ts` asserts that for each of `clear`, `no-stack`, `recovered`, `repaired`, `navigate-host` and `navigate-leaf-to-build`, no `.pipeline/HALT` exists afterwards and no `loop_halt` event was emitted.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-stop-reason.test.ts`

**Dependencies:** Task 2

### Task 5: A routed resume-exit refusal halts with the exit's detail, and no forwarded detail is blank
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `stack-preflight-stop-reason.test.ts`, using `vi.mock` of `../routing/routed-exit.js` and `./restack-executor.js`, and an injected `reconcileRounds`:
   - `reconcileRounds` returning `resume-exit`, with `requestRoutedExit` resolving `{ kind: 'halted', detail: 'routed exit host 2: leaf compare-and-swap cas-failed' }` without writing a marker.
   - The same with `detail: ''`.
   - `reconcileRounds` resolving `{ kind: 'unavailable', detail: '' }`.
   - `runRestack` resolving `{ kind: 'unavailable', detail: '' }` on a repair-pending fixture, without and then with a base-refresh due.
2. Verify RED. Every `vi.mock` here keeps the real module by default (`importOriginal`, with each overridden export a `vi.fn` wrapping the real one) and is overridden only inside the test that needs it (`mockResolvedValueOnce` / `mockImplementationOnce`), so the file's other tests run the real path.
3. Forward `exited.detail` as the `halted` detail from the `resume-exit` arm. Add `stageDetail(stage, detail)` and apply it at the four forwarding sites named in Technical Approach.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-stop-reason.test.ts` asserts that a markerless `requestRoutedExit` refusal yields `.pipeline/HALT` with class `needs-human` whose first line contains `routed exit host 2: leaf compare-and-swap cas-failed`, and one `loop_halt` whose reason contains the same text.
- [test] `stack-preflight-stop-reason.test.ts` asserts that for an empty forwarded detail at each of the four forwarding stages, the HALT's first line is non-blank and contains the stage's fallback: `stack preflight: routed exit refused`, `stack preflight: round reconciliation refused`, `stack preflight: feature-repair restack refused`, `stack preflight: base-refresh restack refused`.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-stop-reason.test.ts`

**Dependencies:** Task 2

### Task 6: A live journal owner halts mechanically, naming the owner
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - In `stack-preflight-stop-reason.test.ts`, with an `EventPersister` attached: a realgit journal owned by the live test process, as in Task 1; and `vi.mock` of `./restack-recovery.js` returning, on the second recovery pass (the follow-on refusal shape), `{ kind: 'live-owner', owner: { host: 'hostA', pid: 4242, processStartTime: 'x' } }` and separately `{ kind: 'live-owner' }` with no owner.
   - In `daemon-runner.test.ts` (`makeRunFeature`), a stub `runConductor` that runs the real `runStackPreflight` on the live-owned fixture, with the real `readWorktreeOutcome`.
2. Verify RED. Every `vi.mock` here keeps the real module by default (`importOriginal`, with each overridden export a `vi.fn` wrapping the real one) and is overridden only inside the test that needs it (`mockResolvedValueOnce` / `mockImplementationOnce`), so the file's other tests run the real path.
3. Map recovery `live-owner`, on both recovery passes, to `emitRestackRefused({ reason: 'journal-live-owner', detail })` and `{ kind: 'halted', detail, haltClass: 'mechanical' }`, with the detail text from Technical Approach. The wrapper writes the HALT with that class.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-stop-reason.test.ts` asserts that a live-owned journal yields `.pipeline/HALT.class` equal to `mechanical` and a HALT first line containing `process.pid` and `os.hostname()`. `.pipeline/events.jsonl` contains one `restack_refused` event with reason `journal-live-owner` and one `loop_halt` event, each with a detail containing the same pid and host.
- [test] `stack-preflight-stop-reason.test.ts` asserts that a `live-owner` result on the follow-on recovery pass yields a `mechanical` HALT, one `restack_refused` `journal-live-owner` event and one `loop_halt` event, all naming the owner: with an owner `{ host: 'hostA', pid: 4242 }` each contains `4242` and `hostA`, and with no owner each contains `journal owner unreadable`.
- [test] `daemon-runner.test.ts` asserts that for the live-owned fixture, `makeRunFeature` returns status `halted` with a reason containing `process.pid`, no feature-log line contains `loop ended without DONE or HALT marker`, and `resolveHaltRetention(() => readRawHaltClass(worktree))` returns `retained: false`.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-stop-reason.test.ts`
- `src/conductor/test/engine/daemon-runner.test.ts`

**Dependencies:** Tasks 1, 2

### Task 7: The conductor's resume path and rebase step surface the preflight stop
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`, following its `new Conductor({ ... stackPreflight })` pattern:
   - A resume dispatch whose injected `stackPreflight` is the real wrapper over an injected `reconcileRounds` unavailable `round advance cas-failed`, followed by the real `readWorktreeOutcome` on the fixture.
   - A `runRebaseStep` exercise through the step-runner path the existing rebase tests use, on a stacked fixture. Its `stackPreflight` is the real wrapper over an injected `reconcileRounds` unavailable `round advance cas-failed`, and separately over a `resume-exit` whose mocked `requestRoutedExit` halts with `routed exit host 2: leaf compare-and-swap cas-failed`.
2. Verify RED.
3. In `runRebaseStep` (`conductor.ts`), set the failure `output` to `stack preflight <kind>: <detail>` for both stopping arms. The resume path needs no change beyond consuming the new result type.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-gating.test.ts` asserts that a resume dispatch over the unavailable `round advance cas-failed` preflight dispatches no step, and `readWorktreeOutcome` on the fixture then returns `halted: true` with a reason containing `round advance cas-failed`.
- [test] `stack-preflight-gating.test.ts` asserts that for both the `unavailable` and the `halted` rebase-step cases, `runRebaseStep` returns `success: false` with `output` containing the preflight's detail, and `.pipeline/HALT`'s first line contains the same detail.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`

**Dependencies:** Tasks 2, 5

### Task 8: The daemon re-kick and dispatch report the preflight reason
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - In `stack-preflight-gating.test.ts`, call `runDaemonRekickStackPreflight` over an outbox-drain failure (`vi.mock` of the routing outbox module returning `{ kind: 'unavailable' }`), then the real `readWorktreeOutcome`. Also call it over a non-routed `clear` fixture with a recording emitter.
   - In `daemon-runner.test.ts` (`makeRunFeature`), a stub `runConductor` that runs the real `runStackPreflight` on a fixture whose injected `reconcileRounds` is unavailable `round advance cas-failed`, with the real `readWorktreeOutcome`.
2. Verify RED. Every `vi.mock` here keeps the real module by default (`importOriginal`, with each overridden export a `vi.fn` wrapping the real one) and is overridden only inside the test that needs it (`mockResolvedValueOnce` / `mockImplementationOnce`), so the file's other tests run the real path.
3. In `daemon-cli.ts`, `runDaemonRekickStackPreflight` logs `stack preflight <slug>: <kind> — <detail>` for both stopping arms. It still logs nothing for non-stopping results.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-gating.test.ts` asserts that `runDaemonRekickStackPreflight` over the outbox-drain failure leaves `.pipeline/HALT` whose first line contains `cannot drain routing outbox: unavailable`, logs a line containing that detail, and no log line contains `loop ended without DONE or HALT marker`. `readWorktreeOutcome` on the fixture then returns `halted: true` with a reason containing that detail.
- [test] `stack-preflight-gating.test.ts` asserts that `runDaemonRekickStackPreflight` on a non-routed `clear` fixture returns `{ kind: 'clear' }`, logs no line, leaves no `.pipeline/HALT`, and its recording emitter received no events.
- [test] `daemon-runner.test.ts` asserts that a dispatch whose preflight stops on `round advance cas-failed` yields `makeRunFeature` status `halted` with a reason containing `round advance cas-failed`, and no feature-log line contains `loop ended without DONE or HALT marker`.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`
- `src/conductor/test/engine/daemon-runner.test.ts`

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ───────────────▶ Task 6
Task 2 ─┬─▶ Task 3
        ├─▶ Task 4
        ├─▶ Task 5 ───▶ Task 7
        ├─▶ Task 6
        ├─▶ Task 7
        └─▶ Task 8
```

Tasks 1 and 2 are independent roots. Task 6 depends on Tasks 1 and 2, Task 7 on Tasks 2 and 5, and
Tasks 3, 4, 5 and 8 on Task 2 only.

## Integration Points

- After Task 2: any unavailable preflight stop leaves a reasoned HALT and a persisted `loop_halt` event.
- After Task 7: a conductor resume dispatch and the rebase step each end with a HALT the daemon classifies, never a silent return.
- After Task 8: a daemon dispatch reports the preflight's own reason. Task 8 owns the daemon entry-point integration proof; Tasks 3 and 6 add the write-failure and live-owner variants at the same entry point.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a stacked feature with no live `.pipeline/HALT` whose routed round reconciliation reports unavailable with detail `round advance cas-failed`, when the stack preflight runs from the conductor's resume path, then `.pipeline/HALT` is written with disposition needs-human and its first line contains `round advance cas-failed`, and `.pipeline/events.jsonl` gains a `loop_halt` event whose reason contains `round advance cas-failed`. | 2, 7 | "`.pipeline/HALT.class` is `needs-human`, and `.pipeline/events.jsonl` contains exactly one `loop_halt` event whose reason contains `round advance cas-failed`" | diff-local |
| Story 1 happy: Given the same feature dispatched by the daemon, when the dispatch ends, then the daemon reports the feature halted with a reason containing `round advance cas-failed` and its log does not contain `loop ended without DONE or HALT marker`. | 8 | "a dispatch whose preflight stops on `round advance cas-failed` yields `makeRunFeature` status `halted` with a reason containing `round advance cas-failed`, and no feature-log line contains `loop ended without DONE or HALT marker`" | diff-local |
| Story 1 negative: Given a stack preflight that reports unavailable for any other cause (routed receipt ledger, routing outbox drain, revalidation queue, or a lost base-refresh follow-on), when it stops the run, then the HALT's first line and the `loop_halt` reason both contain that cause's own detail text, not a generic `stack preflight unavailable` alone. | 2 | "the HALT first line and the persisted `loop_halt` reason contain that cause's own text (`routed receipt ledger`, `routing outbox`, `revalidation queue`, `base-refresh follow-on`) and are not just `stack preflight unavailable`" | diff-local |
| Story 1 negative: Given the HALT write fails (for example `.pipeline/HALT` cannot be written), when the preflight stops, then the failure is not swallowed: the dispatch's daemon reason names both the preflight detail and the write failure, and the daemon log does not contain `loop ended without DONE or HALT marker`. | 3 | "`makeRunFeature`'s result reason contains `round advance cas-failed`, `could not be written` and `injected write failure`, and no captured feature-log line contains `loop ended without DONE or HALT marker`" | diff-local |
| Story 2 happy: Given a resumed routed round whose exit refuses with detail `routed exit host 2: leaf compare-and-swap cas-failed` and writes no HALT itself, when the stack preflight's resume-exit stops the run, then `.pipeline/HALT` is written needs-human with that detail in its first line and a `loop_halt` event carries the same detail. | 5 | "a markerless `requestRoutedExit` refusal yields `.pipeline/HALT` with class `needs-human` whose first line contains `routed exit host 2: leaf compare-and-swap cas-failed`, and one `loop_halt` whose reason contains the same text" | diff-local |
| Story 2 negative: Given a preflight refusal whose detail would be empty, when it stops the run, then the HALT's first line still names the refusing preflight stage (for example `stack preflight: routed exit refused`) and is never blank. | 5 | "for an empty forwarded detail at each of the four forwarding stages, the HALT's first line is non-blank and contains the stage's fallback" | diff-local |
| Story 3 happy: Given a restack conflict inside the preflight that wrote its own HALT naming the conflicting child and paths, when the preflight returns its stop, then `.pipeline/HALT` is byte-identical to what the restack wrote and `events.jsonl` carries a `loop_halt` whose reason contains that HALT's first line. | 4 | "`.pipeline/HALT` is byte-identical (`Buffer.equals`) to the bytes the restack wrote, and `.pipeline/events.jsonl` contains one `loop_halt` event whose reason contains that HALT's first line" | diff-local |
| Story 3 happy: Given a live HALT with no matching resume authorization, when the preflight refuses to cross it, then the existing HALT is unchanged and a `loop_halt` event's reason contains both `live HALT without resume authorization` and the existing HALT's first line. | 4 | "a seeded HALT with no matching authorization is byte-identical after the call, the result is `halted`, and one persisted `loop_halt` reason contains both `live HALT without resume authorization` and the seeded HALT's first line" | diff-local |
| Story 3 negative: Given a preflight result of `clear`, `no-stack`, `recovered`, `repaired`, `navigate-host`, or `navigate-leaf-to-build`, when the preflight returns, then no HALT is written and no `loop_halt` event is emitted. | 4 | "for each of `clear`, `no-stack`, `recovered`, `repaired`, `navigate-host` and `navigate-leaf-to-build`, no `.pipeline/HALT` exists afterwards and no `loop_halt` event was emitted" | diff-local |
| Story 3 negative: Given a live HALT that a matching resume authorization permits crossing, when the preflight proceeds without stopping, then it neither rewrites that HALT nor emits a refusal for it. | 4 | "a seeded HALT with authorization resolving `true` on a `clear` fixture is byte-identical after the call, and no `loop_halt` or `restack_refused` event was emitted" | diff-local |
| Story 3 negative: Given a live HALT that a matching resume authorization permits crossing, when the preflight then stops for another cause, then `.pipeline/HALT`'s first line is replaced by that cause's detail, because the crossed HALT no longer describes why the run stopped. | 4 | "a seeded HALT with authorization resolving `true`, followed by an unavailable `round advance cas-failed` stop, leaves `.pipeline/HALT` whose first line contains `round advance cas-failed`" | diff-local |
| Story 4 happy: Given a restack journal owned by a live process on this host, when the stack preflight yields to it, then `.pipeline/HALT` is written with class `mechanical` and its first line names the owner's pid and host, `events.jsonl` gains a `restack_refused` event with a live-owner reason whose detail names the same pid and host, and a `loop_halt` event carries the same detail. | 6 | "a live-owned journal yields `.pipeline/HALT.class` equal to `mechanical` and a HALT first line containing `process.pid` and `os.hostname()`" | diff-local |
| Story 4 happy: Given that stop during a daemon dispatch, when the dispatch ends, then the daemon reports the feature halted with a reason naming the live journal owner instead of `loop ended without DONE or HALT marker`, and the daemon's shared halt-retention decision does not retain the HALT for an operator. | 6 | "`makeRunFeature` returns status `halted` with a reason containing `process.pid`, no feature-log line contains `loop ended without DONE or HALT marker`, and `resolveHaltRetention(() => readRawHaltClass(worktree))` returns `retained: false`" | diff-local |
| Story 4 negative: Given a journal whose recorded owner is on another host or whose process is no longer alive, when the preflight runs, then it does not report a live owner and recovery proceeds as it does today. | 1 | "a journal whose recorded owner host differs from `os.hostname()`, and one whose recorded `processStartTime` does not match, are each recovered as today: the result kind is not `live-owner` and the test's pre-change expected result for that fixture is unchanged" | diff-local |
| Story 4 negative: Given a follow-on journal replacement refused because another live operation took the journal, when the preflight stops on that refusal, then it halts the same mechanical way, naming the journal's current owner when readable and `journal owner unreadable` otherwise. | 1, 6 | "a `live-owner` result on the follow-on recovery pass yields a `mechanical` HALT, one `restack_refused` `journal-live-owner` event and one `loop_halt` event, all naming the owner" | diff-local |
| Story 5 happy: Given the daemon re-kick of a stacked feature whose preflight stops with detail `cannot drain routing outbox: unavailable`, when the re-kick returns before running the conductor, then the daemon log line for the preflight contains that detail, and the daemon classifies the dispatch as halted with that detail rather than `loop ended without DONE or HALT marker`. | 8 | "`readWorktreeOutcome` on the fixture then returns `halted: true` with a reason containing that detail" | diff-local |
| Story 5 happy: Given no `.pipeline/HALT` exists and the rebase step's stack preflight stops on a refusal that wrote no HALT of its own (an unavailable result or a markerless routed-exit refusal), when the step returns its failure, then the step output contains the preflight's detail and `.pipeline/HALT`'s first line carries the same detail. | 7 | "`runRebaseStep` returns `success: false` with `output` containing the preflight's detail, and `.pipeline/HALT`'s first line contains the same detail" | diff-local |
| Story 5 happy: Given the conductor's resume path stack preflight stops, when `run()` returns, then no step is dispatched and the daemon classifies the dispatch from the HALT the preflight wrote. | 7 | "a resume dispatch over the unavailable `round advance cas-failed` preflight dispatches no step, and `readWorktreeOutcome` on the fixture then returns `halted: true` with a reason containing `round advance cas-failed`" | diff-local |
| Story 5 negative: Given the daemon re-kick preflight returns `clear`, when the re-kick boundary returns, then it returns `clear` with no extra log line, HALT, or event, so the re-kick continues to the rebase resume and the conductor as today. | 8 | "`runDaemonRekickStackPreflight` on a non-routed `clear` fixture returns `{ kind: 'clear' }`, logs no line, leaves no `.pipeline/HALT`, and its recording emitter received no events" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
