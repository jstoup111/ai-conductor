# Implementation Plan: Full-suite verification gate (#940)

**Date:** 2026-07-25
**Design:** `.docs/specs/2026-07-25-full-suite-verification-gate.md`
**Architecture:** `.docs/decisions/adr-2026-07-25-content-addressed-full-suite-proof.md`
**Stories:** `.docs/stories/full-suite-verification-gate-940.md`
**Conflict check:** Clean as of 2026-07-25

## Summary

Build one content-addressed aggregate-suite verifier and expose it through a
native `test_suite` BUILD gate, a TypeScript CLI used by direct Claude and
finish, and reusable evidence. Twenty-five small TDD tasks cover configuration,
fingerprinting, execution, evidence, gate routing, workflow guidance, migration,
and end-to-end proof.

## Technical Approach

- Add a project-level `test_suite` configuration block containing one
  project-owned aggregate command, working directory, timeout, additional
  inputs, and relevant environment names. The engine never composes unit and
  acceptance commands itself.
- Implement `full-suite-fingerprint.ts`, `full-suite-evidence.ts`,
  `full-suite-executor.ts`, and `full-suite-verifier.ts` as separately tested
  seams. Reuse equality is the content fingerprint; `HEAD` is provenance only.
- Add `conduct-ts test-suite` as a thin adapter to the verifier. The same
  adapter is the mandated path for earlier aggregate fallbacks, direct
  `/test-suite`, and finish.
- Insert a non-disableable, single-attempt, engine-native `test_suite` step
  after `wiring_check` and before `manual_test`. A failed result uses the
  existing bounded gate-to-BUILD kickback machinery.
- Keep the validation group unchanged. Rebase reevaluates `test_suite`; a
  byte-identical tree reuses evidence while relevant content changes rerun the
  gate before validators.
- Preserve autoresolve and CI-repair post-mutation suite paths and independent
  CI behavior. Remove independent aggregate-suite instructions from ordinary
  TDD, batch, evaluator, conduct, finish-normal, and PR paths.

## Verified Planning Claims

| Claim | Confidence | Evidence |
|---|---:|---|
| `test_suite` can use the existing native-step branch. | 98% | `Conductor.run` already dispatches `complexity`, `worktree`, and `rebase` without an LLM; `wiring_check` provides the deterministic BUILD-kickback precedent. |
| One self-host command covers unit and acceptance tests. | 99% | `src/conductor/package.json` maps `npm test` to `vitest run`; `vitest.config.ts` includes `test/**/*.test.ts`, including `test/acceptance/**`. |
| No new dependency is needed. | 95% | Existing Node APIs, `execa`, Git runner, and atomic-write patterns cover hashing, process execution, timeout, and evidence. |
| A single attempt prevents retrying the same red aggregate suite before BUILD remediation. | 98% | Per-step retry count is resolved from `DEFAULT_STEP_RETRIES`; the specialized post-failure branch can then kick back through the existing capped map. |
| Existing repair suites remain separate. | 99% | `autoresolve.ts` owns `mergeable_autoresolve.suiteCommand`; CI repair owns its worktree suite gate. FR-17 keeps both outside reusable evidence. |

No unconfirmed load-bearing assumption changes this task breakdown.

## Prerequisites

- The approved PRD, stories, conflict report, diagrams, and ADR remain binding.
- Use the existing `execa` dependency; add no package.
- Preserve the legacy Bash conductor.
- Do not fold `test/test_harness_integrity.sh` into the aggregate command; the
  proposed pre-finish integrity step is follow-up work.

## Tasks

### Task 1: Accept valid aggregate-suite configuration

**Story:** Story 3 — configured aggregate operation happy paths  
**Type:** infrastructure

**Steps:**
1. Write failing config/type tests for command, working directory, timeout,
   additional inputs, and environment names.
