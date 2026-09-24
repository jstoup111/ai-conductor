# Implementation Plan: post-plan DECIDE amendments reconcile with the plan before any further build lap (#1700)

**Date:** 2026-09-23
**Stories:** .docs/stories/post-plan-decide-amendments-never-reconcile-with-t.md
**Conflict check:** Clean as of 2026-09-23 (0 blocking remaining; resolutions in `.docs/conflicts/post-plan-decide-amendments-never-reconcile-with-t.md`)

## Summary

Thirteen tasks extend `coverage_binding` so an operator reseal of a changed DECIDE artifact re-arms the step, a mechanical ADR-obligation layer refuses a plan missing a current decision, amendment blocks are judged against the plan, and completed work a DECIDE change contradicts is reopened — never re-planned.

## Technical Approach

- **Void, not predicate (D16).** `coverage_binding` stays non-tree-attesting. `dispatchResealCommand` already computes per-path prior/new fingerprints for the audit event; after a successful reseal it calls a new `voidCoverageBindingForDecideChange`, which filters to changed DECIDE-set paths, rewrites the envelope as `invalidated` (entries kept, so digests survive as the reopen baseline), writes the gate verdict unsatisfied with a new `decide-change` origin, and resets the step status through the same conduct-state write the operator rewind uses. Self-amendments without a reseal stay the non-fatal advisory of adr-2026-07-27.
- **DECIDE set (Task 3).** One resolver serves the void and the step: plan, `**Stories:**` path, stem-matched architecture review, PRD when present, ADRs cited in the plan obligation table plus ADRs the branch adds or modifies since merge-base (the land gate's change-set helper).
- **ADR-obligation layer (D17).** Runs in `runCoverageBinding` before the judge-disabled early return (today at the top of the runner), reusing `parseAdrDecisions`, `formatArchitectureDecisionId`, and `validateArchitectureObligationCoverage` — the land validator, no second parser. Violations refuse through the existing `does-not-assert` refusal path. Tier S, a plan with no obligation section, and an uncitable ADR are `not-applicable`.
- **Amendment claims (D18).** A separate claim kind with its own digest, batch partition, and payload parser (`carried` / `not-carried` / `no-plan-obligation`, optional `contradictsCompleted`), so the criterion-claim prompt, verdicts, and `coverage_binding_judged` event are untouched. Judge disabled → `unjudged`, non-blocking.
- **Reopen (D19, 09-06 decision 10).** Only when the previous envelope is `invalidated`. Admission and restage are extracted from `planRemediation`'s existing-task branch into `repair-restage.ts` and called with source authority `coverage_binding`, charged to `gates.coverage_binding` under the default per-gate lap cap. Digests are recorded on every run, so a disabled or legacy envelope is a baseline that reopens nothing.
- **Events (D20).** `coverage_binding_invalidated`, `coverage_binding_amendment_judged`, `coverage_binding_task_reopened` join the `ConductorEvent` union and the exhaustive sink registry; refusals ride `step_refused` / `loop_halt`.
- **Sequencing.** Envelope and verdict-origin infrastructure (1–2) and the resolver (3) first; the void (4) and its wiring and loop proof (5–6); the ADR layer (7–8); amendment claims (9–11); the reopen (12–13).

## Prerequisites

- Amended `adr-2026-08-31-coverage-binding-judge-step` (D16–D20) and `adr-2026-09-06-reopened-task-resolution` (decision 10) are APPROVED in this spec.
- Companion PR #2691 narrows #2088 Story 4 to judged criterion claims.

## Tasks

### Task 1: Add the `invalidated` envelope status, claim kinds, and amendment verdicts
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`: an envelope with status `invalidated` round-trips; `COVERAGE_BINDING_COMPLETION_STATUSES` still deep-equals `['disabled', 'done']`; an entry with `kind: "amendment"` and each of `carried`, `not-carried`, `no-plan-obligation`, `unjudged` round-trips; an entry from a pre-change envelope with no `kind` parses as `criterion`. Add a test in `src/conductor/test/engine/artifacts.test.ts` that the coverage_binding completion derivation reports not done for an on-disk `invalidated` envelope.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/coverage-binding-envelope.ts`: add `invalidated` to `COVERAGE_BINDING_ENVELOPE_STATUSES` (non-terminal and non-completing, like `partial`); add an optional entry `kind` defaulting to `criterion`, amendment entry fields (artifact path, amendment text), and the amendment verdict values. Pattern: the `partial` status addition and `parseCoverageBindingEnvelope` `includes` check in the same file; allowed variation: the entry parser may accept the new optional keys but must keep rejecting unknown keys.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): invalidated status and amendment claim entries"

**Done when:**
- `COVERAGE_BINDING_ENVELOPE_STATUSES` in `src/conductor/src/engine/coverage-binding-envelope.ts` contains `invalidated` and `COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']`, as asserted by the invalidated round-trip test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- the coverage_binding completion derivation in `src/conductor/src/engine/artifacts.ts` reports `coverage_binding` not done for an on-disk envelope whose status is `invalidated`, as asserted by the invalidated-incomplete test in `src/conductor/test/engine/artifacts.test.ts`
- `parseCoverageBindingEnvelope` round-trips amendment entries carrying each of `carried`, `not-carried`, `no-plan-obligation`, and `unjudged`, and reads an entry with no `kind` as `criterion`, as asserted by the amendment-entry and legacy-entry tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — status, entry kind, amendment verdicts
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — round-trip tests
- `src/conductor/test/engine/artifacts.test.ts` — invalidated is not completion evidence

**Dependencies:** none

