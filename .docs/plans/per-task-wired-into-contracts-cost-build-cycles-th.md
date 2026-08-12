# Implementation Plan: Move wiring judgement into build_review (#1496)

**Date:** 2026-08-11
**Stem:** per-task-wired-into-contracts-cost-build-cycles-th
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/per-task-wired-into-contracts-cost-build-cycles-th.md
**Conflict check:** .docs/conflicts/per-task-wired-into-contracts-cost-build-cycles-th.md — PASSED
**Complexity:** .docs/complexity/per-task-wired-into-contracts-cost-build-cycles-th.md
**Design:** .docs/architecture/2026-08-11-remove-wiring-check-gate.md
**Architecture review:** .docs/decisions/review-2026-08-11-remove-wiring-check-gate-1496.md — APPROVED, 5 conditions
**ADR:** .docs/decisions/adr-2026-08-11-wiring-judged-in-build-review.md — APPROVED
**ADR:** .docs/decisions/adr-2026-08-11-deprecated-no-op-step-retirement.md — APPROVED

## Summary

Delete the wiring probe and the per-task `**Wired-into:**` contract layer, move the reachability
judgement into `build_review` as a fifth rubric item fed by the retained `wiring.entry_points`
config, and retain `wiring_check` as a deprecated no-op that emits a spine event so every existing
reference to the step name keeps resolving. 17 tasks: 2 for the verdict schema, 3 for the rubric
item, 5 for the no-op step and its event, 2 for the DECIDE-side removals, 2 for the module deletion,
1 regression fence, and 2 for documentation.

## Technical Approach

- **Verdict schema first.** `.pipeline/build-review.json` gains `rubric.wiring` and
  `findings.wiring`. A verdict lacking the key reads as *not judged* — never as a pass — which is
  what stops a pre-change artifact from silently satisfying the new item (review condition C3).
  Landing this before the rubric item means the grader never writes a shape the validator rejects.
- **Rubric item.** `buildGraderPrompt` (`build-review-prompt.ts:16`) gains a fifth item worded as a
  **static** property of the diff — is each new production surface called from a path reaching a
  configured entry point — so it does not contradict the existing disclaimer at `:42-44` that
  runtime behavior is `manual_test`'s mandate (condition C1). The entry points come from
  `config.wiring.entry_points`, rendered into the prompt verbatim; the config key and this repo's
  four curated roots are **retained**, only the import-graph walk that consumed them is deleted
  (conflict-check resolution 1). With the key unset the item reports not-judged rather than failing.
- **Deprecated no-op step.** The `wiring_check` completion predicate (`artifacts.ts:2586`) collapses
  to an unconditional pass that reads nothing and dispatches nothing. The step definition stays in
  the registry, so `build_review`'s `prerequisites: ['wiring_check','test_suite']` (`steps.ts:184`),
  in-flight `conduct-state.json`, and consumer `settings.json` step-keyed config all keep resolving
  — no `Unknown step` throw is reachable (`adr-2026-08-11-deprecated-no-op-step-retirement`).
- **Deprecation notice on the spine.** A new `ConductorEvent` variant, emitted through the existing
  emitter and rendered by the existing `renderDaemonEvent` switch (`daemon-cli.ts:2041`). Not a
  `log()` call — a bare log would be invisible to the daemon renderer, the UI subscriber, and the
  OTel exporter alike.
- **Removals.** `landSpec`'s 4b-ii anchor gate (`land-spec.ts:254-290`), the
  `conduct-ts validate-wired-into` subcommand, the `wiring_check → build` kickback routing, the
  `BuildReviewGateInstruction` feed, and the three modules with their six test files.
- **Explicitly out of scope.** `parsePlanTaskPaths`, the `**Files:**` grammar, and the seal's
  branching on `hasFilesLineByTaskId` (condition C2). Only `WIRED_INTO_LINE` leaves
  `plan-task-parse.ts`. Removing `**Files:**` would push the seal onto its prose-backtick fallback
  and *increase* land rejections — the opposite of this feature's purpose.
- **Test isolation.** Every test drives the real internal flow against temp fixtures; the grader is
  exercised through a faithful fake, never a live LLM. No third-party call is added.