2. Verify the focused config tests fail.
3. Add `TestSuiteConfig` and `HarnessConfig.test_suite`; accept the top-level
   block and validate its valid shape.
4. Verify the focused tests pass.
5. Commit with message: `feat(config): declare aggregate test suite`

**Files:** `src/conductor/src/types/config.ts`; `src/conductor/src/engine/config.ts`; `src/conductor/test/engine/config.test.ts`; `src/conductor/test/types/test-suite-config-type.test.ts`  
**Wired-into:** `src/conductor/src/engine/config.ts#validateConfig`  
**Dependencies:** none

### Task 2: Reject malformed suite declarations

**Story:** Story 3 — missing, empty, malformed, invalid-directory configuration paths  
**Type:** negative-path

**Steps:**
1. Add failing table tests for unknown keys, blank command, invalid timeout,
   non-string inputs/environment entries, and escaping working directories.
2. Verify the table fails against Task 1.
3. Implement fail-closed validation with field-specific messages.
4. Verify the table passes without weakening missing-block behavior at load
   time (absence remains legal globally but blocking at verification).
5. Commit with message: `test(config): reject invalid aggregate suite settings`

**Files:** `src/conductor/src/engine/config.ts`; `src/conductor/test/engine/config.test.ts`  
**Wired-into:** same as Task 1  
**Dependencies:** Task 1

### Task 3: Fingerprint tracked, dirty, and untracked verification inputs

**Story:** Stories 4 and 5 — content identity, dirty/untracked inputs, docs-only preservation  
**Type:** happy-path

**Steps:**
1. Write failing scratch-repo tests for tracked content, unstaged edits,
   staged edits, untracked non-ignored files, deletion markers, modes, and
   documentation exclusion.
2. Verify the focused fingerprint tests fail.
3. Implement deterministic path enumeration and streaming content hashing in
   `full-suite-fingerprint.ts`; record `HEAD` separately from the digest.
4. Verify the focused tests pass.
5. Commit with message: `feat(test-suite): fingerprint working tree inputs`

**Files:** `src/conductor/src/engine/full-suite-fingerprint.ts`; `src/conductor/test/engine/full-suite-fingerprint.test.ts`  
**Wired-into:** `none (inert until src/conductor/src/engine/full-suite-verifier.ts)`  
**Dependencies:** Task 1

### Task 4: Fingerprint suite config, extra inputs, and environment safely

**Story:** Story 5 — config/dependency/migration/test-infra/env invalidation and indeterminate reads  
**Type:** negative-path

**Steps:**
1. Add failing cases for command/working-directory changes, lockfiles,
   migrations, test setup, declared ignored inputs, set→unset environment
   changes, missing required inputs, and unreadable files.
2. Verify the focused tests fail.
3. Extend the fingerprint to include normalized configuration, explicit inputs,
   and environment values only inside the combined digest; return typed
   indeterminate reasons on required-input failure.
4. Verify tests prove evidence never exposes environment values.
5. Commit with message: `feat(test-suite): invalidate on declared inputs`

**Files:** `src/conductor/src/engine/full-suite-fingerprint.ts`; `src/conductor/test/engine/full-suite-fingerprint.test.ts`  
**Wired-into:** same as Task 3  
**Dependencies:** Task 3

### Task 5: Persist successful suite evidence atomically

**Story:** Stories 4 and 5 — reusable proof and status visibility  
**Type:** infrastructure

**Steps:**
1. Write failing tests for the versioned PASS shape and temp-file rename.
2. Verify the evidence tests fail.
3. Implement typed read/write helpers for
   `.pipeline/test-suite-evidence.json`, including outcome, reason, fingerprint,
   provenance SHA, command, timings, exit code, and bounded output.
4. Verify atomic PASS round-trip tests pass.
5. Commit with message: `feat(test-suite): persist reusable pass evidence`