### Task 2: Add the `decide-change` gate-verdict origin outside the rebase reopen branch
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/gate-verdicts.test.ts`, a `coverage_binding` verdict written with `satisfied: false` and `kickback.from: "decide-change"` reads back with that origin; in `src/conductor/test/engine/conductor.test.ts`, the rebase-only reopen branch restages nothing for a `decide-change` verdict.
2. Verify tests fail (RED).
3. Implement: widen the `kickback.from` type in `src/conductor/src/engine/gate-verdicts.ts` to accept `decide-change`; confirm the rebase-only reopen branch in `src/conductor/src/engine/conductor.ts` (the `kickback.from === 'rebase'` check) keeps matching only `rebase`.
4. Verify tests pass (GREEN).
5. Commit: "feat(gate-verdicts): decide-change kickback origin"

**Done when:**
- `writeGateVerdict` persists a `coverage_binding` verdict with `satisfied: false` and `kickback.from` equal to `decide-change`, and the verdict reader returns that origin, as asserted by the decide-change origin test in `src/conductor/test/engine/gate-verdicts.test.ts`
- the rebase-only reopen branch in `src/conductor/src/engine/conductor.ts` restages no gate for a verdict whose `kickback.from` is `decide-change`, as asserted by the decide-change-not-rebase test in `src/conductor/test/engine/conductor.test.ts`

**Files:**
- `src/conductor/src/engine/gate-verdicts.ts` — origin type
- `src/conductor/src/engine/conductor.ts` — rebase branch stays rebase-only
- `src/conductor/test/engine/gate-verdicts.test.ts` — origin round-trip
- `src/conductor/test/engine/conductor.test.ts` — branch not taken

**Dependencies:** none

### Task 3: Resolve the feature's DECIDE set
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-decide-set.test.ts` over a fixture repo: the resolver returns the plan, its `**Stories:**` path, the stem-matched `.docs/decisions/architecture-review-*-<stem>.md`, `.docs/specs/<stem>.md` when present, every ADR cited in the plan's `## Architecture Obligation Coverage` table, and every ADR the branch adds or modifies since its merge-base; an ADR changed only on the base is excluded; a missing PRD or architecture review is omitted without error.
2. Verify tests fail (RED).
3. Implement `resolveCoverageBindingDecideSet` in new `src/conductor/src/engine/coverage-binding-decide-set.ts`, reusing the plan `**Stories:**` resolver and the obligation-table row parser in `src/conductor/src/engine/architecture-obligation-coverage.ts` (export its row parser if needed) and the existing merge-base diff helper the land gate uses. Rediscover the diff helper by searching `coherence-validator.ts` for its change-set collection; allowed variation: a thin wrapper, never a second git diff parser.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): resolve the feature DECIDE set"

**Done when:**
- `resolveCoverageBindingDecideSet` in `src/conductor/src/engine/coverage-binding-decide-set.ts` returns the plan, its `**Stories:**` path, the stem-matched architecture review, the PRD when present, and every ADR cited in the plan's obligation table, as asserted by the decide-set fixture test in `src/conductor/test/engine/coverage-binding-decide-set.test.ts`
- ADR files the branch adds or modifies since its merge-base are included, an ADR changed only on the base is excluded, and a missing PRD or architecture review is omitted without error, as asserted by the git-fixture decide-set tests in `src/conductor/test/engine/coverage-binding-decide-set.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-decide-set.ts` — new resolver
- `src/conductor/src/engine/architecture-obligation-coverage.ts` — export row parser
- `src/conductor/test/engine/coverage-binding-decide-set.test.ts` — fixture tests

**Dependencies:** none

### Task 4: Void coverage_binding on a changed DECIDE-set rebaseline
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-void.test.ts`: given a `done` envelope, a satisfied gate verdict, and one DECIDE-set rebaseline whose fingerprints differ, the void rewrites the envelope with status `invalidated` and unchanged entries, writes the gate verdict unsatisfied with origin `decide-change`, sets the persisted step status to not done, and emits one `coverage_binding_invalidated` event; given only byte-identical rebaselines, or only out-of-set paths, nothing changes and no event is emitted.
2. Verify tests fail (RED).
3. Implement `voidCoverageBindingForDecideChange` in new `src/conductor/src/engine/coverage-binding-void.ts`. Write the step status through the same conduct-state store update the operator rewind uses (search `rewind.ts` for its status reset; preserve its lease-guarded write; no new state file). Add `coverage_binding_invalidated` (paths, origin) to the `ConductorEvent` union in `src/conductor/src/types/events.ts` and declare it in `src/conductor/src/engine/event-sinks.ts` with persist enabled.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): void completion on a DECIDE change"

**Done when:**
- `voidCoverageBindingForDecideChange` in `src/conductor/src/engine/coverage-binding-void.ts`, given one DECIDE-set path whose new fingerprint differs from its prior fingerprint, rewrites `.pipeline/coverage-binding.json` with status `invalidated` and its entries unchanged, persists the gate verdict unsatisfied with origin `decide-change`, and sets the persisted `coverage_binding` status to not done, as asserted by the void test in `src/conductor/test/engine/coverage-binding-void.test.ts`
- the same call emits one `coverage_binding_invalidated` event whose `paths` names the changed ADR path and whose `origin` is `decide-change`, and `coverage_binding_invalidated` is declared in `src/conductor/src/engine/event-sinks.ts` with persist enabled, as asserted by the void-event test and the sink-registry exhaustiveness test
- given only byte-identical rebaselines, or only paths outside the DECIDE set, the call leaves the envelope, gate verdict, and step status byte-identical and emits no `coverage_binding_invalidated` event, as asserted by the two no-op void tests in `src/conductor/test/engine/coverage-binding-void.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-void.ts` — new void function
- `src/conductor/src/types/events.ts` — new event member
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/test/engine/coverage-binding-void.test.ts` — void tests

**Dependencies:** Task 1, Task 2, Task 3

