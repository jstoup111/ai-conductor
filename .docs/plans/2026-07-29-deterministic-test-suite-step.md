# Implementation Plan: Deterministic test-suite BUILD gate

**Date:** 2026-07-29
**Design:** `.docs/decisions/adr-2026-07-29-deterministic-build-verification-fanout.md`
**Stories:** `.docs/stories/deterministic-test-suite-step.md`
**Conflict check:** Clean as of 2026-07-29

## Summary

Replace the shipped test-suite skill surface with a provider-neutral engine
group that runs `wiring_check` and `test_suite` under the existing concurrency
core before `build_review`. Twenty small TDD tasks cover registry topology,
native branch execution, joined failure state, interruption, proof preservation,
catalog removal, interactive CLI guidance, the consumer migration, and one scoped remediation task.

## Plan amendment — 2026-07-31 (operator-approved)

The operator approved the following scope corrections after `build_review` identified
them. They preserve the approved outcome — deterministic, aggregate-safe BUILD
verification — without changing a story, dependency, or acceptance criterion.

- **Tasks 1, 2, and 4:** their `Wired-into:` labels name the real production
  call sites, `BUILD_VERIFICATION_GROUP` and `runNativeGroupBranch`, rather than
  the obsolete `Conductor.run` symbol. This is a contract-label correction only.
- **Task 19:** owns two aggregate-suite reliability corrections required for a
  credible deterministic matrix: wait for complete pid/result-file contents in
  `engine-store-smoke.test.ts`, and isolate the real tmux leak-guard fixture in
  a dedicated tmux socket in `tmux-leak-guard.test.ts`. Neither change adds a
  production surface or third-party call.

### Verify-Claims Ledger — plan amendment — 2026-07-31

#### Claims

- [verified] `BUILD_VERIFICATION_GROUP` and `runNativeGroupBranch` are actual
  call-site symbols in `src/conductor/src/engine/conductor.ts`; the former
  `Conductor.run` label cannot resolve in the wiring probe.
- [verified] the two test-file changes are committed on this feature branch
  with `Task: 19` and make aggregate-suite fixtures deterministic.

#### Assumptions

- [load-bearing, confirmed] The wiring-label correction and both reliability
  corrections belong to this feature's approved scope.
  - Impact if wrong: the plan would authorize unrelated work.
  - Confirmed by: operator approval, 2026-07-31 ("all approved").

**Verdict: CLEAR.**

## Plan remediation — 2026-07-31 (operator scope correction)

Build review correctly found that Task 19 removed deterministic tmux leak-guard coverage and left an
excluded smoke file lint-red and assertion-free. Its proposed new package command, CI smoke job, and
documentation lane are not required by the accepted stories or the operator-approved Task 19
amendment, so they remain out of scope. The repair restores deterministic injected-runner coverage
in the ordinary suite and removes the unused real-tmux smoke file.

### Verify-Claims Ledger — scoped tmux remediation — 2026-07-31

#### Claims

- [verified] The accepted deterministic BUILD stories preserve existing cleanup contracts but do
  not require a new real-tmux smoke execution lane.
- [verified] The approved Task 19 amendment names aggregate-safe fixture isolation and configured
  lint; it does not authorize a package command, CI job, or documentation surface.
- [verified] Repository test guidance requires real-executable tests to remain smoke-only but does
  not require every smoke experiment to become a permanent CI lane.
- [verified] The deleted pre-existing-session/no-leak behavior can be proved deterministically with
  the existing injected runner seam in `tmux-leak-guard.test.ts`.

#### Assumptions

- [load-bearing, confirmed] Real-tmux CI infrastructure is outside this feature; deterministic
  injected-runner coverage is the accepted repair.
  - Impact if wrong: the plan would omit a new CI capability.
  - Confirmed by: operator approval, 2026-07-31.

**Verdict: CLEAR.**

**Operator approval:** Approved 2026-07-31.

## Technical Approach

- Declare a second built-in `StepGroup` for deterministic BUILD verification,
  while retaining the existing SHIP validation group unchanged.
- Extend `group-core.ts` with a native-function branch seam that returns the
  existing exhaustive `BranchOutcome` union and uses `runWithConcurrency`; it
  must never enter `StepRunner`, provider-session, model, or retry dispatch.
- Let the conductor invoke the wiring probe and `FullSuiteVerifier` through
  native branch thunks, wait for both settled outcomes, then perform the only
  state/gate/event writes at the join. Single and dual failures reuse the
  existing BUILD rewind and gate-keyed budget machinery.
