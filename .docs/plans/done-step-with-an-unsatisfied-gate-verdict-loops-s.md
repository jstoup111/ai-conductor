# Implementation Plan: Done step with an unsatisfied gate verdict loops silently to the selection cap

**Date:** 2026-10-29
**Design:** none (technical track, Tier S — see `.docs/track/done-step-with-an-unsatisfied-gate-verdict-loops-s.md`)
**Stories:** .docs/stories/done-step-with-an-unsatisfied-gate-verdict-loops-s.md
**Conflict check:** Not required (Tier S)

## Summary

When the engine-native `rebase` step completes successfully but leaves an unsatisfied gate verdict
that predates its dispatch, the tail heals the verdict from the dispatch's own side-effect-free
outcome (`noop` or `mergeable_skip`) and moves on, and otherwise halts at once with a reason that
says the step completed without refreshing its verdict. Four tasks: per-dispatch bookkeeping plus
the heal, the unhealable halt, the published-stack refusal case through the real stacked path, and
proof that genuine re-fails, kickbacks, and satisfied verdicts are unchanged.

## Technical Approach

- **Verified current behavior (local main `c9f3f0f4de`).**
  - In `Conductor.advanceTail` (`src/conductor/src/engine/conductor.ts`), every gate step except `rebase` takes the `topo.verdictSteps` arm, which calls `computeAndWriteVerdict` (or writes a fresh `finish`/routed-`build` verdict) after every run. `computeAndWriteVerdict` (`src/conductor/src/engine/gate-verdicts.ts`) always writes a verdict stamped `checkedAt: Date.now()`. Those steps therefore cannot leave a stale verdict, and this plan does not touch that arm.
  - The `rebase` arm skips recomputation by design (its verdict derives from git state) and trusts `runRebaseStep` to have written it. After its `lastRebaseSealError` and `conflict_halt`/`flatten_refused` halts it consumes persisted rebase-origin kickbacks only for a `changed` outcome, then falls through to the selector and the `MAX_GATE_SELECTIONS` stuck-gate guard.
  - `runRebaseStepBody`'s stacked branch returns `{ success: true }` after `publishedStackRefusal` without assigning `this.lastRebaseOutcome` or writing a verdict. `this.lastRebaseOutcome` is never cleared between dispatches, so that path also leaves the previous dispatch's outcome visible to `advanceTail`.
  - `applyRebaseVerdicts` (`src/conductor/src/engine/rebase.ts`) for `noop` and `mergeable_skip` writes exactly one satisfied flat `rebase` verdict (`branch already current with base`, or the mergeable-skip reason) and returns before any downstream kickback write. For `changed` it also writes downstream kickback verdicts, so re-applying it is not side-effect-free.
- **Selected design (track Approach A).**
  - `runRebaseStep` (the wrapper around `runRebaseStepBody`) records a new private `rebaseDispatchStartedAtMs = Date.now()` and resets `this.lastRebaseOutcome = null` before calling the body. Every outcome-producing path already assigns `lastRebaseOutcome`, so after the dispatch a `null` outcome means "this dispatch recorded no outcome".
  - A new private `reconcileStaleRebaseVerdict(state)` runs in the `rebase` arm of `advanceTail`, after the existing seal-error and conflict halts and before the `changed`-kickback consumption. It reads the flat verdict with `readVerdict(this.projectRoot, 'rebase')`, consumes `rebaseDispatchStartedAtMs` (sets it `undefined`), and returns `'fresh'` with no write unless a dispatch start was recorded and the verdict exists, is unsatisfied, and has `checkedAt < rebaseDispatchStartedAtMs`.
  - Stale with `lastRebaseOutcome?.kind` `noop` or `mergeable_skip`: call `applyRebaseVerdicts(this.projectRoot, outcome, getStepStatus(state, 'manual_test') !== 'skipped')`, emit a `gate_verdict` event for `rebase` carrying the healed verdict's `satisfied` and `reason`, return `'healed'`, and let `advanceTail` continue to the selector unchanged.
  - Stale with any other outcome (`changed`, or `null`): write a `needs-human` HALT via `writeHaltMarker`, surface the remediation PR via `surfaceRemediationPr`, emit `loop_halt` via `emitLoopHalt`, and return `'halt'` so `advanceTail` returns `'halt'`. The reason is exactly `step 'rebase' completed but its gate verdict was not refreshed (stale verdict: <stale reason>)`, using `no reason recorded` when the stale verdict has none. This mirrors the existing selection-cap halt's three calls and introduces no new HALT class or event variant.