## Prerequisites

- Accepted stories and a clean conflict check are present.
- Both ADRs are APPROVED.
- No schema migration, external service, database, port, or fixture installation is required.

## Task Dependency Graph

```
T1 ─▶ T2 ─┐
          ├─▶ T3 ─▶ T4 ─▶ T5 ─┐
                              ├─▶ T11 ─▶ T12 ─┐
T6 ─▶ T7 ─▶ T8 ─▶ T9 ─▶ T10 ─┘                ├─▶ T13 ─▶ T14 ─▶ T15 ─▶ T16 ─▶ T17
```

T1–T2 (verdict schema) precede T3–T5 (the rubric item) so the grader never writes a shape the
validator rejects. T6–T10 (the no-op step, its event, and kickback removal) are independent of the
rubric work and may proceed in parallel. Both arms must complete before T11–T12 (DECIDE-side
removals) and T13–T14 (module deletion), because deleting the probe requires the predicate to
already be a no-op. T15 is the regression fence, T16–T17 close documentation.

## Tasks

### Task 1: RED — a verdict lacking the wiring key is not judged
**Story:** ST-1496-5
**Type:** negative-path

**Steps:**
1. Write failing tests for the `build_review` verdict validator: a verdict with no `wiring` key in
   `rubric` reads as not-judged and does NOT satisfy the gate; a `rubric.wiring` that is not a
   boolean fails closed; `rubric.wiring: false` with missing or empty `findings.wiring` fails closed
   naming the missing findings.

> **Amended 2026-08-12 by operator recovery:** The final clause above has reversed polarity.
> Each `rubric` boolean marks whether that item failed, so missing or empty `findings.wiring`
> fails closed when `rubric.wiring: true`, not when it is `false`.

2. Verify the tests fail because the validator has no `wiring` awareness.
3. Implement: nothing.
4. Commit: "test(build-review): specify wiring rubric key compatibility"

**Files likely touched:**
- `src/conductor/test/engine/build-review-verdict.test.ts` — new failing specs

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: GREEN — the verdict schema carries the wiring rubric item
**Story:** ST-1496-5
**Type:** happy-path

**Steps:**
1. Add happy-path tests: a five-item verdict with all items true validates and passes; a verdict
   with `rubric.wiring: false` and a populated `findings.wiring` validates and fails the gate.

> **Amended 2026-08-12 by operator recovery:** Both polarity statements above are corrected:
> a five-item verdict with all items `false` validates and passes; a verdict with
> `rubric.wiring: true` and populated `findings.wiring` validates and fails the gate.

2. Verify they fail.
3. Extend the verdict type and its validator with `rubric.wiring` and `findings.wiring`, treating an
   absent key as not-judged rather than as a pass.
4. Verify all Task 1 and Task 2 tests pass.
5. Commit: "feat(build-review): add wiring to the verdict rubric schema"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — verdict type and validator
- `src/conductor/test/engine/build-review-verdict.test.ts` — happy-path specs

**Wired-into:** src/conductor/src/engine/artifacts.ts#BUILD_REVIEW_VERDICT
**Dependencies:** Task 1

### Task 3: RED — configured entry points reach the grader prompt
**Story:** ST-1496-1
**Type:** negative-path

**Steps:**
1. Write failing tests for `buildGraderPrompt`: when `config.wiring.entry_points` is set the prompt
   contains each configured root verbatim; when the key is absent or empty the prompt instructs the
   grader to report the wiring item as not-judged rather than to infer entry points.
2. Verify the tests fail because the prompt builder has no entry-point input.
3. Implement: nothing.
4. Commit: "test(build-review): specify entry-point rendering in the grader prompt"

**Files likely touched:**
- `src/conductor/test/engine/build-review-prompt.test.ts` — new failing specs

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 4: GREEN — the grader prompt carries the wiring rubric item
**Story:** ST-1496-1
**Type:** happy-path

**Steps:**
1. Add happy-path tests asserting the prompt lists five rubric items, states the all-or-FAIL rule
   over five, and describes wiring as a static property of the diff without contradicting the
   runtime-behavior disclaimer.