- Preserve every existing full-suite proof/process contract. The orchestration
  owns no fingerprint, lock, timeout, redaction, cleanup, or evidence logic.
- Delete the shipped skill and its direct references, keep the deterministic
  `conduct-ts test-suite` command, and make install/update prune only proven
  harness-owned obsolete links for both host catalogs.

## Prerequisites

- The approved concurrent group core and `validation_concurrency` setting.
- Existing engine-native wiring probe, `FullSuiteVerifier`, gate verdicts, and
  standalone `conduct-ts test-suite` adapter.
- Tests use injected fakes and isolated temporary roots; no ordinary test may
  invoke Claude, Codex, GitHub, a registry, or the repository aggregate suite.

## Tasks

### Task 1: Describe the deterministic BUILD group in the step registry
**Story:** Story 1, happy paths 1 and 3; Story 3, happy path 1
**Type:** infrastructure

**Steps:**
1. Write failing registry tests asserting a built-in group with ordered members
   `wiring_check`, `test_suite`, positioned after `build` and before
   `build_review`, without changing `VALIDATION_GROUP`.
2. Verify the focused registry test fails (RED).
3. Add the BUILD group constant, register it in `STEP_GROUPS`, and repoint the
   three BUILD-tail prerequisites to express the joined boundary.
4. Verify the focused registry test passes (GREEN).
5. Commit with message: "feat: register deterministic build verification group"

**Files:** `src/conductor/src/engine/steps.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#BUILD_VERIFICATION_GROUP`

**Dependencies:** none

### Task 2: Add a native-function branch adapter to the shared group core
**Story:** Story 1, happy path 1; Story 2, happy paths 1 and 3
**Type:** happy-path

**Steps:**
1. Write failing unit tests for a native branch thunk that maps successful and
   unsuccessful `StepRunResult` values into ordered `BranchOutcome` values.
2. Verify the focused group-core tests fail (RED).
3. Implement the smallest injected native executor beside `runGroupBranch`,
   reusing exhaustive outcome classification and member-attributed events.
4. Verify the focused group-core tests pass (GREEN).
5. Commit with message: "feat: execute native branches through group core"

**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/test/engine/group-core.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#runNativeGroupBranch`

**Dependencies:** Task 1

### Task 3: Prove native branches cannot dispatch a provider or skill
**Story:** Story 3, happy path 1; negative path 1
**Type:** negative-path

**Steps:**
1. Add a failing group-core test with provider/session and `StepRunner` spies,
   asserting the native adapter calls only the injected function.
2. Verify the focused test fails (RED).
3. Separate native and skill branch dependency types so the native path has no
   runner, provider, session, model, or retry collaborator available to call.
4. Verify the spy assertions pass (GREEN).
5. Commit with message: "fix: make native group branches provider free"

**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/test/engine/group-core.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 4: Run wiring and suite branches and join the passing round
**Story:** Story 1, happy paths 1 and 2; Story 2, happy paths 1 and 3
**Type:** happy-path

**Steps:**
1. Write a bounded conductor test with deferred injected wiring/verifier fakes
   proving both branches start before either is released and completion order
   does not change declared result order.
2. Verify the focused conductor test fails (RED).
3. Add the BUILD-group path in `Conductor.run`, call the existing native wiring
   and suite methods through Task 2's adapter, and join before writing state.
4. Verify pass/pass records both gates once and allows `build_review` (GREEN).
5. Commit with message: "feat: fan out deterministic build verification"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#runNativeGroupBranch`

**Dependencies:** Task 3

### Task 5: Degrade cap-one execution to stable serial order
**Story:** Story 1, happy path 3; negative path 3
**Type:** negative-path

**Steps:**
1. Add a failing conductor test with `validation_concurrency: 1` that records
   native branch start/end order.
2. Verify the focused test fails (RED).
3. Route the BUILD group through the existing `runWithConcurrency` cap and
   preserve declared member order without adding another promise executor.
4. Verify the timeline is wiring then suite and both precede review (GREEN).
5. Commit with message: "fix: honor shared cap for build verification"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 4

### Task 6: Block paid review on either single deterministic failure
**Story:** Story 1, negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Add failing pass/fail and fail/pass tests with model-runner and SHIP-validator
   spies, preserving the failing member's diagnostic.
2. Verify both focused cases fail (RED).
3. Classify the settled round fail-closed and route one member's existing gate
   evidence to BUILD without dispatching `build_review` or SHIP.
4. Verify zero model/SHIP calls and one rewind in both cases (GREEN).
5. Commit with message: "fix: reject deterministic failures before review"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 5