- **Why this is enough.** The selector re-picks `rebase` only because its verdict stays unsatisfied. After a heal it is satisfied, so the existing selection logic moves on; after a halt the tail stops. A verdict written during the dispatch (`checkedAt >= rebaseDispatchStartedAtMs`), including a fresh kickback-shaped verdict written by a later step, is `'fresh'` and follows today's path. A satisfied verdict is never touched.
- **Telemetry stays on the spine.** It reuses `gate_verdict` and `loop_halt`; no new channel (`.agents/skills/event-spine/SKILL.md`).
- **Local test pattern.** `src/conductor/test/engine/resume-verdict-clamp.test.ts` drives `advanceTail` directly by casting the `Conductor` instance (`advanceTail.bind(conductor)`) with seeded `writeVerdict` records and `seedDoneThrough`-style state. It mocks `../../src/engine/rebase.js` with `vi.importActual` and overrides single exports. Follow that shape: run the real `runRebaseStep` (non-daemon, which yields `noop`), then call `advanceTail` with the `rebase` step. To make a dispatch leave its verdict stale, mock `applyRebaseVerdicts` so its first call is a no-op and later calls delegate to the actual implementation. Search hints: `advanceTail: (`, `runRebaseStep(state`, `vi.importActual('../../src/engine/rebase.js')`.

## Prerequisites

- None.

## Tasks