**Files:** `src/conductor/src/engine/full-suite-evidence.ts`; `src/conductor/test/engine/full-suite-evidence.test.ts`  
**Wired-into:** `none (inert until src/conductor/src/engine/full-suite-verifier.ts)`  
**Dependencies:** Task 1

### Task 6: Fail closed on corrupt evidence and safe diagnostic output

**Story:** Stories 3, 4, and 5 — corrupt/missing proof, bounded failures, secret safety  
**Type:** negative-path

**Steps:**
1. Add failing tests for missing/corrupt/unknown-version evidence, torn-write
   simulation, FAIL records, oversized stdout/stderr, and secret-value absence.
2. Verify tests fail.
3. Implement tolerant reads that classify evidence as unusable, atomic FAIL
   writes, and deterministic head/tail output bounding.
4. Verify corrupt evidence never passes and diagnostics retain first/last
   failure context.
5. Commit with message: `fix(test-suite): fail closed on invalid evidence`

**Files:** `src/conductor/src/engine/full-suite-evidence.ts`; `src/conductor/test/engine/full-suite-evidence.test.ts`  
**Wired-into:** same as Task 5  
**Dependencies:** Task 5

### Task 7: Execute the aggregate command successfully

**Story:** Story 3 — exact command, working directory, timeout happy path  
**Type:** happy-path

**Steps:**
1. Write a failing injected-runner test for command/cwd/env forwarding and
   duration/exit/output capture.
2. Verify the executor test fails.
3. Implement `full-suite-executor.ts` using `execa` with the declared cwd and
   inherited environment.
4. Verify the focused success test passes.
5. Commit with message: `feat(test-suite): execute aggregate project command`

**Files:** `src/conductor/src/engine/full-suite-executor.ts`; `src/conductor/test/engine/full-suite-executor.test.ts`  
**Wired-into:** `none (inert until src/conductor/src/engine/full-suite-verifier.ts)`  
**Dependencies:** Task 1

### Task 8: Classify launch and non-zero failures

**Story:** Story 3 — unresolved, unlaunchable, invalid-directory, and non-zero paths  
**Type:** negative-path

**Steps:**
1. Add failing executor tests for command-not-found, permission error, invalid
   cwd, signal exit, and ordinary non-zero exit.
2. Verify the focused tests fail.
3. Return stable typed failure reasons with bounded actionable output.
4. Verify every failure remains non-passing and distinguishable.
5. Commit with message: `fix(test-suite): classify process launch failures`

**Files:** `src/conductor/src/engine/full-suite-executor.ts`; `src/conductor/test/engine/full-suite-executor.test.ts`  
**Wired-into:** same as Task 7  
**Dependencies:** Task 7

### Task 9: Terminate timed-out process trees

**Story:** Story 3 — timeout and resource-cleanup negative path  
**Type:** negative-path

**Steps:**
1. Write a failing real-process test whose child would outlive its parent.
2. Verify timeout leaves the sentinel child alive before the fix.
3. Add process-group termination, bounded grace, and forced cleanup.
4. Verify timeout returns the stable reason and no child/sentinel survives.
5. Commit with message: `fix(test-suite): clean up timed out process trees`

**Files:** `src/conductor/src/engine/full-suite-executor.ts`; `src/conductor/test/engine/full-suite-executor.test.ts`; `src/conductor/test/fixtures/test-suite-timeout-child.mjs`  
**Wired-into:** same as Task 7  
**Dependencies:** Task 8

### Task 10: Execute and record a current aggregate proof

**Story:** Stories 3 and 4 — first execution and current PASS creation  
**Type:** happy-path

**Steps:**
1. Write a failing verifier test for no evidence → fingerprint → execute →
   atomic PASS.
2. Verify the test fails.
3. Implement `FullSuiteVerifier.ensure()` by composing config, fingerprint,
   executor, and evidence seams.
4. Verify the test reports `EXECUTED` with one process call.
5. Commit with message: `feat(test-suite): ensure current aggregate proof`