### Task 5: Wire the void into the operator reseal command
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/reseal-cli.test.ts`: a successful reseal of a changed feature ADR on a feature with `coverage_binding` done leaves the step status and gate verdict unsatisfied, the envelope `invalidated`, and a persisted `coverage_binding_invalidated` event naming the ADR path; a refused reseal changes nothing and emits no such event. In `src/conductor/test/engine/conductor.test.ts`, a per-attempt seal check reporting a self-amendment on the feature's own plan, with no reseal, leaves `coverage_binding` done and the attempt dispatches.
2. Verify tests fail (RED).
3. Implement: in `dispatchResealCommand` in `src/conductor/src/engine/reseal-cli.ts`, after `resealProtectedArtifactSeal` succeeds, call `voidCoverageBindingForDecideChange` with the per-path prior and new fingerprints already computed for the `protected_artifact_reseal` event and the resolved DECIDE set. Do not call it on refusal. Leave the per-attempt seal check in `src/conductor/src/engine/conductor.ts` unchanged.
4. Verify tests pass (GREEN).
5. Commit: "feat(reseal): re-arm coverage_binding after a DECIDE reseal"

**Done when:**
- `dispatchResealCommand` in `src/conductor/src/engine/reseal-cli.ts`, after a successful reseal of a changed feature ADR on a feature whose `coverage_binding` is done, leaves the step status and gate verdict unsatisfied, the envelope status `invalidated`, and a `coverage_binding_invalidated` event naming the ADR path persisted to `.pipeline/events.jsonl`, as asserted by the reseal-void integration test in `src/conductor/test/engine/reseal-cli.test.ts`
- a refused reseal leaves `coverage_binding`'s status, gate verdict, and envelope byte-identical and emits no `coverage_binding_invalidated` event, as asserted by the refused-reseal test in `src/conductor/test/engine/reseal-cli.test.ts`
- a per-attempt seal check that reports a self-amendment on the feature's own plan with no reseal leaves `coverage_binding` done and the step attempt proceeds to dispatch, as asserted by the self-amendment-no-void test in `src/conductor/test/engine/conductor.test.ts`

**Files:**
- `src/conductor/src/engine/reseal-cli.ts` — call the void after a successful reseal
- `src/conductor/test/engine/reseal-cli.test.ts` — integration tests
- `src/conductor/test/engine/conductor.test.ts` — self-amendment does not void

**Dependencies:** Task 4

### Task 6: Prove a void re-runs coverage_binding before any build task
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing loop tests in `src/conductor/test/engine/conductor.test.ts`: after `voidCoverageBindingForDecideChange` on a feature with one completed build task, (a) an operator rewind to `build` followed by one loop run and (b) a daemon resume each dispatch `coverage_binding` before any build task.
2. Verify tests fail (RED) or, if they pass on the current resume clamp and rewind, record that in the commit body and keep them as regression proof.
3. Implement only if RED: make the resume clamp in `src/conductor/src/engine/conductor.ts` and the rewind entry in `src/conductor/src/engine/rewind.ts` treat an unsatisfied `coverage_binding` status and verdict as the earliest entry at or after `build`. Allowed variation: none beyond those two seams.
4. Verify tests pass (GREEN).
5. Commit: "test(conductor): void re-runs coverage_binding before build"

**Done when:**
- after `voidCoverageBindingForDecideChange` on a feature whose build has one completed task, an operator rewind to `build` followed by one loop run dispatches `coverage_binding` before any build task, as asserted by the rewind-after-void test in `src/conductor/test/engine/conductor.test.ts`
- after the same void, a daemon resume or re-dispatch of the feature dispatches `coverage_binding` before any build task, as asserted by the resume-after-void test in `src/conductor/test/engine/conductor.test.ts`

**Files:**
- `src/conductor/test/engine/conductor.test.ts` — loop tests
- `src/conductor/src/engine/conductor.ts` — resume clamp, only if RED
- `src/conductor/src/engine/rewind.ts` — rewind entry, only if RED

**Dependencies:** Task 4

### Task 7: Run the ADR-obligation layer in coverage_binding before the judge gate
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts`: with D1–D3 each carried by one valid obligation row, the step records no ADR-layer violation and proceeds; with an ADR amended to add D4 and no D4 row, the step returns refused `needs-human` with the ADR path, `D4`, and "no coverage row" in both the halt detail and the `step_refused` event; with `coverage_binding.judge.enabled: false` the same refusal occurs with zero provider dispatches.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts`: before the judge-disabled early return, resolve the DECIDE set (Task 3), read its ADRs, build the decision-id set with `parseAdrDecisions` and `formatArchitectureDecisionId`, and call `validateArchitectureObligationCoverage`. On any violation refuse exactly as the existing `does-not-assert` refusal does (refused status, `needs-human`, `writeHaltMarker`), rendering per violation the ADR path, decision id, and violation detail. No second ADR parser.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): ADR-obligation layer before the judge"

**Done when:**
- `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` runs `validateArchitectureObligationCoverage` against the `parseAdrDecisions` decision ids of the DECIDE set's ADRs before its judge-disabled return, and with D1–D3 each carried by one valid row it records no ADR-layer violation and proceeds to judged claims, as asserted by the obligation-pass test in `src/conductor/test/engine/step-runners.test.ts`
- with an ADR amended to add D4 and no D4 plan row, the step returns refused with kind `needs-human`, writes the halt through `writeHaltMarker`, and the halt detail and `step_refused` event both name the ADR path, `D4`, and that the plan has no coverage row, as asserted by the missing-decision test in `src/conductor/test/engine/step-runners.test.ts`
- with `coverage_binding.judge.enabled: false` and the same missing row, the step returns the same `needs-human` refusal naming `D4` and performs zero provider dispatches, as asserted by the judge-disabled refusal test in `src/conductor/test/engine/step-runners.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — ADR-obligation layer
- `src/conductor/test/engine/step-runners.test.ts` — layer tests

**Dependencies:** Task 3

### Task 8: ADR-obligation layer tolerance and rejection paths
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts` for: a plan with no obligation section; a tier S feature; a cited ADR with no citable decision; an evidence-ungrounded D2 row; a row citing an undeclared decision id; an unreadable DECIDE-set ADR.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts`: record the layer `not-applicable` in the envelope for no section, tier S (read no ADR), and an uncitable ADR; render `evidence-ungrounded` and `invented` violations with the ADR path and decision id; return failure naming the unreadable path, writing no `done` envelope.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): ADR-layer legacy tolerance and rejections"

**Done when:**
- a plan with no `## Architecture Obligation Coverage` section records the ADR layer `not-applicable` in the envelope and the step completes without refusal, as asserted by the no-section test in `src/conductor/test/engine/step-runners.test.ts`
- a tier S feature records the ADR layer `not-applicable` without reading any ADR, as asserted by the tier-S test in `src/conductor/test/engine/step-runners.test.ts`
- a cited ADR whose `parseAdrDecisions` result has no citable decision is recorded `not-applicable` and does not refuse the step, as asserted by the uncitable-ADR test in `src/conductor/test/engine/step-runners.test.ts`
- an obligation row whose evidence is absent from the cited task's `Done when` block refuses naming the ADR path, `D2`, and that the evidence is absent from the cited task's `Done when`, and a row citing an undeclared decision id refuses naming the ADR path and the invented id, as asserted by the evidence-ungrounded and invented-decision tests in `src/conductor/test/engine/step-runners.test.ts`
- an unreadable DECIDE-set ADR makes the step return a retryable infrastructure failure naming the unreadable path without writing a `done` envelope or a refusal, as asserted by the unreadable-ADR test in `src/conductor/test/engine/step-runners.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — tolerance and rejection paths
- `src/conductor/test/engine/step-runners.test.ts` — negative tests

**Dependencies:** Task 7

### Task 9: Assemble amendment claims from the DECIDE set
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-inputs.test.ts`: one claim per `> **Amended YYYY-MM-DD by #N:**` blockquote in the architecture review, PRD, and ADRs, carrying the artifact path, the full blockquote text, and every plan task id with its `Done when` checks; a blockquote in the plan yields no claim. In `src/conductor/test/engine/coverage-binding-envelope.test.ts`, the amendment digest changes with the text or any plan `Done when` check and is otherwise stable.
2. Verify tests fail (RED).
3. Implement `assembleAmendmentClaims` in `src/conductor/src/engine/coverage-binding-inputs.ts` and an amendment digest beside `claimDigest` in `src/conductor/src/engine/coverage-binding-envelope.ts`, reusing `parsePlanTaskDoneWhen`.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): assemble amendment claims"