2. Verify they fail.
3. Extend `buildGraderPrompt` with the fifth rubric item and the rendered entry points, and update
   the verdict JSON schema block in the prompt to include `wiring`.
4. Instruct the grader that a plan task which states in its own Steps that it ships scaffolding for
   a later task or feature has declared intentional non-wiring: honor it and do not fail the item on
   those symbols. Silence is never an implicit waiver. The approved plan is already a grader input,
   so no new grammar, waiver file, or per-task contract is introduced — the committed plan is the
   reviewable record (closes outcome-4).
5. Verify Task 3 and Task 4 tests pass.
6. Commit: "feat(build-review): judge wiring reachability as a fifth rubric item"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — fifth item, entry points, schema block
- `src/conductor/src/engine/build-review-inputs.ts` — entry points on the inputs type
- `src/conductor/test/engine/build-review-prompt.test.ts` — happy-path specs

**Wired-into:** src/conductor/src/engine/build-review-prompt.ts#buildGraderPrompt
**Dependencies:** Task 3

### Task 5: The all-or-FAIL evaluation covers five items
**Story:** ST-1496-1
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test driving an unwired export through `build_review` with a faithful
   fake grader: the verdict is FAIL, `findings.wiring` names the symbol, and the gate kicks back to
   `build` through the existing `build_review` route with no new route added.
2. Verify it fails.
3. Wire the `wiring` item into the all-or-FAIL evaluation wherever the four existing items are
   evaluated, and confirm a Small-tier feature still runs the item.
4. Verify the acceptance test passes.
5. Commit: "feat(build-review): fail the verdict on an unwired production surface"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — all-or-FAIL evaluation
- `src/conductor/test/acceptance/wiring-judged-in-build-review.acceptance.test.ts` — new

**Wired-into:** src/conductor/src/engine/artifacts.ts#BUILD_REVIEW_VERDICT
**Dependencies:** Task 4

### Task 6: RED — the deprecation event variant is specified
**Story:** ST-1496-2
**Type:** negative-path

**Steps:**
1. Write failing tests for the new `ConductorEvent` deprecation variant: it carries the step name
   and an ADR reference, it is persisted by `EventPersister` to `.pipeline/events.jsonl`, and an
   existing consumer reading unknown variants ignores it without throwing.
2. Verify the tests fail because the variant does not exist.
3. Implement: nothing.
4. Commit: "test(events): specify the deprecated-step notice variant"

**Files likely touched:**
- `src/conductor/test/engine/events-deprecated-step.test.ts` — new failing specs

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 7: GREEN — the deprecation event variant exists and renders
**Story:** ST-1496-2
**Type:** happy-path

**Steps:**
1. Add a happy-path test that the daemon renderer prints the notice through its existing switch.
2. Verify it fails.
3. Add the variant to the `ConductorEvent` union and a case to `renderDaemonEventUnsafe`.
4. Verify Task 6 and Task 7 tests pass.
5. Commit: "feat(events): add the deprecated-step notice variant and its renderer case"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new union member
- `src/conductor/src/daemon-cli.ts` — renderer case
- `src/conductor/test/engine/events-deprecated-step.test.ts` — happy-path specs

**Wired-into:** src/conductor/src/daemon-cli.ts#renderDaemonEvent
**Dependencies:** Task 6

### Task 8: RED — wiring_check passes unconditionally
**Story:** ST-1496-2
**Type:** negative-path

**Steps:**
1. Write failing tests for the `wiring_check` completion predicate: it reports done with no plan, an
   undeterminable diff base, an unreadable `.pipeline/`, and a stale
   `.pipeline/wiring-evidence.json` present — none of which it reads.
2. Verify they fail against the current evidence-validating predicate.
3. Implement: nothing.
4. Commit: "test(steps): specify wiring_check as an unconditional pass"

**Files likely touched:**
- `src/conductor/test/engine/wiring-check-noop.test.ts` — new failing specs

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 9: GREEN — the predicate becomes a no-op and emits the notice
**Story:** ST-1496-2
**Type:** happy-path

**Steps:**
1. Add a happy-path test that running the step emits exactly one deprecation event per execution and
   never stalls or kicks back the pipeline.