**Files:** `src/conductor/src/engine/full-suite-verifier.ts`; `src/conductor/test/engine/full-suite-verifier.test.ts`  
**Wired-into:** `none (inert until src/conductor/src/engine/test-suite-cli.ts)`  
**Dependencies:** Tasks 4, 6, 9

### Task 11: Reuse current evidence across callers and SHA churn

**Story:** Story 4 — explicit gate/finish/fallback reuse and byte-identical rebase  
**Type:** happy-path

**Steps:**
1. Add failing tests for repeated ensure calls, earlier recorded fallback,
   session changes, and changed provenance SHA with identical content.
2. Verify the tests execute more than once before the fix.
3. Implement `inspect()` and the identical-fingerprint `REUSED` branch.
4. Verify one process call satisfies every unchanged caller and SHA is
   provenance only.
5. Commit with message: `feat(test-suite): reuse content-current evidence`

**Files:** `src/conductor/src/engine/full-suite-verifier.ts`; `src/conductor/test/engine/full-suite-verifier.test.ts`  
**Wired-into:** same as Task 10  
**Dependencies:** Task 10

### Task 12: Replace stale evidence and block indeterminate freshness

**Story:** Stories 4 and 5 — stale categories, mixed docs/code, corrupt proof, indeterminate inputs  
**Type:** negative-path

**Steps:**
1. Add a failing verifier matrix for every required mutation category,
   docs-only reuse, mixed changes, failed prior evidence, corrupt evidence, and
   fingerprint failure.
2. Verify the matrix fails.
3. Implement `STALE` reason propagation, rerun-and-replace behavior, and
   fail-closed indeterminate evidence.
4. Verify each row reports `EXECUTED`, `REUSED`, `STALE`, or `FAILED` with a
   concrete reason.
5. Commit with message: `fix(test-suite): invalidate stale aggregate proofs`

**Files:** `src/conductor/src/engine/full-suite-verifier.ts`; `src/conductor/test/engine/full-suite-verifier.test.ts`  
**Wired-into:** same as Task 10  
**Dependencies:** Task 11

### Task 13: Expose the verifier through `conduct-ts test-suite`

**Story:** Stories 2, 4, and 6 — shared TypeScript entry for direct/fallback callers  
**Type:** happy-path

**Steps:**
1. Write failing parser/dispatch tests for `conduct-ts test-suite` from a
   project root and for visible EXECUTED/REUSED output.
2. Verify the command is currently unrecognized.
3. Add `test-suite-cli.ts` and dispatch it before normal pipeline parsing in
   `index.ts`.
4. Verify the CLI returns 0 for executed/reused PASS.
5. Commit with message: `feat(cli): add aggregate test-suite command`

**Files:** `src/conductor/src/engine/test-suite-cli.ts`; `src/conductor/src/index.ts`; `src/conductor/test/engine/test-suite-cli.test.ts`; `src/conductor/test/acceptance/test-suite-cli-real-binary.acceptance.test.ts`  
**Wired-into:** `src/conductor/src/index.ts#main`  
**Dependencies:** Task 12

### Task 14: Make CLI misuse and verification failure non-zero

**Story:** Stories 2 and 3 — direct failure, malformed invocation, no fallthrough  
**Type:** negative-path

**Steps:**
1. Add failing tests for extra/unknown flags, missing config, stale rerun
   failure, timeout, and recognized-command misuse.
2. Verify failures currently fall through or return the wrong status.
3. Implement guide/error output, exit 1 on every blocking result, and actionable
   direct-Claude remediation text.
4. Verify no malformed invocation starts the conductor pipeline.
5. Commit with message: `fix(cli): fail closed on test-suite errors`

**Files:** `src/conductor/src/engine/test-suite-cli.ts`; `src/conductor/src/index.ts`; `src/conductor/test/engine/test-suite-cli.test.ts`; `src/conductor/test/acceptance/test-suite-cli-real-binary.acceptance.test.ts`  
**Wired-into:** same as Task 13  
**Dependencies:** Task 13