**Done when:**
- `assembleAmendmentClaims` in `src/conductor/src/engine/coverage-binding-inputs.ts` returns one claim per `> **Amended YYYY-MM-DD by #N:**` blockquote in the architecture review, PRD, and ADRs, each carrying the artifact path, the full blockquote text, and every plan task id with its `Done when` checks, as asserted by the amendment-extraction test in `src/conductor/test/engine/coverage-binding-inputs.test.ts`
- an amendment blockquote in the plan itself yields no claim, as asserted by the plan-amendment-excluded test in `src/conductor/test/engine/coverage-binding-inputs.test.ts`
- an amendment claim's digest changes when its text or any plan `Done when` check changes and is stable otherwise, as asserted by the amendment-digest test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-inputs.ts` — amendment claim assembly
- `src/conductor/src/engine/coverage-binding-envelope.ts` — amendment digest
- `src/conductor/test/engine/coverage-binding-inputs.test.ts` — extraction tests
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — digest test

**Dependencies:** Task 3

### Task 10: Batch amendment claims apart and validate their payload
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/coverage-binding-batches.test.ts`, a mix of criterion and amendment claims never shares a batch; in `src/conductor/test/engine/coverage-binding-envelope.test.ts`, the amendment payload parser rejects the whole batch for a `carried` foreign task id, an empty `missingObligation`, or a `contradictsCompleted` id outside the issued completed ids; in `src/conductor/test/engine/step-runners.test.ts`, a rejected amendment batch is a `CoverageBindingPayloadError` recording no verdict and reopening nothing.
2. Verify tests fail (RED).
3. Implement: partition by claim kind in the planner in `src/conductor/src/engine/coverage-binding-batches.ts`; add `parseAmendmentBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` under the same exact-digest-set rule as `parseJudgeBatchPayload`, validating verdict vocabulary, `carried` task ids against those issued, non-empty `missingObligation`, and `contradictsCompleted` against the issued completed ids.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): amendment batch schema"

**Done when:**
- the batch planner in `src/conductor/src/engine/coverage-binding-batches.ts` never places a criterion claim and an amendment claim in the same batch, as asserted by the mixed-kind planning test in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- `parseAmendmentBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` rejects the whole batch when a `carried` verdict cites a task id not issued in the batch or a `not-carried` verdict has an empty `missingObligation`, as asserted by the foreign-task and empty-missing-obligation tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `parseAmendmentBatchPayload` rejects the whole batch when `contradictsCompleted` names a task id outside the completed task ids issued in that batch, as asserted by the foreign-contradiction test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- a rejected amendment batch surfaces as `CoverageBindingPayloadError`, so the step records no verdict from it and reopens no task, as asserted by the rejected-batch test in `src/conductor/test/engine/step-runners.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-batches.ts` — kind partition
- `src/conductor/src/engine/coverage-binding-envelope.ts` — amendment payload parser
- `src/conductor/test/engine/coverage-binding-batches.test.ts` — planning test
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — payload tests
- `src/conductor/test/engine/step-runners.test.ts` — rejected batch

**Dependencies:** Task 1, Task 9

### Task 11: Judge amendment claims in coverage_binding
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts` for `carried`, `no-plan-obligation`, and `not-carried` verdicts, the digest cache hit, the judge-disabled `unjudged` path, and the event vocabularies.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts`: assemble amendment claims (Task 9), dispatch uncached ones in amendment batches (Task 10) through the existing batch dispatcher, record verdicts, refuse `not-carried` exactly as `does-not-assert` refuses, and record `unjudged` with the judge disabled. Add `coverage_binding_amendment_judged` to `src/conductor/src/types/events.ts` and `src/conductor/src/engine/event-sinks.ts`. Add the amendment-claim contract to `skills/coverage-binding/SKILL.md`.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): judge amendment claims"

**Done when:**
- `runCoverageBinding` completes `done` when the judge returns `carried` citing an issued task id or `no-plan-obligation`, emitting one `coverage_binding_amendment_judged` event per amendment claim with that verdict, as asserted by the carried and no-plan-obligation tests in `src/conductor/test/engine/step-runners.test.ts`
- a `not-carried` verdict makes the step return refused with kind `needs-human`, and the halt detail names the artifact path, the amendment text, and the `missingObligation`, as asserted by the not-carried refusal test in `src/conductor/test/engine/step-runners.test.ts`
- an amendment claim whose digest already carries `carried` in the previous envelope is not dispatched on re-run, and with the judge disabled every amendment claim is recorded `unjudged` with zero provider dispatches and no refusal, as asserted by the amendment cache and judge-disabled tests in `src/conductor/test/engine/step-runners.test.ts`
- every `coverage_binding_judged` event carries only `asserts`, `does-not-assert`, or `not-applicable`, and `coverage_binding_amendment_judged` is declared in `src/conductor/src/engine/event-sinks.ts`, as asserted by the event-vocabulary test in `src/conductor/test/engine/step-runners.test.ts` and the sink-registry exhaustiveness test
- `skills/coverage-binding/SKILL.md` has an amendment-claim section naming the verdicts `carried`, `not-carried`, and `no-plan-obligation` and the optional `contradictsCompleted` field

**Files:**
- `src/conductor/src/engine/step-runners.ts` — amendment judging
- `src/conductor/src/types/events.ts` — new event member
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `skills/coverage-binding/SKILL.md` — amendment-claim contract
- `src/conductor/test/engine/step-runners.test.ts` — judging tests

**Dependencies:** Task 7, Task 10

### Task 12: Extract repair admission and restage for a coverage_binding source
**Story:** 4
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/repair-restage.test.ts`: admission with source authority `coverage_binding` records that authority, restages the bound rows, and charges one lap to `gates.coverage_binding`; a second identical admission replays, restages once, and charges nothing.
2. Verify tests fail (RED).
3. Implement `admitAndRestageRepair` in new `src/conductor/src/engine/repair-restage.ts` by moving the admission (`createRepairObligationStore(...).admitOrReplay`) and `restageExistingRemediationTaskStatuses` logic out of `Conductor.planRemediation`'s existing-task branch in `src/conductor/src/engine/conductor.ts`, which then calls it unchanged. Preserve idempotent admission keyed on plan path, source, bindings, and HEAD, and restage of only bound rows. Charge the lap under `gates.coverage_binding` in `src/conductor/src/engine/kickback-ledger.ts` using the default per-gate lap cap; add no config key.
4. Verify tests pass (GREEN).
5. Commit: "refactor(remediation): shared repair admission and restage"