### Task 7: Consolidate dual failures into one rewind and two budget charges
**Story:** Story 2, happy path 2; negative path 1
**Type:** negative-path

**Steps:**
1. Add a failing test where wiring and suite both return distinct blocking
   diagnostics in reversed completion order.
2. Verify the focused test fails (RED).
3. Join both diagnostics into one BUILD rewind and increment each gate-keyed
   kickback counter exactly once, preserving deterministic member order.
4. Verify one rewind/event, both diagnostics, and two single counter increments
   (GREEN).
5. Commit with message: "fix: join dual verification failures once"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`, `src/conductor/test/engine/conductor-kickback-ledger.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 6

### Task 8: Fail closed on thrown and indeterminate native outcomes
**Story:** Story 2, negative path 4; Story 4, negative path 1
**Type:** negative-path

**Steps:**
1. Add failing tests for a throwing wiring function and an indeterminate suite
   result, asserting neither can be converted to pass or partial green state.
2. Verify the focused tests fail (RED).
3. Map thrown/indeterminate native results to blocking outcomes with bounded,
   attributable reasons and let all already-started work settle.
4. Verify no review dispatch, no false gate completion, and awaited cleanup
   (GREEN).
5. Commit with message: "fix: fail closed on native branch uncertainty"

**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/group-core.test.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 7

### Task 9: Preserve settled evidence across interruption and resume
**Story:** Story 2, negative path 2
**Type:** negative-path

**Steps:**
1. Add a failing bounded test that interrupts after one native branch settles
   while the sibling remains incomplete, then resumes from persisted state.
2. Verify the focused test fails (RED).
3. Reuse the concurrent core's pending-completion side channel for the BUILD
   group, persist only settled members on signal, and leave absence retryable.
4. Verify resume never converts the missing outcome to pass and does not rerun a
   safely persisted sibling unnecessarily (GREEN).
5. Commit with message: "fix: preserve interrupted build verification progress"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 8

### Task 10: Preserve suite proof reuse and stale execution inside the group
**Story:** Story 2, negative path 3; Story 4, happy paths 1, 2, and 4
**Type:** happy-path

**Steps:**
1. Update focused gate-loop tests to fail on the new boundary unless a current
   proof is reused and stale/missing proof executes through `FullSuiteVerifier`.
2. Verify the focused tests fail (RED).
3. Keep `runTestSuiteStep` as the native group thunk without duplicating any
   verifier inspection, execution, evidence, or finish logic.
4. Verify EXECUTED/REUSED outcomes join correctly and finish reuses current
   evidence (GREEN).
5. Commit with message: "refactor: retain verifier proof in build group"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts`, `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 9

### Task 11: Characterize ignored coverage output as proof-neutral
**Story:** Story 4, happy path 3
**Type:** infrastructure

**Steps:**
1. Add a focused verifier regression test whose configured suite writes an
   ignored coverage artifact while production and wiring inputs remain fixed.
2. Run the test and record whether existing fingerprint behavior already passes.
3. If RED, make the narrowest fingerprint exclusion fix consistent with current
   git-ignore semantics; otherwise make no production change.
4. Verify a second inspection reuses the proof and source/wiring inputs are
   byte-identical (GREEN).
5. Commit with message: "test: allow ignored coverage output from suite"

**Files:** `src/conductor/test/engine/full-suite-verifier.test.ts`, `src/conductor/src/engine/full-suite-fingerprint.ts`

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 10

### Task 12: Preserve lock, timeout, cancellation, and process cleanup semantics
**Story:** Story 4, negative paths 3 and 4
**Type:** negative-path

**Steps:**
1. Add a group-boundary regression test that injects locked and cancelled suite
   outcomes and waits for the existing verifier/executor terminal result.
2. Run existing focused verifier and executor lock/timeout/process-tree tests.
3. If RED, pass cancellation/terminal outcomes through the native adapter
   without bypassing existing cleanup; do not reimplement the lock or executor.
4. Verify no duplicate execution, false pass, leaked worker, or post-join write
   (GREEN).
5. Commit with message: "test: preserve suite cleanup through native group"