### Task 15: Register the native `test_suite` step

**Story:** Story 1 — explicit BUILD gate topology  
**Type:** infrastructure

**Steps:**
1. Update failing exhaustive-order tests to expect `test_suite` after
   `wiring_check` and before `manual_test`.
2. Verify compile/tests fail on missing exhaustive entries.
3. Add the StepName, non-disableable BUILD/gating/loop definition, manual-test
   prerequisite, one-attempt default, auto review, and mechanical model-table
   metadata/sentinels.
4. Regenerate the model table and verify exhaustive maps compile.
5. Commit with message: `feat(engine): register native test-suite gate`

**Files:** `src/conductor/src/types/steps.ts`; `src/conductor/src/engine/steps.ts`; `src/conductor/src/engine/resolved-config.ts`; `src/conductor/src/engine/provider-model-policy.ts`; `src/conductor/src/engine/model-table-metadata.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/steps.test.ts`; `src/conductor/test/engine/resolved-config.test.ts`; `src/conductor/test/model-table-metadata.test.ts`; `HARNESS.md`  
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`  
**Dependencies:** Task 1

### Task 16: Run the native gate before SHIP

**Story:** Story 1 — passing gate and validator ordering  
**Type:** happy-path

**Steps:**
1. Write a failing integration test that injects the verifier and asserts the
   call order through `wiring_check`, `test_suite`, and `manual_test`.
2. Verify `manual_test` currently follows wiring directly.
3. Add `runTestSuiteStep()` to the engine-native dispatch branch and a
   completion predicate that accepts only current PASS evidence without
   launching a process.
4. Verify PASS advances and SHIP remains undispatched until the gate passes.
5. Commit with message: `feat(engine): execute test-suite before ship`

**Files:** `src/conductor/src/engine/conductor.ts`; `src/conductor/src/engine/artifacts.ts`; `src/conductor/src/engine/complete-verifier.ts`; `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts`; `src/conductor/test/engine/full-suite-verifier.test.ts`; `src/conductor/test/engine/complete-verifier.test.ts`  
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`  
**Dependencies:** Tasks 12, 15

### Task 17: Kick failed verification back to BUILD once per lap

**Story:** Stories 1 and 3 — failure evidence, BUILD remediation, bounded fail-closed behavior  
**Type:** negative-path

**Steps:**
1. Add failing gate-loop cases for non-zero, missing config, launch error,
   timeout, and indeterminate fingerprint.
2. Verify a failure currently halts generically or retries the same command.
3. Add the `test_suite` failure branch that attaches evidence, reopens BUILD,
   marks downstream steps stale, and uses the existing kickback cap.
4. Verify the one-attempt step never reruns unchanged before BUILD and a
   persistent failure reaches the existing bounded HALT.
5. Commit with message: `feat(engine): route suite failures to build`

**Files:** `src/conductor/src/engine/conductor.ts`; `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts`; `src/conductor/test/engine/conductor.test.ts`  
**Wired-into:** same as Task 16  
**Dependencies:** Task 16

### Task 18: Reevaluate the suite gate after rebase without SHA-only reruns

**Story:** Stories 4 and 5 — byte-identical rebase reuse and relevant-delta invalidation  
**Type:** negative-path

**Steps:**
1. Add failing rebase-loop tests for identical content/new SHA, docs-only
   delta, and source/test/config delta.
2. Verify the new gate is absent from current rebase decisions.
3. Add `test_suite` to invalidation/tail-restaging surfaces and consult its
   content-current predicate before validation-group redispatch.
4. Verify identical/docs-only content reuses while relevant changes run the
   gate before SHIP again.
5. Commit with message: `feat(rebase): revalidate aggregate suite by content`