### Task 1: Heal a stale rebase verdict from the dispatch's own no-op outcome
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/stale-rebase-verdict.test.ts`, following the `resume-verdict-clamp.test.ts` pattern (cast `advanceTail` and `runRebaseStep`; mock `../../src/engine/rebase.js` via `vi.importActual`, exposing `applyRebaseVerdicts` as a `vi.fn` that delegates to the actual function by default). Seed state done through `finish`, every loop gate except `rebase` and `finish` with a satisfied verdict, an unsatisfied `finish` verdict (so `finish` is the next unsatisfied gate after `rebase`), and a stale `rebase` verdict `{ satisfied: false, reason: 'routed leaf return requires fresh whole-feature validation for child 3', checkedAt: 1 }`.
   - (a) First `applyRebaseVerdicts` call is a no-op (`mockImplementationOnce`). Run `runRebaseStep` (non-daemon → `noop`), then `advanceTail(rebase, …)`. Assert the result is `indexOf('finish')`, `rebase` state stays `done`, the on-disk `rebase` verdict is satisfied with reason `branch already current with base` and `checkedAt` ≥ the time captured before `runRebaseStep`, an observed `gate_verdict` event has `step: 'rebase'` and `satisfied: true`, and `.pipeline/HALT` does not exist.
   - (b) Same, but after `runRebaseStep` set the instance's `lastRebaseOutcome` to a `mergeable_skip` outcome (`{ kind: 'mergeable_skip', baseRef: 'origin/main', baseSha: 'abc', baseKind: 'remote' }`). Assert the verdict reason starts with `branch is mergeable with origin/main@abc`, the result is `indexOf('finish')`, and `rebase` state stays `done`.
   - (c) No mock skip: the real `noop` path writes its own verdict. Snapshot the `rebase` verdict file bytes after `runRebaseStep`, call `advanceTail`, and assert the file is byte-identical to that snapshot (so its `checkedAt` equals the step-written value) and `applyRebaseVerdicts` was called exactly once.
   - (d) In (a), snapshot the bytes of every other `.pipeline/gates/*.json` file before `runRebaseStep` and assert each is byte-identical after `advanceTail`, and that no `kickback` event was observed.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`: add the private `rebaseDispatchStartedAtMs?: number`. In `runRebaseStep`, set it to `Date.now()` and reset `this.lastRebaseOutcome = null` before calling `runRebaseStepBody`. Add `reconcileStaleRebaseVerdict(state)` returning `'fresh' | 'healed' | 'halt'` with the freshness rule from Technical Approach, consuming `rebaseDispatchStartedAtMs`. Implement only the `'fresh'` and `'healed'` arms here (the heal calls `applyRebaseVerdicts` and emits `gate_verdict` through `this.stampGateTier(this.withActiveRegionChild(...))` as the `verdictSteps` arm does). Call it in `advanceTail`'s `rebase` arm after the `conflict_halt`/`flatten_refused` halt and before the `changed`-kickback block.
4. Verify GREEN; commit "fix(conductor): heal a no-op rebase's stale gate verdict instead of re-selecting it".

**Done when:**
- [test] `stale-rebase-verdict.test.ts` asserts that after a `noop` `runRebaseStep` whose verdict write was skipped, `advanceTail` heals the stale `rebase` verdict to satisfied with reason `branch already current with base` and `checkedAt` later than the dispatch start, emits a `gate_verdict` event for `rebase` with `satisfied: true`, and leaves no `.pipeline/HALT`.
- [test] The same test asserts `advanceTail` returns `indexOf('finish')`, the next unsatisfied gate, and `rebase` state stays `done`, so the tail selects the next unsatisfied gate without dispatching `rebase` again.
- [test] `stale-rebase-verdict.test.ts` asserts that a `mergeable_skip` outcome with a stale verdict is healed to a satisfied verdict whose reason starts with `branch is mergeable with origin/main@abc` and that `advanceTail` returns `indexOf('finish')` with `rebase` state still `done`, so the tail selects the next unsatisfied gate without dispatching `rebase` again.
- [test] `stale-rebase-verdict.test.ts` asserts that when the real `noop` path writes its own verdict, the engine does not rewrite it: after `advanceTail` the `rebase` verdict file is byte-identical to the step-written file, its `checkedAt` equals the step-written value, and `applyRebaseVerdicts` is called exactly once.
- [test] `stale-rebase-verdict.test.ts` asserts that after the heal every other `.pipeline/gates/*.json` file is byte-identical to its pre-dispatch content and no `kickback` event is emitted.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `rebaseDispatchStartedAtMs`; per-dispatch reset in `runRebaseStep`; `reconcileStaleRebaseVerdict` fresh/heal arms; call in `advanceTail`'s `rebase` arm
- `src/conductor/test/engine/stale-rebase-verdict.test.ts` — heal cases

**Dependencies:** none

### Task 2: Halt at once on a stale rebase verdict that cannot be healed safely
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `stale-rebase-verdict.test.ts`, using Task 1's seed with stale reason `R` = `routed leaf return requires fresh whole-feature validation for child 3`.
   - (a) First `applyRebaseVerdicts` call is a no-op; after `runRebaseStep`, set the instance's `lastRebaseOutcome` to a `changed` outcome (`{ kind: 'changed', baseSha: 'abc', changedCodePaths: ['src/a.ts'], allChangedPaths: ['src/a.ts'] }`). Call `advanceTail(rebase, …)` once. Assert it returns `'halt'`, `.pipeline/HALT` contains `step 'rebase' completed but its gate verdict was not refreshed` and `R`, `.pipeline/HALT.class` is `needs-human`, an observed `loop_halt` event's `reason` equals the HALT reason, and the HALT text contains neither `selected` nor `times without satisfying`.
   - (b) In (a), assert every other `.pipeline/gates/*.json` file is byte-identical to its pre-dispatch content and no `kickback` event was observed.
   - (c) After `runRebaseStep`, set `lastRebaseOutcome` to `{ kind: 'conflict_halt', reason: 'conflict in src/a.ts' }`. Assert `advanceTail` returns `'halt'`, exactly one `loop_halt` event is observed and its reason equals `rebase conflict — parked for human resolution: conflict in src/a.ts`, and no observed `loop_halt` reason contains `was not refreshed`.
   - (d) Real conflict through the existing HALT writer: in `src/conductor/test/engine/rebase-resolution-wiring.test.ts`, copy the `cap=0 → resolveRebaseConflict never called, HALT written` scenario (real git conflict, `daemon: true`, `fromStep: 'rebase'`, `rebase_resolution_attempts: 0`), seed the stale `rebase` verdict `{ satisfied: false, reason: R, checkedAt: 1 }` before `run()`, and assert `.pipeline/HALT` exists, contains `rebase conflict — parked for human resolution`, and does not contain `was not refreshed`.
2. Verify RED.
3. Implement the `'halt'` arm of `reconcileStaleRebaseVerdict` in `src/conductor/src/engine/conductor.ts`: build the exact reason from Technical Approach, then `writeHaltMarker(reason + '\n', 'needs-human')`, `surfaceRemediationPr(reason)`, and `emitLoopHalt(reason, prUrl)`, matching the existing selection-cap halt. In `advanceTail`, return `'halt'` when it returns `'halt'`.
4. Verify GREEN; commit "fix(conductor): halt naming a rebase that completed without refreshing its gate verdict".

**Done when:**
- [test] `stale-rebase-verdict.test.ts` asserts that a single `advanceTail` after a `changed` `runRebaseStep` that left its verdict stale returns `'halt'`, writes `.pipeline/HALT` containing `step 'rebase' completed but its gate verdict was not refreshed` and the stale reason, and writes `needs-human` to `.pipeline/HALT.class`.
- [test] The same test asserts the emitted `loop_halt` event's `reason` equals the HALT reason, and that the HALT text contains neither `selected` nor `times without satisfying`.
- [test] The same test asserts every other `.pipeline/gates/*.json` file is byte-identical to its pre-dispatch content and no `kickback` event is emitted by the halt path.
- [test] `stale-rebase-verdict.test.ts` asserts that a `conflict_halt` outcome makes `advanceTail` return `'halt'` through the existing conflict halt, emitting exactly one `loop_halt` event whose reason equals `rebase conflict — parked for human resolution: conflict in src/a.ts`, and no `loop_halt` reason containing `was not refreshed`.
- [test] `rebase-resolution-wiring.test.ts` asserts that a real daemon rebase conflict with a stale unsatisfied `rebase` verdict writes the existing `.pipeline/HALT` containing `rebase conflict — parked for human resolution` and not containing `was not refreshed`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `reconcileStaleRebaseVerdict` halt arm; `'halt'` return in `advanceTail`
- `src/conductor/test/engine/stale-rebase-verdict.test.ts` — unhealable and conflict cases
- `src/conductor/test/engine/rebase-resolution-wiring.test.ts` — real-conflict HALT with a stale verdict

**Dependencies:** Task 1

### Task 3: A published-stack refusal with a stale verdict halts after one dispatch
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/stacked-finish-rebase.test.ts`. Add a file-level `vi.mock('../../src/engine/stack-publication.js', …)` built with `vi.importActual` whose `publishedStackRefusal` delegates to the actual function unless a `vi.hoisted` flag is set, so every existing test keeps the real behavior. In the new test:
   - Build `stackedFixture()`, write the stale `rebase` verdict `{ satisfied: false, reason: R, checkedAt: 1 }` with `R` = `routed leaf return requires fresh whole-feature validation`, and set the flag.
   - Construct a daemon-mode `Conductor` with `verifyArtifacts: true` and `featureSlug: 'demo'`, run the real `runRebaseStep` once (assert `{ success: true }` and one observed `restack_refused` event with `reason: 'published-stack'`), then call the cast `advanceTail` with the `rebase` step once.
   - Assert it returns `'halt'`, `.pipeline/HALT` contains `step 'rebase' completed but its gate verdict was not refreshed` and `R`, and `.pipeline/HALT.class` is `needs-human`.
2. Verify RED (today `advanceTail` returns the `rebase` index instead of halting).
3. No production change is expected beyond Tasks 1–2: the per-dispatch reset leaves `lastRebaseOutcome` `null` on this path, which reaches the halt arm. If the test still fails, fix only `runRebaseStep`'s reset ordering.
4. Verify GREEN, and confirm the file's existing tests still pass. Commit "test(conductor): published-stack refusal with a stale rebase verdict halts once".

**Done when:**
- [test] `stacked-finish-rebase.test.ts` asserts that the real daemon `runRebaseStep` with `publishedStackRefusal` forced true returns `{ success: true }` and emits one `restack_refused` event with `reason: 'published-stack'`.
- [test] The same test asserts that one following `advanceTail` call returns `'halt'` and writes `.pipeline/HALT` containing `step 'rebase' completed but its gate verdict was not refreshed` and the stale reason, with `needs-human` in `.pipeline/HALT.class`.
- [test] Every pre-existing test in `stacked-finish-rebase.test.ts` passes with the `publishedStackRefusal` mock delegating to the actual implementation.

**Files likely touched:**
- `src/conductor/test/engine/stacked-finish-rebase.test.ts` — delegating `stack-publication.js` mock; published-stack stale-verdict test

**Dependencies:** Task 2

### Task 4: Genuine re-fails, kickbacks, and satisfied verdicts keep today's behavior
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write tests in `stale-rebase-verdict.test.ts`.
   - (a) Kickback: run the real `runRebaseStep` (its own verdict write succeeds), then write a fresh `rebase` verdict `{ satisfied: false, reason: 'routed leaf return requires fresh whole-feature validation', checkedAt: Date.now(), kickback: { from: 'finish', evidence: 'leaf returned' } }`. Call `advanceTail(rebase, …)`. Assert it returns `indexOf('rebase')`, `rebase` state is reset to `pending` (today's reopen), `.pipeline/HALT` does not exist, `applyRebaseVerdicts` was called exactly once (no heal), and the verdict file is byte-identical to what the test wrote.
   - (b) Satisfied and unrefreshed: first `applyRebaseVerdicts` call is a no-op and the seeded `rebase` verdict is `{ satisfied: true, reason: 'branch already current with base', checkedAt: 1 }`. Assert `advanceTail` returns `indexOf('finish')` (what the tail returns today for this seed), `.pipeline/HALT` does not exist, `applyRebaseVerdicts` was called exactly once, and the `rebase` verdict file is byte-identical to its seeded content.
   - (c) Genuine re-fail: mirror `resume-verdict-clamp.test.ts`'s "halts with an explicit named verdict" test (state done through `finish` with `build` `failed`, every other loop gate satisfied), but before each of seven `advanceTail(finish, …)` calls write a fresh `build` verdict `{ satisfied: false, reason: 'build evidence missing for task 3', checkedAt: Date.now() }`. Assert the first six calls return `indexOf('build')`, the seventh returns `'halt'`, `.pipeline/HALT` equals exactly `gate 'build' selected 7 times without satisfying: build evidence missing for task 3` plus a newline, and `.pipeline/HALT.class` is `needs-human`.
2. Confirm the existing `resume-verdict-clamp.test.ts` selection-cap tests (`gate 'build' selected 7 times without satisfying`, including the child-keyed variant) pass unchanged; they drive a gate whose verdict is recomputed as unsatisfied on every pass, which is the genuine re-fail case.
3. These tests should pass on Tasks 1–2's implementation; if one fails, fix only the freshness predicate in `reconcileStaleRebaseVerdict`. Commit "test(conductor): stale-verdict handling leaves kickbacks and satisfied verdicts alone".

**Done when:**
- [test] `stale-rebase-verdict.test.ts` asserts that a fresh kickback-shaped unsatisfied `rebase` verdict written after the dispatch makes `advanceTail` return `indexOf('rebase')` with `rebase` reset to `pending`, no `.pipeline/HALT`, exactly one `applyRebaseVerdicts` call, and a byte-identical verdict file.
- [test] `stale-rebase-verdict.test.ts` asserts that a satisfied `rebase` verdict older than the dispatch produces no heal and no stale-verdict halt (no `.pipeline/HALT`, exactly one `applyRebaseVerdicts` call, a byte-identical verdict file) and the tail proceeds as today by returning `indexOf('finish')`.
- [test] `stale-rebase-verdict.test.ts` asserts that a `build` gate rewritten with a fresh unsatisfied verdict before each of seven selections halts on the seventh with `.pipeline/HALT` exactly `gate 'build' selected 7 times without satisfying: build evidence missing for task 3` and `needs-human` in `.pipeline/HALT.class`.
- [test] The existing `resume-verdict-clamp.test.ts` tests asserting `gate 'build' selected 7 times without satisfying` (flat and child-keyed) pass with no edit to that file.

**Files likely touched:**
- `src/conductor/test/engine/stale-rebase-verdict.test.ts` — preserved-behavior cases

**Verify-only:** yes

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──┬──▶ Task 3
                    └──▶ Task 4
```

## Integration Points

- After Task 2: the `rebase` arm of `advanceTail` either heals or halts every stale unsatisfied verdict; the selection cap is reached only by fresh verdicts.
- After Task 3: the change is proven through the real daemon stacked `runRebaseStep`, not only through a seeded outcome.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the `rebase` gate verdict is unsatisfied with reason `routed leaf return requires fresh whole-feature validation for child 3` and was written before the dispatch, when the `rebase` step completes successfully with a `noop` outcome without writing its verdict, then the `rebase` verdict on disk is satisfied with reason `branch already current with base` and a `checkedAt` later than the dispatch start, a `gate_verdict` event for `rebase` with `satisfied: true` is emitted, and the tail selects the next unsatisfied gate without dispatching `rebase` again. | 1 | "`advanceTail` returns `indexOf('finish')`, the next unsatisfied gate, and `rebase` state stays `done`, so the tail selects the next unsatisfied gate without dispatching `rebase` again" | diff-local |
| Story 1 happy: Given the same stale unsatisfied `rebase` verdict, when the `rebase` step completes successfully with a `mergeable_skip` outcome without writing its verdict, then the `rebase` verdict on disk is satisfied with the mergeable-skip reason and the tail selects the next unsatisfied gate without dispatching `rebase` again. | 1 | "returns `indexOf('finish')` with `rebase` state still `done`, so the tail selects the next unsatisfied gate without dispatching `rebase` again" | diff-local |
| Story 1 negative: Given the `rebase` step completes successfully with a `noop` outcome and wrote a fresh satisfied verdict itself, when the tail transitions, then the engine does not rewrite the verdict and its `checkedAt` equals the value the step wrote. | 1 | "the engine does not rewrite it: after `advanceTail` the `rebase` verdict file is byte-identical to the step-written file, its `checkedAt` equals the step-written value" | diff-local |
| Story 1 negative: Given the `rebase` step completes successfully with a `noop` outcome, the stale `rebase` verdict is healed, and other gates carry recorded verdicts, when the tail transitions, then every other gate verdict file is byte-identical to its pre-dispatch content and no `kickback` event is emitted. | 1 | "after the heal every other `.pipeline/gates/*.json` file is byte-identical to its pre-dispatch content and no `kickback` event is emitted" | diff-local |
| Story 2 happy: Given the `rebase` gate verdict is unsatisfied with reason `R` and was written before the dispatch, when the `rebase` step completes successfully with a `changed` outcome without writing its verdict, then after exactly one `rebase` dispatch the run writes a `needs-human` HALT whose reason names `rebase`, states that the step completed but its gate verdict was not refreshed, and quotes `R`, and the emitted `loop_halt` event carries the same reason. | 2 | "a single `advanceTail` after a `changed` `runRebaseStep` that left its verdict stale returns `'halt'`, writes `.pipeline/HALT` containing `step 'rebase' completed but its gate verdict was not refreshed` and the stale reason, and writes `needs-human` to `.pipeline/HALT.class`" | diff-local |
| Story 2 happy: Given the stale-verdict HALT above, when the operator reads `.pipeline/HALT`, then the reason does not contain `selected` or `times without satisfying`. | 2 | "the HALT text contains neither `selected` nor `times without satisfying`" | diff-local |
| Story 2 negative: Given the `rebase` step completes successfully with a `changed` outcome and left its verdict stale, when the run halts, then the downstream gate verdict files are byte-identical to their pre-dispatch content and no `kickback` event is emitted by the halt path. | 2 | "every other `.pipeline/gates/*.json` file is byte-identical to its pre-dispatch content and no `kickback` event is emitted by the halt path" | diff-local |
| Story 2 negative: Given the `rebase` gate verdict is unsatisfied with reason `R` and was written before the dispatch, when the stacked `rebase` step refuses to restack a published stack and completes successfully without recording a rebase outcome or writing its verdict, then after exactly one `rebase` dispatch the run writes a `needs-human` HALT whose reason names `rebase`, states that the step completed but its gate verdict was not refreshed, and quotes `R`. | 3 | "one following `advanceTail` call returns `'halt'` and writes `.pipeline/HALT` containing `step 'rebase' completed but its gate verdict was not refreshed` and the stale reason, with `needs-human` in `.pipeline/HALT.class`" | diff-local |
| Story 2 negative: Given the `rebase` step ends with a `conflict_halt` outcome, when the tail transitions, then the existing `rebase conflict — parked for human resolution` halt is written and the stale-verdict halt wording does not appear. | 2 | "a real daemon rebase conflict with a stale unsatisfied `rebase` verdict writes the existing `.pipeline/HALT` containing `rebase conflict — parked for human resolution` and not containing `was not refreshed`" | diff-local |
| Story 3 happy: Given a loop gate whose step completes successfully and writes a fresh unsatisfied verdict with reason `R` on every dispatch, when the gate keeps being selected, then the run halts `needs-human` with `gate '<step>' selected 7 times without satisfying: R` exactly as before. | 4 | "halts on the seventh with `.pipeline/HALT` exactly `gate 'build' selected 7 times without satisfying: build evidence missing for task 3` and `needs-human` in `.pipeline/HALT.class`" | diff-local |
| Story 3 happy: Given a later step writes a fresh unsatisfied kickback verdict on an earlier `done` gate, when the tail selects that gate, then it is re-opened and re-dispatched as today and no stale-verdict halt or heal occurs. | 4 | "a fresh kickback-shaped unsatisfied `rebase` verdict written after the dispatch makes `advanceTail` return `indexOf('rebase')` with `rebase` reset to `pending`, no `.pipeline/HALT`, exactly one `applyRebaseVerdicts` call, and a byte-identical verdict file" | diff-local |
| Story 3 negative: Given a step completes successfully, did not rewrite its gate verdict, and that verdict is satisfied, when the tail transitions, then no heal and no stale-verdict halt occurs and the tail proceeds as today. | 4 | "produces no heal and no stale-verdict halt (no `.pipeline/HALT`, exactly one `applyRebaseVerdicts` call, a byte-identical verdict file) and the tail proceeds as today by returning `indexOf('finish')`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