**Files:** `src/conductor/test/engine/deterministic-build-verification-group.test.ts`, `src/conductor/test/engine/full-suite-verifier.test.ts`, `src/conductor/test/engine/full-suite-executor.test.ts`, `src/conductor/src/engine/conductor.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 11

### Task 13: Align resume, invalidation, and completion topology
**Story:** Story 1, happy path 2; Story 2, happy path 1
**Type:** infrastructure

**Steps:**
1. Update exhaustive topology/invalidation/resume tests to expect the joined
   deterministic boundary before `build_review`.
2. Verify the focused registry, rebase, resume-clamp, and completion tests fail
   on stale old-order assertions (RED).
3. Adjust the narrow selector/invalidation surfaces so any stale deterministic
   member blocks review while existing delta-aware proof preservation remains.
4. Verify all focused topology tests pass (GREEN).
5. Commit with message: "fix: align tail state with deterministic group"

**Files:** `src/conductor/src/engine/steps.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/wiring-gate-loop.test.ts`, `src/conductor/test/engine/gate-invalidation.test.ts`, `src/conductor/test/engine/resume-verdict-clamp.test.ts`, `src/conductor/test/integration/rebase-loop.test.ts`, `src/conductor/test/integration/rebase-tail-preserve.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 12

### Task 14: Remove the shipped test-suite skill surface
**Story:** Story 3, happy paths 1 and 2; negative path 2
**Type:** infrastructure

**Steps:**
1. Change catalog/contract tests to require no `skills/test-suite` entry or
   direct skill reference while still requiring the engine step and CLI.
2. Verify the focused contract tests fail (RED).
3. Delete `skills/test-suite/SKILL.md` and remove direct skill references from
   shipped workflow contracts, without deleting the engine step or CLI.
4. Verify catalog integrity and the focused full-suite acceptance contract pass
   (GREEN).
5. Commit with message: "refactor: remove test-suite skill surface"

**Files:** `skills/test-suite/SKILL.md`, `test/test_skill_pipeline_contract.sh`, `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 13

### Task 15: Make model bookkeeping explicitly non-dispatching
**Story:** Story 3, negative path 1
**Type:** negative-path

**Steps:**
1. Add failing policy/table tests asserting `wiring_check` and `test_suite` are
   rendered as model-free engine machinery and cannot enter skill invocation.
2. Verify focused metadata and generated-table tests fail (RED).
3. Adjust canonical metadata/generation while retaining any exhaustive internal
   step-policy placeholders needed for type safety; regenerate the canonical
   model table mechanically.
4. Verify the generated table, skill-invocation sentinel, and provider spy tests
   pass (GREEN).
5. Commit with message: "fix: mark deterministic gates model free"

**Files:** `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/src/engine/skill-invocation.ts`, `src/conductor/src/tools/generate-model-table.ts`, `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/engine/skill-invocation.test.ts`, `HARNESS.md`

**Wired-into:** `src/conductor/src/tools/generate-model-table.ts#renderModelTable`

**Dependencies:** Task 14

### Task 16: Route interactive verification to the deterministic CLI
**Story:** Story 3, happy path 2; negative path 4
**Type:** happy-path

**Steps:**
1. Change the interactive contract test to require `conduct-ts test-suite`
   after BUILD verification and forbid a test-suite skill/model fallback.
2. Verify the focused contract test fails (RED).
3. Update conduct guidance to invoke the standalone adapter directly and route
   its non-zero result back to BUILD remediation.
4. Verify executed/reused/failure guidance and absence of host-specific skill
   syntax (GREEN).
5. Commit with message: "feat: route interactive suite through cli"

**Files:** `skills/conduct/SKILL.md`, `test/test_skill_pipeline_contract.sh`, `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`

**Dependencies:** Task 15

### Task 17: Prune obsolete harness-owned links for both host catalogs
**Story:** Story 3, happy path 3; negative path 3
**Type:** negative-path

**Steps:**
1. Add failing isolated installer tests for obsolete Claude and Codex links,
   absent links, foreign symlinks/files, and unrelated current skills.
2. Verify the shell acceptance test fails (RED).
3. Generalize update reconciliation to remove only obsolete links proven owned
   by the prior complete harness catalog for either host.
4. Verify repeat update is idempotent and preserves all foreign/unrelated
   entries (GREEN).
5. Commit with message: "fix: prune removed skills from both catalogs"

**Files:** `bin/install`, `test/test_codex_skill_installation.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** Task 14

### Task 18: Add the executable skill-link migration
**Story:** Story 3, happy path 3; negative path 3
**Type:** infrastructure

**Steps:**
1. Add a failing release assertion requiring the Unreleased migration to run
   the safe installer reconciliation for this breaking skill-link change.
2. Verify the focused release/install test fails (RED).
3. Add the runnable `bash migration` block that invokes the supported update
   path; do not use a release waiver.
4. Execute the block in an isolated fake home and verify exact-link removal,
   foreign preservation, and idempotency (GREEN).
5. Commit with message: "chore: migrate removed test-suite links"

**Files:** `CHANGELOG.md`, `test/test_codex_skill_installation.sh`, `test/test_release_unreleased_state.sh`

**Wired-into:** `bin/migrate#run_project_migrations`