**Files:** `src/conductor/src/engine/gate-invalidation.ts`; `src/conductor/src/engine/rebase.ts`; `src/conductor/src/engine/conductor.ts`; `src/conductor/test/engine/gate-invalidation.test.ts`; `src/conductor/test/engine/rebase.test.ts`; `src/conductor/test/integration/rebase-tail-preserve.test.ts`; `src/conductor/test/integration/rebase-loop.test.ts`  
**Wired-into:** `src/conductor/src/engine/rebase.ts#applyRebaseVerdicts, src/conductor/src/engine/conductor.ts#advanceTail`  
**Dependencies:** Task 17

### Task 19: Make finish reuse current evidence and supply standalone fallback

**Story:** Story 7 — normal reuse, standalone missing/stale execution, blocking failure  
**Type:** happy-path

**Steps:**
1. Add failing skill-contract and completion-flow fixtures for current reuse,
   standalone fallback, and fallback failure.
2. Verify finish still mandates an unconditional fresh process run.
3. Rewrite finish's suite check to call `conduct-ts test-suite`, interpret
   EXECUTED/REUSED, and stop before choices on non-zero.
4. Verify current evidence launches nothing and missing/stale evidence executes
   exactly once.
5. Commit with message: `feat(finish): reuse aggregate suite evidence`

**Files:** `skills/finish/SKILL.md`; `test/test_skill_pipeline_contract.sh`; `src/conductor/test/acceptance/finish-step-engine-repair.acceptance.test.ts`; `src/conductor/test/engine/finish-record-cli.test.ts`  
**Wired-into:** `skills/finish/SKILL.md#verification`  
**Dependencies:** Task 14

### Task 20: Emit visible executed, reused, stale, and failed status

**Story:** Story 5 — observable state and reasons without secret leakage  
**Type:** happy-path

**Steps:**
1. Add failing event-type/subscriber tests for aggregate-suite status and
   redacted reasons.
2. Verify the verifier result is not visible through engine event output.
3. Add a structured `test_suite_verification` event and render it through
   existing terminal/JSON subscribers.
4. Verify every status renders its reason and serialized output contains no
   declared environment value.
5. Commit with message: `feat(ui): report aggregate suite verification status`

**Files:** `src/conductor/src/types/events.ts`; `src/conductor/src/engine/conductor.ts`; `src/conductor/src/ui/subscriber.ts`; `src/conductor/src/ui/json-stdout-subscriber.ts`; `src/conductor/test/types/events.test.ts`; `src/conductor/test/ui/subscriber-events.test.ts`; `src/conductor/test/ui/json-stdout-subscriber.test.ts`  
**Wired-into:** `src/conductor/src/ui/subscriber.ts#createSubscriber, src/conductor/src/ui/json-stdout-subscriber.ts#createJsonStdoutSubscriber`  
**Dependencies:** Task 16

### Task 21: Add the direct-Claude `/test-suite` step

**Story:** Story 2 — direct ordering, pass/reuse, failure remediation, no Bash  
**Type:** happy-path

**Steps:**
1. Add failing guidance-contract tests for `/test-suite` after BUILD and before
   `/manual-test`.
2. Verify no first-class direct step exists.
3. Create `skills/test-suite/SKILL.md` around the TypeScript CLI and update
   conduct/HARNESS flow guidance.
4. Verify failure blocks SHIP and routes to `/tdd` or `/pipeline` without
   referencing the legacy Bash conductor.
5. Commit with message: `feat(skills): add direct test-suite gate`

**Files:** `skills/test-suite/SKILL.md`; `skills/conduct/SKILL.md`; `HARNESS.md`; `test/test_skill_pipeline_contract.sh`; `test/test_harness_integrity.sh`  
**Wired-into:** `skills/conduct/SKILL.md#test-suite`  
**Dependencies:** Task 14

### Task 22: Scope ordinary implementation, boundary, join, and evaluator tests