**Done when:**
- `Conductor.planRemediation`'s existing-task branch in `src/conductor/src/engine/conductor.ts` calls `admitAndRestageRepair` in `src/conductor/src/engine/repair-restage.ts` and the existing existing-task remediation tests in `src/conductor/test/engine/conductor.test.ts` pass unmodified
- `admitAndRestageRepair` with source authority `coverage_binding` admits an obligation whose source authority is `coverage_binding`, restages the bound task rows, and charges one lap to `gates.coverage_binding` in the kickback ledger, as asserted by the coverage-binding admission test in `src/conductor/test/engine/repair-restage.test.ts`
- a second admission for the same plan, claim digest, bindings, and HEAD replays the existing obligation, leaves exactly one restage, and charges no second lap, as asserted by the replay test in `src/conductor/test/engine/repair-restage.test.ts`

**Files:**
- `src/conductor/src/engine/repair-restage.ts` — new shared module
- `src/conductor/src/engine/conductor.ts` — call the shared module
- `src/conductor/src/engine/kickback-ledger.ts` — coverage_binding ledger key
- `src/conductor/test/engine/repair-restage.test.ts` — admission tests

**Dependencies:** none

### Task 13: Reopen contradicted completed tasks after a void
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts` for the judged and criterion-digest reopens after an `invalidated` envelope, the byte-identical plan and no-replan assertions, the rebase-refresh and digest-less baselines, and digest recording with the judge disabled.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts`: record every criterion and amendment digest on every run, including the judge-disabled path; only when the previous envelope status is `invalidated`, reopen completed tasks cited by criterion claims whose digests are absent from a previous envelope that carries recorded digests, plus completed tasks named in accepted `contradictsCompleted`, through `admitAndRestageRepair` with source authority `coverage_binding`. Add `coverage_binding_task_reopened` to `src/conductor/src/types/events.ts` and `src/conductor/src/engine/event-sinks.ts`. Never append a plan task or record a `plan` routing.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): reopen contradicted work after a void"

**Done when:**
- when the previous envelope status is `invalidated` and the judge lists completed task 3 in an amendment claim's `contradictsCompleted`, `runCoverageBinding` reopens task 3 through `admitAndRestageRepair` with source authority `coverage_binding` and emits one `coverage_binding_task_reopened` event naming task 3 and the claim digest, as asserted by the judged-reopen test in `src/conductor/test/engine/step-runners.test.ts`
- when the previous envelope status is `invalidated` and a criterion claim citing completed task 2 has a digest absent from the previous envelope's recorded digests, task 2 is restaged open with zero provider dispatches, while a completed task cited only by unchanged digests stays completed, as asserted by the criterion-digest reopen test in `src/conductor/test/engine/step-runners.test.ts`
- after reopening, the plan file is byte-identical to before the step, no `plan` routing or kickback is recorded, the reopen lap is charged to `gates.coverage_binding`, and `coverage_binding_task_reopened` is declared in `src/conductor/src/engine/event-sinks.ts`, as asserted by the no-replan test in `src/conductor/test/engine/step-runners.test.ts` and the sink-registry exhaustiveness test
- when the previous envelope status is not `invalidated`, including a rebase-refresh run, no task is reopened, and when the previous envelope carries no recorded digests no criterion-digest reopen occurs, as asserted by the rebase-refresh and digest-less baseline tests in `src/conductor/test/engine/step-runners.test.ts`
- every run, including with the judge disabled, writes an envelope recording the digest of every current criterion and amendment claim, as asserted by the digest-baseline test in `src/conductor/test/engine/step-runners.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — reopen after a void; digest recording
- `src/conductor/src/types/events.ts` — new event member
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/test/engine/step-runners.test.ts` — reopen tests

**Dependencies:** Task 11, Task 12

## Task Dependency Graph

```text
1 ─┐        ┌─ 5
2 ─┼─> 4 ───┤
3 ─┘        └─ 6
3 ──> 7 ──> 8
3 ──> 9 ──> 10 (also needs 1) ──> 11 (also needs 7) ──> 13
12 ─────────────────────────────────────────────────────> 13
```

## Integration Points