**Dependencies:** Task 17

### Task 19: Pin the complete deterministic BUILD acceptance matrix
**Story:** Stories 1–4, all Done When outcomes
**Type:** infrastructure

**Steps:**
1. Update the narrow full-flow acceptance fixture to assert concurrent pass,
   cap-one order, single failure, dual failure, no paid review, and downstream
   SHIP ordering using injected internal fakes.
2. Verify the acceptance file fails before the final fixture updates (RED).
3. Make only fixture/contract corrections exposed by the matrix, including the
   operator-approved aggregate-safe synchronization in `engine-store-smoke.test.ts`
   and dedicated-socket isolation in `tmux-leak-guard.test.ts`; do not invoke
   real providers or nest the configured aggregate suite inside Vitest.
4. Run the focused acceptance files, test-covering typecheck, configured lint,
   and confirm all pass (GREEN).
5. Commit with message: "test: pin deterministic build verification flow"

**Files:** `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts`, `src/conductor/test/wiring-gate-loop.test.ts`, `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts`, `src/conductor/test/engine/deterministic-build-verification-group.test.ts`, `src/conductor/test/engine/engine-store-smoke.test.ts`, `src/conductor/test/engine/tmux-leak-guard.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 16, 18

### Task rem-tmux-001: Restore deterministic tmux leak-guard coverage
**Story:** Story 4 cleanup preservation; Task 19 aggregate-suite reliability amendment
**Type:** negative-path

**Steps:**
1. Add a failing injected-runner regression proving a pre-existing session snapshot/reap reports no
   leaks while preserving operator daemon sessions.
2. Verify the focused ordinary test fails without the removed regression (RED).
3. Restore the deterministic regression in `tmux-leak-guard.test.ts` and remove the unused,
   assertion-free real-tmux smoke file; do not add a package command, CI job, or documentation lane.
4. Run the focused tmux leak-guard test, test-covering typecheck, and configured lint; confirm all
   pass (GREEN).
5. Commit with message: "test: restore deterministic tmux leak guard".

**Files:** `src/conductor/test/engine/tmux-leak-guard.test.ts`, `src/conductor/test/smoke/tmux-leak-guard.smoke.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 19

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 ┐
                                                               └→ 17 → 18 ┴→ 19 → rem-tmux-001
```

## Integration Points

- After Task 5: pass/pass fan-out and cap-one degradation are executable.
- After Task 9: all join failure and interruption state is deterministic.
- After Task 13: lifecycle ordering, resume, and invalidation agree end to end.
- After Task 18: source catalog, installed catalogs, and release migration agree.
- After Task rem-tmux-001: all story outcomes and aggregate-safe tmux cleanup guarantees are pinned
  at deterministic seams.

## Coverage Mapping

| Story criterion | Plan tasks |
|---|---|
| S1 happy: concurrent start, SHIP order, cap one | 1, 4, 5, 13, 19 |
| S1 negative: failure blocks review/SHIP, partial result, exhausted cap | 5, 6, 8, 19 |
| S2 happy: attributable pass, dual failure, completion order | 4, 7, 19 |
| S2 negative: one rewind, interruption, stale proof, indeterminate result | 7, 8, 9, 10, 19 |
| S3 happy: engine-native execution, CLI, two-host migration | 3, 14, 16, 17, 18 |
| S3 negative: no provider dispatch, no stale catalog refs, idempotency, CLI failure | 3, 14, 15, 16, 17, 18 |
| S4 happy: proof reuse/execute, coverage output, finish reuse | 10, 11, 19 |
| S4 negative: fail-closed taxonomy, unsafe input mutation contract, lock, cleanup | 8, 11, 12, 19, rem-tmux-001 |

## Verification

- [x] All happy path criteria map to at least one task.
- [x] All negative path criteria map to explicit tasks.
- [x] Every task is scoped to a 2–5 minute RED/GREEN slice.
- [x] Dependencies are explicit and acyclic.
- [x] Every new production surface carries a `Wired-into:` declaration.
- [x] No ordinary test can call a real LLM or third-party service.
- [ ] During implementation, run focused tests first, then the test-covering
      typecheck and configured lint.
- [ ] Before handoff, run the configured aggregate command and
      `test/test_harness_integrity.sh`; the ordinary suite must finish within
      five minutes.