**Story:** Story 6 — scoped defaults and shared aggregate fallback  
**Type:** refactor

**Steps:**
1. Add failing contract assertions for affected tests in TDD/GREEN, debugging,
   pipeline batches, parallel joins, final evaluator/code review, and conduct
   progression.
2. Verify old unconditional full-suite language is detected.
3. Replace it with scoped/union-of-affected guidance; direct every legitimate
   broad fallback through `conduct-ts test-suite` with a named reason.
4. Verify known scoped failures still block their current activity.
5. Commit with message: `docs(skills): scope intermediate verification`

**Files:** `skills/tdd/SKILL.md`; `skills/tdd/references/green.md`; `skills/pipeline/SKILL.md`; `skills/code-review/SKILL.md`; `skills/debugging/SKILL.md`; `skills/conduct/SKILL.md`; `test/test_skill_pipeline_contract.sh`; `HARNESS.md`  
**Wired-into:** `none (no new production surface)`  
**Dependencies:** Tasks 13, 21

### Task 23: Remove PR reruns while preserving CI and repair checks

**Story:** Stories 8 and 9 — PR/CI separation and mutation-specific repair invariants  
**Type:** negative-path

**Steps:**
1. Add failing contract/regression assertions that `/pr` has no local aggregate
   run while CI, autoresolve, and CI repair still do.
2. Verify `/pr` currently mandates a suite and record the untouched repair
   baselines.
3. Remove the `/pr` suite instruction; leave workflow/autoresolve/CI-repair
   execution paths unchanged.
4. Verify local evidence cannot affect CI job selection and cannot suppress
   either post-mutation repair check.
5. Commit with message: `docs(ship): separate local proof from pr and ci`

**Files:** `skills/pr/SKILL.md`; `.github/workflows/ci.yml`; `src/conductor/src/engine/autoresolve.ts`; `src/conductor/src/engine/ci-fix.ts`; `src/conductor/test/engine/autoresolve.test.ts`; `src/conductor/test/engine/ci-fix.test.ts`; `test/test_skill_pipeline_contract.sh`  
**Wired-into:** `none (no new production surface)`  
**Dependencies:** Task 19

### Task 24: Document and configure the fail-closed migration

**Story:** Story 3 — project declaration and actionable migration  
**Type:** infrastructure

**Steps:**
1. Add failing docs/config checks for an aggregate example and this repo's
   self-host declaration.
2. Verify the project currently has no `test_suite` block.
3. Add `npm test` with `working_directory: src/conductor` to this repo, update
   the config template and user docs, and add an Unreleased migration note.
4. Verify docs state missing configuration blocks and suite composition remains
   project-owned; keep harness integrity explicitly separate.
5. Commit with message: `docs(config): migrate projects to aggregate suite gate`

**Files:** `.ai-conductor/config.yml`; `templates/ai-conductor-config.yml.template`; `README.md`; `src/conductor/README.md`; `CHANGELOG.md`; `test/test_harness_integrity.sh`; `test/check_task2_getting_started.sh`  
**Wired-into:** `src/conductor/src/engine/full-suite-verifier.ts#ensure`  
**Dependencies:** Tasks 2, 21

### Task 25: Prove the complete run/reuse/failure flow

**Story:** Stories 1–9 — cross-surface acceptance and once-only metric  
**Type:** happy-path

**Steps:**
1. Add failing end-to-end fixtures for normal automated flow, earlier fallback,
   direct CLI, finish reuse, standalone finish, relevant mutation, docs-only
   mutation, and failing BUILD kickback.
2. Verify the scenarios fail before the complete wiring is present.
3. Wire any missing adapters only; do not add new semantics beyond the approved
   tasks.
4. Verify a counter records one aggregate launch across unchanged
   fallback→gate→finish→PR, failures block every SHIP validator, and repair/CI
   regressions remain green.
5. Commit with message: `test(test-suite): prove once-only delivery flow`