2. Verify it fails.
3. Replace the `wiring_check` predicate body with an unconditional pass that emits the deprecation
   notice, and delete `WIRING_EVIDENCE`, `validateWiringEvidence`, the
   `deriveAndPersistWiringEvidence` helper, and the `.pipeline/wiring-evidence.json` artifact glob.
4. Verify Task 8 and Task 9 tests pass.
5. Commit: "feat(steps): run wiring_check as a deprecated no-op"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — predicate, evidence constants, artifact glob
- `src/conductor/src/engine/steps.ts` — deprecation annotation on the step definition
- `src/conductor/test/engine/wiring-check-noop.test.ts` — happy-path specs

**Wired-into:** src/conductor/src/engine/steps.ts#getStepDefinition
**Dependencies:** Task 7, Task 8

### Task 10: Remove the wiring_check kickback route
**Story:** ST-1496-2
**Type:** happy-path

**Steps:**
1. Write a failing test asserting no code path can emit a `wiring_check → build` kickback.
2. Verify it fails.
3. Delete the `wiring_check` kickback routing, its escalation branches, and its gate-invalidation
   and skill-invocation entries that assume the step does work.
4. Verify the test passes and the suite is green.
5. Commit: "refactor(conductor): drop the wiring_check kickback route"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — kickback routing and escalation branches
- `src/conductor/src/engine/gate-invalidation.ts`, `src/conductor/src/engine/skill-invocation.ts`,
  `src/conductor/src/engine/step-runners.ts` — entries assuming the step does work

**Wired-into:** none (no new production surface)
**Dependencies:** Task 9

### Task 11: Remove the DECIDE-time wiring anchor gate
**Story:** ST-1496-3
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test landing a plan that carries legacy `**Wired-into:**` text,
   including a malformed line, and asserting the land succeeds.
2. Add a negative-path test asserting `landSpec`'s other gates (protected targets, ADR approval,
   coherence) still reject their own violations.
3. Verify they fail.
4. Delete the 4b-ii anchor gate block and its `validateWiredIntoPlan` import from `land-spec.ts`.
5. Verify both tests pass.
6. Commit: "feat(engineer): stop rejecting plans on wiring-contract notation"

**Files likely touched:**
- `src/conductor/src/engine/engineer/land-spec.ts` — 4b-ii gate and import
- `src/conductor/test/engine/engineer/land-spec.test.ts` — updated specs

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec
**Dependencies:** Task 5, Task 10

### Task 12: Remove the validate-wired-into subcommand
**Story:** ST-1496-3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting `conduct-ts validate-wired-into` reports an unknown subcommand and
   is absent from help output.
2. Verify it fails.
3. Delete the subcommand from the CLI command table and its re-exports from `src/index.ts`.
4. Verify the test passes.
5. Commit: "feat(cli): remove the validate-wired-into subcommand"

**Files likely touched:**
- `src/conductor/src/cli.ts` — command table
- `src/conductor/src/index.ts` — re-exports
- `src/conductor/test/engine/validate-wired-into-cli.test.ts` — deleted

**Wired-into:** none (no new production surface)
**Dependencies:** Task 11

### Task 13: Delete the wiring modules and their tests
**Story:** ST-1496-4
**Type:** happy-path

**Steps:**
1. Delete `wiring-probe.ts`, `wired-into.ts`, and `validate-wired-into.ts`.
2. Delete `wiring-probe.test.ts`, `wiring-layer2.test.ts`, `wiring-waiver.test.ts`,
   `wired-into.test.ts`, `engine/validate-wired-into-cli.test.ts`, and
   `acceptance/wiring-evidence-end-to-end.acceptance.test.ts`.
3. Remove `WIRED_INTO_LINE` from `plan-task-parse.ts`, leaving `parsePlanTaskPaths` and
   `TASK_ID_PATTERN` untouched, and delete the now-unnecessary lazy-initialization comment block
   documenting the ESM cycle.
4. Verify type-check, lint, and the full suite are green.
5. Commit: "refactor(engine): delete the wiring probe and contract modules"