- After Task 5: an operator reseal of a changed DECIDE artifact re-arms `coverage_binding` end to end through `dispatchResealCommand`.
- After Task 6: the loop proves a void re-runs `coverage_binding` before any build task (architecture review condition C1).
- After Task 13: a reseal → re-run → reopen round trip works through `runCoverageBinding`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose `coverage_binding` status is `done` and one completed build task, when the operator reseals the feature's ADR after changing its content, then `coverage_binding`'s persisted status and gate verdict are unsatisfied, `.pipeline/coverage-binding.json` has status `invalidated`, and a `coverage_binding_invalidated` event naming the ADR path is persisted to `.pipeline/events.jsonl` | 5 | "`dispatchResealCommand` in `src/conductor/src/engine/reseal-cli.ts`, after a successful reseal of a changed feature ADR on a feature whose `coverage_binding` is done, leaves the step status and gate verdict unsatisfied, the envelope status `invalidated`, and a `coverage_binding_invalidated` event naming the ADR path persisted to `.pipeline/events.jsonl`, as asserted by the reseal-void integration test in `src/conductor/test/engine/reseal-cli.test.ts`" | diff-local |
| Story 1 happy: Given a void has been recorded, when the operator rewinds the feature to `build`, then `coverage_binding` runs before any build task is dispatched | 6 | "after `voidCoverageBindingForDecideChange` on a feature whose build has one completed task, an operator rewind to `build` followed by one loop run dispatches `coverage_binding` before any build task, as asserted by the rewind-after-void test in `src/conductor/test/engine/conductor.test.ts`" | diff-local |
| Story 1 happy: Given a void has been recorded, when the daemon re-dispatches or resumes the feature, then `coverage_binding` runs before any build task is dispatched | 6 | "after the same void, a daemon resume or re-dispatch of the feature dispatches `coverage_binding` before any build task, as asserted by the resume-after-void test in `src/conductor/test/engine/conductor.test.ts`" | diff-local |
| Story 1 negative: Given a feature whose `coverage_binding` status is `done`, when the operator reseals a path whose new fingerprint equals its prior fingerprint, then `coverage_binding` stays `done` and no `coverage_binding_invalidated` event is emitted | 4 | "given only byte-identical rebaselines, or only paths outside the DECIDE set, the call leaves the envelope, gate verdict, and step status byte-identical and emits no `coverage_binding_invalidated` event, as asserted by the two no-op void tests in `src/conductor/test/engine/coverage-binding-void.test.ts`" | diff-local |
| Story 1 negative: Given a feature whose `coverage_binding` status is `done`, when the operator reseals only a protected path outside the feature's DECIDE set, then `coverage_binding` stays `done` and no `coverage_binding_invalidated` event is emitted | 4 | "given only byte-identical rebaselines, or only paths outside the DECIDE set, the call leaves the envelope, gate verdict, and step status byte-identical and emits no `coverage_binding_invalidated` event, as asserted by the two no-op void tests in `src/conductor/test/engine/coverage-binding-void.test.ts`" | diff-local |
| Story 1 negative: Given a void has been recorded, when the gate verdict for `coverage_binding` is read, then its origin is `decide-change` and the rebase-only reopen branch is not taken | 2 | "`writeGateVerdict` persists a `coverage_binding` verdict with `satisfied: false` and `kickback.from` equal to `decide-change`, and the verdict reader returns that origin, as asserted by the decide-change origin test in `src/conductor/test/engine/gate-verdicts.test.ts`" | diff-local |
| Story 1 negative: Given a void has been recorded and the envelope status is `invalidated`, when step completion is re-derived from artifacts, then `coverage_binding` is not reported done | 1 | "the coverage_binding completion derivation in `src/conductor/src/engine/artifacts.ts` reports `coverage_binding` not done for an on-disk envelope whose status is `invalidated`, as asserted by the invalidated-incomplete test in `src/conductor/test/engine/artifacts.test.ts`" | diff-local |
| Story 1 negative: Given the per-attempt seal check reports a self-amendment on the feature's own plan and no reseal is run, when the step attempt proceeds, then `coverage_binding` stays `done` and dispatch is not blocked | 5 | "a per-attempt seal check that reports a self-amendment on the feature's own plan with no reseal leaves `coverage_binding` done and the step attempt proceeds to dispatch, as asserted by the self-amendment-no-void test in `src/conductor/test/engine/conductor.test.ts`" | diff-local |
| Story 1 negative: Given the reseal itself is refused, when the operator runs it, then `coverage_binding`'s status, verdict, and envelope are unchanged and no `coverage_binding_invalidated` event is emitted | 5 | "a refused reseal leaves `coverage_binding`'s status, gate verdict, and envelope byte-identical and emits no `coverage_binding_invalidated` event, as asserted by the refused-reseal test in `src/conductor/test/engine/reseal-cli.test.ts`" | diff-local |
| Story 2 happy: Given the feature's ADR carries decisions D1–D3 and the plan's `## Architecture Obligation Coverage` table has exactly one valid row for each, when `coverage_binding` runs, then the ADR layer records no violation and the step proceeds to its judged claims | 7 | "`runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` runs `validateArchitectureObligationCoverage` against the `parseAdrDecisions` decision ids of the DECIDE set's ADRs before its judge-disabled return, and with D1–D3 each carried by one valid row it records no ADR-layer violation and proceeds to judged claims, as asserted by the obligation-pass test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 happy: Given the feature's ADR is amended to add D4 and the plan has no D4 row, when `coverage_binding` runs, then the step is `refused` with kind `needs-human` and the halt names the ADR path, the decision id `D4`, and that the plan has no coverage row for it | 7 | "with an ADR amended to add D4 and no D4 plan row, the step returns refused with kind `needs-human`, writes the halt through `writeHaltMarker`, and the halt detail and `step_refused` event both name the ADR path, `D4`, and that the plan has no coverage row, as asserted by the missing-decision test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 happy: Given the judge is disabled by `coverage_binding.judge.enabled: false` and a required decision row is missing, when `coverage_binding` runs, then the step is still `refused` `needs-human` naming the missing decision with zero provider dispatches | 7 | "with `coverage_binding.judge.enabled: false` and the same missing row, the step returns the same `needs-human` refusal naming `D4` and performs zero provider dispatches, as asserted by the judge-disabled refusal test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 negative: Given a plan with no `## Architecture Obligation Coverage` section, when `coverage_binding` runs, then the ADR layer is recorded `not-applicable` and does not refuse the step | 8 | "a plan with no `## Architecture Obligation Coverage` section records the ADR layer `not-applicable` in the envelope and the step completes without refusal, as asserted by the no-section test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 negative: Given a tier S feature, when `coverage_binding` runs, then the ADR layer is recorded `not-applicable` | 8 | "a tier S feature records the ADR layer `not-applicable` without reading any ADR, as asserted by the tier-S test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 negative: Given a cited ADR has no citable decision, when `coverage_binding` runs, then that ADR is recorded `not-applicable` and does not refuse the step | 8 | "a cited ADR whose `parseAdrDecisions` result has no citable decision is recorded `not-applicable` and does not refuse the step, as asserted by the uncitable-ADR test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 negative: Given the plan's obligation row for D2 cites a task whose `Done when` block does not contain the row's evidence text, when `coverage_binding` runs, then the step is refused naming the ADR path, `D2`, and that the evidence is absent from the cited task's `Done when` | 8 | "an obligation row whose evidence is absent from the cited task's `Done when` block refuses naming the ADR path, `D2`, and that the evidence is absent from the cited task's `Done when`, and a row citing an undeclared decision id refuses naming the ADR path and the invented id, as asserted by the evidence-ungrounded and invented-decision tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 negative: Given the plan's obligation table cites a decision id the ADR does not declare, when `coverage_binding` runs, then the step is refused naming the ADR path and the invented decision id | 8 | "an obligation row whose evidence is absent from the cited task's `Done when` block refuses naming the ADR path, `D2`, and that the evidence is absent from the cited task's `Done when`, and a row citing an undeclared decision id refuses naming the ADR path and the invented id, as asserted by the evidence-ungrounded and invented-decision tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 2 negative: Given an ADR in the DECIDE set cannot be read from disk, when `coverage_binding` runs, then the step fails as an infrastructure failure naming the unreadable path and does not record `done` | 8 | "an unreadable DECIDE-set ADR makes the step return a retryable infrastructure failure naming the unreadable path without writing a `done` envelope or a refusal, as asserted by the unreadable-ADR test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 3 happy: Given the architecture review carries one amendment block and the judge returns `carried` citing an issued task id, when `coverage_binding` runs, then the step completes `done` and a `coverage_binding_amendment_judged` event records verdict `carried` | 11 | "`runCoverageBinding` completes `done` when the judge returns `carried` citing an issued task id or `no-plan-obligation`, emitting one `coverage_binding_amendment_judged` event per amendment claim with that verdict, as asserted by the carried and no-plan-obligation tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 3 happy: Given an ADR carries one amendment block and the judge returns `no-plan-obligation`, when `coverage_binding` runs, then the step completes `done` with no operator action | 11 | "`runCoverageBinding` completes `done` when the judge returns `carried` citing an issued task id or `no-plan-obligation`, emitting one `coverage_binding_amendment_judged` event per amendment claim with that verdict, as asserted by the carried and no-plan-obligation tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 3 happy: Given an amendment block the judge returns `not-carried` with a `missingObligation`, when `coverage_binding` runs, then the step is `refused` `needs-human` and the halt names the artifact path, the amendment text, and the `missingObligation` | 11 | "a `not-carried` verdict makes the step return refused with kind `needs-human`, and the halt detail names the artifact path, the amendment text, and the `missingObligation`, as asserted by the not-carried refusal test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 3 happy: Given an amendment block whose digest already carries `carried` in the previous envelope, when `coverage_binding` re-runs, then that claim is not dispatched to the judge | 11 | "an amendment claim whose digest already carries `carried` in the previous envelope is not dispatched on re-run, and with the judge disabled every amendment claim is recorded `unjudged` with zero provider dispatches and no refusal, as asserted by the amendment cache and judge-disabled tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 3 negative: Given the judge returns `carried` with a task id that was not issued in the batch, when the payload is validated, then the whole batch is rejected as an infrastructure failure and no verdict from it is recorded | 10 | "`parseAmendmentBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` rejects the whole batch when a `carried` verdict cites a task id not issued in the batch or a `not-carried` verdict has an empty `missingObligation`, as asserted by the foreign-task and empty-missing-obligation tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 3 negative: Given the judge returns `not-carried` with an empty `missingObligation`, when the payload is validated, then the whole batch is rejected as an infrastructure failure | 10 | "`parseAmendmentBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` rejects the whole batch when a `carried` verdict cites a task id not issued in the batch or a `not-carried` verdict has an empty `missingObligation`, as asserted by the foreign-task and empty-missing-obligation tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 3 negative: Given the DECIDE set carries both criterion claims and amendment claims, when batches are planned, then no batch mixes the two claim kinds and every `coverage_binding_judged` event carries only `asserts`, `does-not-assert`, or `not-applicable` | 10, 11 | "the batch planner in `src/conductor/src/engine/coverage-binding-batches.ts` never places a criterion claim and an amendment claim in the same batch, as asserted by the mixed-kind planning test in `src/conductor/test/engine/coverage-binding-batches.test.ts`" | diff-local |
| Story 3 negative: Given the judge is disabled and the DECIDE set carries an amendment block, when `coverage_binding` runs, then the claim is recorded `unjudged`, no provider is dispatched, and the amendment does not refuse the step | 11 | "an amendment claim whose digest already carries `carried` in the previous envelope is not dispatched on re-run, and with the judge disabled every amendment claim is recorded `unjudged` with zero provider dispatches and no refusal, as asserted by the amendment cache and judge-disabled tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 3 negative: Given the plan itself carries an amendment block, when claims are assembled, then no amendment claim is created from the plan | 9 | "an amendment blockquote in the plan itself yields no claim, as asserted by the plan-amendment-excluded test in `src/conductor/test/engine/coverage-binding-inputs.test.ts`" | diff-local |
| Story 4 happy: Given a void has been recorded, task 3 is completed, and the judge lists task 3 in an amendment claim's `contradictsCompleted`, when `coverage_binding` accepts the batch, then task 3 is restaged as open with a repair obligation whose source authority is `coverage_binding` and a `coverage_binding_task_reopened` event names task 3 and the claim digest | 13 | "when the previous envelope status is `invalidated` and the judge lists completed task 3 in an amendment claim's `contradictsCompleted`, `runCoverageBinding` reopens task 3 through `admitAndRestageRepair` with source authority `coverage_binding` and emits one `coverage_binding_task_reopened` event naming task 3 and the claim digest, as asserted by the judged-reopen test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 4 happy: Given a void has been recorded, task 2 is completed, and a criterion claim citing task 2 has a digest absent from the previous envelope's recorded digests, when `coverage_binding` runs, then task 2 is restaged as open without a model call | 13 | "when the previous envelope status is `invalidated` and a criterion claim citing completed task 2 has a digest absent from the previous envelope's recorded digests, task 2 is restaged open with zero provider dispatches, while a completed task cited only by unchanged digests stays completed, as asserted by the criterion-digest reopen test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 4 happy: Given reopened tasks exist, when the step completes, then the plan file is byte-identical to before the step, the step records no routing to `plan`, and the reopen is charged to `gates.coverage_binding` | 13 | "after reopening, the plan file is byte-identical to before the step, no `plan` routing or kickback is recorded, the reopen lap is charged to `gates.coverage_binding`, and `coverage_binding_task_reopened` is declared in `src/conductor/src/engine/event-sinks.ts`, as asserted by the no-replan test in `src/conductor/test/engine/step-runners.test.ts` and the sink-registry exhaustiveness test" | diff-local |
| Story 4 negative: Given coverage inputs changed through a rebase refresh and no void was recorded, when `coverage_binding` runs, then no task is reopened | 13 | "when the previous envelope status is not `invalidated`, including a rebase-refresh run, no task is reopened, and when the previous envelope carries no recorded digests no criterion-digest reopen occurs, as asserted by the rebase-refresh and digest-less baseline tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 4 negative: Given the previous envelope was written with the judge disabled or predates recorded digests, when `coverage_binding` runs after a void, then no criterion-digest reopen occurs and the new envelope records every current digest | 13 | "when the previous envelope status is not `invalidated`, including a rebase-refresh run, no task is reopened, and when the previous envelope carries no recorded digests no criterion-digest reopen occurs, as asserted by the rebase-refresh and digest-less baseline tests in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 4 negative: Given the judge lists a task id in `contradictsCompleted` that is not among the completed task ids issued in the batch, when the payload is validated, then the whole batch is rejected as an infrastructure failure and no task is reopened | 10 | "`parseAmendmentBatchPayload` rejects the whole batch when `contradictsCompleted` names a task id outside the completed task ids issued in that batch, as asserted by the foreign-contradiction test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 4 negative: Given a criterion claim whose digest is unchanged from the previous envelope cites a completed task, when `coverage_binding` runs after a void, then that task stays completed | 13 | "when the previous envelope status is `invalidated` and a criterion claim citing completed task 2 has a digest absent from the previous envelope's recorded digests, task 2 is restaged open with zero provider dispatches, while a completed task cited only by unchanged digests stays completed, as asserted by the criterion-digest reopen test in `src/conductor/test/engine/step-runners.test.ts`" | diff-local |
| Story 4 negative: Given the same reopen is admitted twice for the same plan, claim, and HEAD, when `coverage_binding` re-runs, then the repair obligation is replayed rather than duplicated and the task is restaged once | 12 | "a second admission for the same plan, claim digest, bindings, and HEAD replays the existing obligation, leaves exactly one restage, and charges no second lap, as asserted by the replay test in `src/conductor/test/engine/repair-restage.test.ts`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-31-coverage-binding-judge-step#D1 | existing | none | Criterion claims keep their two carriers; `assembleCoverageBindingClaims` in `coverage-binding-inputs.ts` is unchanged by this plan. |
| adr-2026-08-31-coverage-binding-judge-step#D2 | existing | none | The land-time `Done when` quote scoping in `checkCriterionCoverage` is untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | existing | none | The tier-S land criterion layer in `runCoherenceGate` is untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | existing | none | `coverage_binding` stays registered in `steps.ts` after `coherence_check` with `phase: 'BUILD'`; no placement change. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | existing | none | The fresh one-shot criterion judge dispatch and its closed verdict envelope in `step-runners.ts` are unchanged for criterion claims. |
| adr-2026-08-31-coverage-binding-judge-step#D6 | existing | none | The `does-not-assert` refusal path (`refused`, `needs-human`, `writeHaltMarker`) is reused unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D7 | existing | none | `coverage_binding.judge.enabled` keeps its registration in `resolved-config.ts` and still gates judged claims. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | existing | none | Criterion claims with no `Done when` block stay `not-applicable` in `assembleCoverageBindingClaims`. |
| adr-2026-08-31-coverage-binding-judge-step#D9 | existing | none | `coverage_binding_judged` and `coverage_binding_disabled` remain declared in `event-sinks.ts` with the criterion vocabulary. |
| adr-2026-08-31-coverage-binding-judge-step#D10 | existing | none | The optional seventh correction cell is parsed by the shared coherence parser; no BUILD consumer reads it. |
| adr-2026-08-31-coverage-binding-judge-step#D11 | existing | none | Land resolves `architecture:` correction references through `formatArchitectureDecisionId`; untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D12 | existing | none | Criterion claims are dispatched per bounded batch by `coverage-binding-batches.ts`. |
| adr-2026-08-31-coverage-binding-judge-step#D13 | existing | none | `parseJudgeBatchPayload` enforces exact digest-set equality for criterion batches. |
| adr-2026-08-31-coverage-binding-judge-step#D14 | existing | none | The `partial` envelope checkpoint after every batch is written by `writeCoverageBindingEnvelope`. |
| adr-2026-08-31-coverage-binding-judge-step#D15 | existing | none | `coverage_binding.judge.batch_size` is validated in `config.ts` and resolved in `resolved-config.ts`. |
| adr-2026-08-31-coverage-binding-judge-step#D16 | task | task-4, task-5 | `voidCoverageBindingForDecideChange` in `src/conductor/src/engine/coverage-binding-void.ts`, given one DECIDE-set path whose new fingerprint differs from its prior fingerprint, rewrites `.pipeline/coverage-binding.json` with status `invalidated` and its entries unchanged, persists the gate verdict unsatisfied with origin `decide-change`, and sets the persisted `coverage_binding` status to not done, as asserted by the void test in `src/conductor/test/engine/coverage-binding-void.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D17 | task | task-7, task-8 | `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` runs `validateArchitectureObligationCoverage` against the `parseAdrDecisions` decision ids of the DECIDE set's ADRs before its judge-disabled return, and with D1–D3 each carried by one valid row it records no ADR-layer violation and proceeds to judged claims, as asserted by the obligation-pass test in `src/conductor/test/engine/step-runners.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D18 | task | task-9, task-10, task-11 | `assembleAmendmentClaims` in `src/conductor/src/engine/coverage-binding-inputs.ts` returns one claim per `> **Amended YYYY-MM-DD by #N:**` blockquote in the architecture review, PRD, and ADRs, each carrying the artifact path, the full blockquote text, and every plan task id with its `Done when` checks, as asserted by the amendment-extraction test in `src/conductor/test/engine/coverage-binding-inputs.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D19 | task | task-13 | when the previous envelope status is `invalidated` and the judge lists completed task 3 in an amendment claim's `contradictsCompleted`, `runCoverageBinding` reopens task 3 through `admitAndRestageRepair` with source authority `coverage_binding` and emits one `coverage_binding_task_reopened` event naming task 3 and the claim digest, as asserted by the judged-reopen test in `src/conductor/test/engine/step-runners.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D20 | task | task-4, task-11, task-13 | the same call emits one `coverage_binding_invalidated` event whose `paths` names the changed ADR path and whose `origin` is `decide-change`, and `coverage_binding_invalidated` is declared in `src/conductor/src/engine/event-sinks.ts` with persist enabled, as asserted by the void-event test and the sink-registry exhaustiveness test |
| adr-2026-09-06-reopened-task-resolution#D1 | existing | none | Repair obligations are stored in `engine-state.json` by `createRepairObligationStore` in `repair-obligations.ts`. |
| adr-2026-09-06-reopened-task-resolution#D2 | existing | none | `admitOrReplay` persists before restaging and replays idempotently in `repair-obligations.ts`. |
| adr-2026-09-06-reopened-task-resolution#D3 | existing | none | Engine-state writers share the serialized atomic update seam in `repair-obligations.ts`. |
| adr-2026-09-06-reopened-task-resolution#D4 | existing | none | Open-obligation resolution after the saved boundary is enforced by `resolveTaskIds` in `task-progress.ts`. |
| adr-2026-09-06-reopened-task-resolution#D5 | existing | none | The strict post-reopen commit range is implemented beside `getEvidenceRange`; untouched. |
| adr-2026-09-06-reopened-task-resolution#D6 | existing | none | `task-seed.ts` reconstruction reads the shared obligation reader; untouched. |
| adr-2026-09-06-reopened-task-resolution#D7 | existing | none | Scope acceptance precedes repair admission in `planRemediation`; untouched. |
| adr-2026-09-06-reopened-task-resolution#D8 | existing | none | Completed repairs return to their governing review through the existing review loop; decision 10 names `build_review` for this source. |
| adr-2026-09-06-reopened-task-resolution#D9 | existing | none | Remediation eligibility, budgets, and plan-growth accounting in `planRemediation` are preserved by the Task 12 extraction. |
| adr-2026-09-06-reopened-task-resolution#D10 | task | task-12 | `admitAndRestageRepair` with source authority `coverage_binding` admits an obligation whose source authority is `coverage_binding`, restages the bound task rows, and charges one lap to `gates.coverage_binding` in the kickback ledger, as asserted by the coverage-binding admission test in `src/conductor/test/engine/repair-restage.test.ts` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