**Files:** `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts`; `src/conductor/test/integration/full-flow.test.ts`; `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts`; `test/test_skill_pipeline_contract.sh`  
**Wired-into:** `none (no new production surface)`  
**Dependencies:** Tasks 18, 20, 22, 23, 24

## Task Dependency Graph

```text
1 ──▶ 2
├──▶ 3 ──▶ 4 ───────────────┐
├──▶ 5 ──▶ 6 ───────────────┤
└──▶ 7 ──▶ 8 ──▶ 9 ─────────┤
                             ▼
                            10 ──▶ 11 ──▶ 12 ──▶ 13 ──▶ 14

1 ──▶ 15 ───────────────────────────┐
12 + 15 ──▶ 16 ──▶ 17 ──▶ 18       │
16 ──▶ 20                           │
14 ──▶ 19 ──▶ 23                    │
14 ──▶ 21 ──▶ 22                    │
2 + 21 ──▶ 24                       │
18 + 20 + 22 + 23 + 24 ───────────▶ 25
```

## Integration Points

- After Task 12: the shared verifier can execute, reuse, invalidate, and fail
  closed entirely through injected tests.
- After Task 14: direct callers and earlier aggregate fallbacks have a stable
  TypeScript CLI.
- After Task 17: automated flow has the requested BUILD kickback before SHIP.
- After Task 19: normal finish reuses and standalone finish remains safe.
- After Task 24: consumer migration and this repository's aggregate command are
  explicit.
- After Task 25: automated, direct, finish, PR, repair, and CI boundaries are
  proven together.

## Acceptance-Criteria Coverage

| Story | Happy paths | Negative paths | Tasks |
|---|---|---|---|
| 1 — automated pre-SHIP gate | ordering; pass advances | upstream miss; failure kickback | 15, 16, 17, 25 |
| 2 — direct Claude parity | required step; execute/reuse | bypass blocked; failure routes implementation | 13, 14, 21, 25 |
| 3 — aggregate declaration | exact project command; unit+acceptance aggregate | malformed/missing/unlaunchable/timeout/nonzero | 1, 2, 7, 8, 9, 10, 14, 24 |
| 4 — current-proof reuse | gate/finish/fallback/rebase reuse | stale/unrecorded/SHA-only errors | 3, 5, 10, 11, 12, 18, 25 |
| 5 — invalidation and visibility | all input categories; docs-only; dirty/untracked | indeterminate; mixed diff; SHA metadata | 3, 4, 6, 12, 18, 20, 25 |
| 6 — scoped intermediates | scoped cycles/batches/joins/evaluator; recorded fallback | scoped failure; no duplicate direct command | 13, 22, 25 |
| 7 — finish fallback | current reuse; standalone run | fallback failure; no session-time rerun | 19, 25 |
| 8 — PR and CI boundaries | no PR run; independent CI | unsupported PR invocation; CI overrides local | 23, 25 |
| 9 — repair invariants | autoresolve and CI-fix checks remain | reusable proof cannot suppress either | 23, 25 |

## Scope Sanity Check

The plan has 25 tasks (warning band, approximately 2–3 hours at the mandated
2–5 minute task size plus test runtime). Splitting the verifier, engine gate,
and caller migration into separately shippable features would create an unsafe
intermediate state—either evidence with no gate or a gate with duplicated
callers—so the vertical slice remains one feature. The dependency graph keeps
the pure seams independently reviewable.

## Verification

- [x] Every happy-path criterion maps to at least one task.
- [x] Every negative-path criterion maps to an explicit task.
- [x] Tasks are ordered RED → GREEN and scoped to 2–5 minute edits.
- [x] Dependencies are explicit and acyclic.
- [x] Every new production surface has a `Wired-into:` contract.
- [x] Legacy Bash, harness-integrity scheduling, autoresolve behavior,
      CI-repair behavior, and CI authority remain outside the optimization.