**Files likely touched:**
- `src/conductor/src/engine/wiring-probe.ts`, `wired-into.ts`, `validate-wired-into.ts` — deleted
- `src/conductor/src/engine/plan-task-parse.ts` — `WIRED_INTO_LINE` removed
- six test files — deleted

**Wired-into:** none (no new production surface)
**Dependencies:** Task 12

### Task 14: Remove the remaining wiring residue
**Story:** ST-1496-4
**Type:** happy-path

**Steps:**
1. Write a failing guard test asserting no production file references `Wired-into`, `wiredInto`,
   `orphanBackstop`, `checkExportReachability`, or `evaluatePlanWiringDisposition`.
2. Verify it fails.
3. Delete the `BuildReviewGateInstruction` type, its reader, and its inputs field rather than
   leaving them returning an always-empty list; remove the remaining `wiring_check`-does-work
   entries in `model-table-metadata.ts`, `provider-model-policy.ts`, `resolved-config.ts`,
   `rebase.ts`, and `daemon-rekick.ts`.
4. Confirm `WiringConfig` and the `wiring:` config block are RETAINED — they feed the grader prompt.
5. Verify the guard test and the full suite pass.
6. Commit: "refactor(engine): remove vestigial wiring inputs and step entries"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — gate-instruction feed removed
- `src/conductor/src/engine/model-table-metadata.ts`, `provider-model-policy.ts`,
  `resolved-config.ts`, `rebase.ts`, `daemon-rekick.ts` — step entries
- `src/conductor/test/engine/wiring-residue-guard.test.ts` — new

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

### Task 15: Fence the Files convention against regression
**Story:** ST-1496-6
**Type:** negative-path

**Steps:**
1. Run the existing `parsePlanTaskPaths`, protected-target, and autoheal path-fallback tests
   unmodified and confirm they pass.
2. Add a guard test asserting `hasFilesLineByTaskId`, `foreignProtectedReferencesByTaskId`, and the
   `**Files:**` grammar are unchanged, and that `scanPlanProtectedTargets` reports identical
   violations for a fixed input before and after this feature.
3. Verify the guard passes.
4. Commit: "test(plan): fence the Files convention against wiring-removal regression"

**Files likely touched:**
- `src/conductor/test/engine/plan-task-parse-fence.test.ts` — new

**Wired-into:** none (no new production surface)
**Dependencies:** Task 14

### Task 16: Update the skills that teach the convention
**Story:** ST-1496-7
**Type:** happy-path

**Steps:**
1. Remove the `**Wired-into:**` task-template line, the §5c grammar section, the self-authoring
   guidance, and the verification-checklist item from `skills/plan/SKILL.md`, leaving no duplicate
   or dangling section numbers.
2. Update `skills/architecture-review/SKILL.md`'s references to the plan-level contract and add an
   ADR citation to §12 explaining the sweep's relationship to the BUILD-time judgement; the sweep's
   own behavior is unchanged.
3. Run `test/test_harness_integrity.sh` and fix any cross-skill or section-numbering failure.
4. Commit: "docs(skills): drop the Wired-into convention from plan authoring"

**Files likely touched:**
- `skills/plan/SKILL.md`, `skills/architecture-review/SKILL.md`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 15

### Task 17: Update the reference documentation
**Story:** ST-1496-7
**Type:** happy-path

**Steps:**
1. Update `docs/explanation/gates.md`, `docs/reference/steps.md`, `docs/reference/cli.md`,
   `docs/reference/skills.md`, and `docs/contributing/validation.md` so none describes the wiring
   probe, the `**Wired-into:**` convention, or `conduct-ts validate-wired-into` as live.
2. Document `wiring_check` as deprecated and no-op in `docs/reference/steps.md`, including the
   two-phase step-retirement contract from the retirement ADR.
3. Update `HARNESS.md` to describe wiring reachability as a `build_review` rubric item, and
   regenerate the model table if the step's row changed.
4. Run `test/test_harness_integrity.sh` and confirm it passes.
5. Commit: "docs: describe wiring reachability as a build_review rubric item"

**Files likely touched:**
- `docs/explanation/gates.md`, `docs/reference/steps.md`, `docs/reference/cli.md`,
  `docs/reference/skills.md`, `docs/contributing/validation.md`, `HARNESS.md`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 16
