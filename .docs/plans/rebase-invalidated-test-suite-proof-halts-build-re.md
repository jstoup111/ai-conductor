# Implementation Plan: Rebase-invalidated test_suite proof HALTs build_review

**Date:** 2026-08-19
**Design:** .docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md
**Stories:** .docs/stories/rebase-invalidated-test-suite-proof-halts-build-re.md
**Stories status:** Accepted; Stories 1–6
**Conflict check:** Clean as of 2026-08-19
**Review conditions:** .docs/decisions/architecture-review-2026-08-19-rebase-invalidated-test-suite-proof-halts-build-re.md

## Summary

Sixteen tasks that stop a rebase-invalidated aggregate suite proof from stranding a feature at a
`needs-human` HALT no retry can clear. Closes ai-conductor#1729.

## Technical Approach

**The defect is a placement, not a missing mechanism.** `adr-2026-07-11`'s verdict-aware resume clamp
already does its job: with `gates/test_suite.json` reading `satisfied: false`, it lands `startIndex`
exactly on `test_suite`. The very next statement discards that (`conductor.ts:4351`):

```
const alreadyResolved = currentStatus === 'done' || currentStatus === 'skipped';
if (alreadyResolved && !explicitlyTargeted) continue;
```

State-only, and first on every iteration — ahead of the tier skip, the track skip, the bootstrap
skip, and the DECIDE-phase predicate re-check at `:4443`, which is guarded `step.phase === 'DECIDE'`.
So the clamp selects `test_suite`, the loop skips it because `conduct-state.json` still says `done`,
and `build_review` runs against an unsatisfied prerequisite (`steps.ts:181`).

Nothing corrects the ledger on this path. `scanKickbackVerdicts` — `adr-2026-07-11`'s named sole
owner of verdict-driven demotion — matches only `kickback.from === <a step that just completed
in-loop>` (`conductor.ts:8989`). A pre-loop re-kick writes `from: 'rebase'` (`rebase.ts:1366`) with
no in-loop `rebase` step running, so the match never occurs.

**The fix asks the tree, not either cache of it.** An eligible gate re-evaluates
`checkStepCompletion` before the short-circuit honors `done`. `test_suite`'s predicate
(`artifacts.ts:3076-3098`) *is* the content-addressed inspection, so a CURRENT proof answers
`done: true` and the loop fast-forwards with no re-run — outcome-6 falls out of the same call that
delivers outcomes 1 and 2. Nothing is written, which is what keeps `adr-2026-07-11`'s rejected
Option C closed rather than re-proposed.

**Two mechanisms, because two variants were observed.** The second stranded feature had
`gates/test_suite.json` reading `satisfied: true` while the proof inspection returned STALE — no
kickback verdict existed at all. The boundary check (D2) covers both. The pre-verify extension (D6)
covers neither by itself but keeps the verdict honest where the knowledge lives, preserving the
no-gratuitous-lap fast path at its natural site. Tasks 2-3 and 8-9 are therefore both load-bearing;
neither subsumes the other.

**Eligibility is declared, not listed.** `adr-2026-07-08` published the bar — the predicate
mechanically re-verifies the current tree — and invited extension by meeting it. `adr-2026-07-25` D5
supplies the qualifying property for `test_suite`: the fingerprint, not the commit SHA, is the reuse
key. Task 1 puts the declaration on `StepDefinition`, so the boundary check and the pre-verify read
one source and cannot drift, and `wiring_check` stays out because its predicate is unconditionally
satisfied.

**Route on kind, never on text.** `adr-2026-08-18` D1 removed the last reason-text prefix match in
this codebase one day before this spec. Task 11 keys on the `TestSuiteProofError` class at the catch
site (`step-runners.ts:2198`) and puts a typed facet on the result; Task 12 gives
`classifyRetryDecision` a third signal reading that facet. A `startsWith` on the message is the
rejection.

**The named halt and the operator verb are one obligation.**
`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` requires the marker to name the
action that resumes it. Today the marker exists and the action does not. Task 13's halt names
`test_suite`; Tasks 14-15 supply the command that acts on it. Splitting them would satisfy the
invariant nominally and not in fact — which is why the operator chose the wider scope.

**What is deliberately not done.** `adr-2026-07-20`'s preserve/invalidate partition is consumed, never
recomputed (review condition 5). `adr-2026-07-25`'s fingerprint, execution, and evidence semantics are
untouched. `checkGate` stays state-only and `gateSatisfied` stays pure (`adr-2026-07-11` D4/D5).
`build` stays outside the retry classifier (`adr-2026-07-13` non-goals).

**Sequencing note.** `hotfix/rebase-drop-guard-supersession` adds a block to `rebase.ts` near `:815`,
disjoint from `applyRebaseVerdicts` at `~:1300`. Anchor Task 9 to the seam, not to line numbers.

## Task Dependency Graph

```
Task 0 (measure the predicate's per-iteration cost)
  └── Task 1 (declare tree-attesting eligibility on StepDefinition)
        ├── Task 2 (RED: both strand fixtures dispatch test_suite)
        │     └── Task 3 (GREEN: boundary re-check before alreadyResolved)
        │           ├── Task 4 (negative: current proof fast-forwards; no top-of-list re-run)
        │           ├── Task 5 (negative: skipped stays skipped; throwing predicate dispatches)
        │           ├── Task 6 (negative: the re-check writes nothing)
        │           └── Task 7 (negative: checkGate and gateSatisfied unchanged)
        └── Task 8 (RED: pre-verify over the eligible set)
              └── Task 9 (GREEN: applyRebaseVerdicts pre-verifies every eligible gate)
                    └── Task 10 (negative: build_review/manual_test still unconditional; partition not recomputed)

Task 11 (typed unretryable facet at the TestSuiteProofError catch)
  └── Task 12 (classifier signal (c) at the step-runner seam, with kill-switch revert)
        └── Task 13 (the halt names the blocking step and classifies needs-human)

Task 14 (rewind: port mutations, demotion set, refusals)
  └── Task 15 (rewind: verdict + halt clearing, ordering, spine emission, CLI registration)
        └── Task 16 (documentation upkeep and release-surface classification)
```

---

### Task 0: Measure the completion predicate's per-iteration cost
**Story:** 1
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Time `FullSuiteVerifier.inspect()` in this repository's own tree, over the tracked and declared
   input set the `test_suite` config block resolves, across at least 20 runs.
2. Time `checkStepCompletion(projectRoot, 'build', ctx)` over the same tree for comparison.
3. Record both medians and the p95 in the commit message, alongside the loop's existing
   per-iteration cost for reference.
4. If the `test_suite` median is not comfortably below the loop's existing per-iteration cost, stop
   and halt for the operator: review condition 3 states that ADR-1 D2's placement stands but the
   plan must then add memoization within a single loop pass, which the review has not evaluated and
   which is a design change, not a task.
5. Commit an empty commit carrying `Evidence: skipped establishes findings only`.

> **Amended 2026-08-20 (operator decision; resolves architecture-review condition 3):**
> Step 4's stop fired and has been adjudicated. **No memoization is required. ADR-1 D2's placement
> stands unchanged and implementation proceeds from Task 1.** Step 4 is satisfied by this note;
> steps 1-3 and 5 stand as written.
>
> Measured in-tree over 20 warm runs, and reproduced independently on 2026-08-20:
>
> | Predicate | median | p95 |
> |---|---|---|
> | `FullSuiteVerifier.inspect()` | 175.85 ms | 185.19 ms |
> | `checkStepCompletion(root, 'build', ctx)` | 0.16 ms | 2.65 ms |
>
> Step 4 compared two *predicate* costs. That ratio is not what the decision turns on:
>
> 1. **The cost is not new.** `test_suite`'s completion predicate already calls
>    `FullSuiteVerifier.inspect()` (`artifacts.ts:3076-3081`), and already runs on every
>    `computeAndWriteVerdict('test_suite')`. ADR-1 D2 adds one further evaluation per loop pass; it
>    does not introduce the ~178 ms.
> 2. **A loop pass is dominated by provider dispatch.** `stepLoop` (`conductor.ts:4327`) visits each
>    step index once per pass, so the `test_suite` re-check fires once per pass. A representative
>    91-minute daemon session (`subagent-activity-and-live-per-step-token-burn-are`, its
>    `.pipeline/events.jsonl`, 2026-08-20) recorded 5 step dispatches and 2 kickbacks — on the order
>    of 10 passes, so ~1.8 s of re-check against 5478 s of wall-clock: **~0.03%**.
>
> The seam exists should this ever become load-bearing: `CompletionContext.fullSuiteInspect`
> (`artifacts.ts:3080`), already populated at `conductor.ts:1737`. Adopting it later is a local
> change, not a redesign. It is deliberately **not** adopted now — a per-pass memo must be
> invalidated on every dispatch or it masks exactly the mid-pass tree change this feature exists to
> catch, and that correctness risk is not worth ~178 ms per pass.
>
> Note: the architecture-review artifact's condition 3 still reads "the plan must add memoization".
> It is resolved here by operator decision rather than by editing that artifact, which is sealed
> under `.docs/decisions/` and whose stem does not name this feature's bare slug.

**Files likely touched:**
- none

**Dependencies:** none

---

### Task 1: Declare tree-attesting eligibility on StepDefinition
**Story:** 3
**Type:** happy-path

**Steps:**
1. Add an optional boolean to `StepDefinition` (`types/index.ts`) declaring that this step's
   completion predicate mechanically re-verifies the current tree or history, documented with
   `adr-2026-07-08`'s bar as the admission test and ADR-1 D1 as the governing decision.
2. Set it on `build` and `test_suite` in `ALL_STEPS` (`steps.ts`), each with a one-line comment
   naming why it meets the bar — trailer-union re-derivation for `build`, content fingerprint for
   `test_suite`.
3. Add a test asserting the declared set over `buildStepRegistry(defaultConfig)` is exactly
   `{build, test_suite}`, so a later addition cannot arrive without touching this assertion.
4. Add a test asserting `wiring_check` does not carry it, since its predicate is unconditionally
   satisfied and the declaration would be inert.
5. Verify GREEN.
6. Commit: "feat(steps): declare which gates mechanically re-verify the current tree".

**Files likely touched:**
- `src/conductor/src/types/index.ts` — the `StepDefinition` field
- `src/conductor/src/engine/steps.ts` — declarations on `build` and `test_suite`
- `src/conductor/test/engine/steps.test.ts` — the exact-set assertion

**Dependencies:** Task 0

---

### Task 2: RED — both observed strand fixtures dispatch test_suite
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test whose fixture is the first observed strand verbatim:
   `gates/test_suite.json` with `satisfied: false` and `kickback.from: 'rebase'`;
   `conduct-state.json` with `test_suite: done`, `build_review: failed`, `last_step: build_review`;
   a suite proof that inspects STALE. Assert `test_suite` is dispatched and `build_review` is not on
   that iteration.
2. Add a failing test whose fixture is the second observed variant: `gates/test_suite.json` with
   `satisfied: true`, the same STALE proof, and `test_suite: done`. Assert the same dispatch.
3. Add a failing test asserting that after `test_suite` completes with a passing proof,
   `build_review` is dispatched next and its input assembly finds a CURRENT proof.
4. Verify RED, and verify specifically that both tests fail on the *current* code path rather than
   erroring on a missing symbol — review condition 1 exists because a check placed after the
   short-circuit is inert, and only a test written against the loop's observable dispatch can see it.
5. Commit: "test(conductor): the gate loop dispatches test_suite when its proof is stale".

**Files likely touched:**
- `src/conductor/test/engine/conductor-gate-loop.test.ts` — both fixtures and the follow-on dispatch
- `src/conductor/test/fixtures/` — the two on-disk `.pipeline/` fixtures

**Dependencies:** Task 1

---

### Task 3: GREEN — the boundary re-check runs before the alreadyResolved short-circuit
**Story:** 1
**Type:** happy-path

**Steps:**
1. In the step loop (`conductor.ts`, immediately before the `alreadyResolved` test at `:4351`),
   re-evaluate `checkStepCompletion` for a step that carries Task 1's declaration, is
   `done`/`skipped` by state, and is being considered while `this.verifyArtifacts` is true.
2. When the predicate answers not-satisfied, fall through to dispatch rather than `continue`.
3. When it answers satisfied, keep today's `continue` exactly.
4. Use `await this.completionCtx(state)` — the same context the DECIDE re-check at `:4443` and
   `advanceTail` use. Introduce no new predicate and read no verdict file at this seam (ADR-1 D4).
5. Verify GREEN on Task 2, and verify the check is unreachable-if-misplaced by temporarily moving it
   after the short-circuit and confirming Task 2 fails again.
6. Commit: "fix(conductor): a tree-attesting gate re-checks its predicate before the loop skips it".

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — the step-loop boundary

**Dependencies:** Task 2

---

### Task 4: Negative — a current proof fast-forwards with no re-run
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add a test asserting that with `test_suite: done` and a CURRENT proof, the loop does not dispatch
   `test_suite` and proceeds to `build_review`.
2. Add a test asserting a resume in which every gate is satisfied still fast-forwards to the same
   step it reaches today — the "regressing to top-of-list re-runs" failure class `adr-2026-07-11`
   names as known-prior.
3. Verify GREEN.
4. Commit: "test(conductor): a current suite proof still fast-forwards to build_review".

**Files likely touched:**
- `src/conductor/test/engine/conductor-gate-loop.test.ts`

**Dependencies:** Task 3

---

### Task 5: Negative — skips are preserved and a throwing predicate dispatches
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add a test asserting a step whose status is `skipped` by complexity tier, work track, or
   bootstrap mode stays skipped and has no predicate evaluated for it.
2. Add a test asserting a predicate that throws causes the step to be dispatched and the throw not to
   propagate out of the loop — ADR-1 D5, matching `adr-2026-07-08`'s "never skip on doubt".
3. Add a test asserting a step without Task 1's declaration is untouched by the boundary check.
4. Verify GREEN.
5. Commit: "test(conductor): boundary re-check preserves skips and fails closed on a throw".

**Files likely touched:**
- `src/conductor/test/engine/conductor-gate-loop.test.ts`

**Dependencies:** Task 3

---

### Task 6: Negative — the boundary re-check writes nothing
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add a test asserting that across both Task 2 fixtures, `conduct-state.json` and every file under
   `.pipeline/gates/` are byte-unchanged by the boundary check itself.
2. Assert no `ConductStateStore` mutation is submitted from this seam.
3. Verify GREEN. This is the assertion that keeps `adr-2026-07-11`'s rejected reconcile-from-verdicts
   option closed rather than re-proposed under a different name.
4. Commit: "test(conductor): the boundary re-check reads and never writes".

**Files likely touched:**
- `src/conductor/test/engine/conductor-gate-loop.test.ts`

**Dependencies:** Task 3

---

### Task 7: Negative — checkGate and gateSatisfied are unchanged
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add a test asserting `checkGate`'s prerequisite evaluation remains state-only and returns the same
   result as before for the Task 2 fixtures (`adr-2026-07-11` D4).
2. Add a test asserting `gateSatisfied` and the resume clamp remain pure — no filesystem read is
   reachable from `selector.ts` (`adr-2026-07-11` D5).
3. Verify GREEN.
4. Commit: "test(selector): prerequisite checking and gate satisfaction semantics are unchanged".

**Files likely touched:**
- `src/conductor/test/engine/selector.test.ts`
- `src/conductor/test/engine/gates.test.ts`

**Dependencies:** Task 3

---

### Task 8: RED — the post-rebase pre-verify covers every eligible gate
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that after a file-changing rebase leaving the suite fingerprint
   identical, `test_suite`'s verdict is written satisfied with the mechanical re-verify reason rather
   than kicked back.
2. Add a failing test asserting a `rebase_gate_reverified` record names `test_suite` with dispatch
   skipped.
3. Add a failing test asserting that when the fingerprint did change, `test_suite` is invalidated
   exactly as today.
4. Add a failing test asserting a pre-verify that throws invalidates the gate.
5. Verify RED.
6. Commit: "test(rebase): the post-rebase pre-verify covers every tree-attesting gate".

**Files likely touched:**
- `src/conductor/test/engine/rebase-verdicts.test.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`

**Dependencies:** Task 1

---

### Task 9: GREEN — applyRebaseVerdicts pre-verifies the eligible set
**Story:** 3
**Type:** happy-path

**Steps:**
1. In `applyRebaseVerdicts` (`rebase.ts`, the `changed`-outcome branch), replace the hardcoded
   `build` pre-verify with an iteration over the gates carrying Task 1's declaration, preserving the
   existing per-gate structure: pre-verify passes → write a fresh satisfied verdict and record it as
   re-verified; fails or throws → today's kickback verdict.
2. Widen `makeRekickBuildPreVerify` (`daemon-rekick.ts`) to resolve the predicate for whichever gate
   it is asked about, keeping the injected-capability seam so an absent capability still fail-closes
   to unconditional invalidation.
3. Consume `classifyGateInvalidation`'s existing output for the invalidation set; do not recompute
   the partition (review condition 5).
4. Anchor edits to the `applyRebaseVerdicts` seam rather than line numbers —
   `hotfix/rebase-drop-guard-supersession` shifts them.
5. Verify GREEN on Task 8.
6. Commit: "fix(rebase): pre-verify every tree-attesting gate, not only build".

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — the `changed`-outcome pre-verify branch
- `src/conductor/src/engine/daemon-rekick.ts` — the pre-verify capability

**Dependencies:** Task 8

---

### Task 10: Negative — the pre-verify set is bounded and the partition is intact
**Story:** 3
**Type:** negative-path

**Steps:**
1. Add a test asserting `build_review` and `manual_test` are invalidated unconditionally after any
   file-changing rebase, with no pre-verify attempted for either.
2. Add a test asserting the set of gates a rebase invalidates is byte-identical to the pre-change
   behavior for a representative delta — the pre-verify changes which gates are re-verified, never
   which are invalidated.
3. Add a test asserting no second implementation of `classifyGateInvalidation`'s partition exists at
   the pre-verify site: the site consumes that function's output.
4. Verify GREEN.
5. Commit: "test(rebase): the pre-verify set is bounded and the invalidation partition is untouched".

**Files likely touched:**
- `src/conductor/test/engine/rebase-verdicts.test.ts`

**Dependencies:** Task 9

---

### Task 11: A typed unretryable facet at the suite-proof catch site
**Story:** 5
**Type:** happy-path

**Steps:**
1. Add an optional facet to the step-runner result declaring that this failure's inputs cannot change
   on a re-dispatch of this step, and naming the step whose completion would change them.
2. Populate it at `step-runners.ts:2198`, where `assembleBuildReviewInputs` is caught, by checking
   `err instanceof TestSuiteProofError` — a class check, never a message match (ADR-2 D1,
   `adr-2026-08-18` D1).
3. Leave the human-facing output string exactly as it is; it continues to travel for the report.
4. Add a test asserting the facet is set for `TestSuiteProofError` and absent for every other
   assembly failure, including `MergeBaseError`.
5. Verify GREEN.
6. Commit: "feat(step-runners): type the suite-proof assembly failure as unretryable".

**Files likely touched:**
- `src/conductor/src/types/index.ts` — the `StepRunResult` facet
- `src/conductor/src/engine/step-runners.ts` — the catch at `:2198`
- `src/conductor/test/engine/step-runners.test.ts`

**Dependencies:** none

---

### Task 12: Classifier signal (c) at the step-runner retry seam
**Story:** 5
**Type:** happy-path

**Steps:**
1. Add signal `unretryable-inputs` to `classifyRetryDecision`, returning `route` when the result
   carries Task 11's facet. Unlike signal (b) it fires on try 1, because unchangeability is asserted
   by the failure's type rather than inferred from a repeat. Keep the function pure.
2. Call the classifier from the step-runner failure branch (`conductor.ts:6729`) before the
   `attempt < stepMaxRetries` test, and break the retry loop on `route`.
3. Emit the existing `retry_decision` event with the new signal (ADR-2 D5) — extend that member's
   signal vocabulary; add no union member.
4. Add a test asserting `retry_routing.enabled: false` bypasses signal (c) entirely and the step
   retries to `stepMaxRetries` exactly as today — `adr-2026-07-13` D6's exact-revert contract.
5. Add a test asserting `build` is never passed to the classifier and its progress accounting is
   untouched, and a test asserting a failure with no facet retries as today.
6. Verify GREEN.
7. Commit: "fix(conductor): route a step failure whose inputs cannot change instead of retrying".

**Files likely touched:**
- `src/conductor/src/engine/retry-classify.ts` — signal (c)
- `src/conductor/src/engine/conductor.ts` — the step-runner failure branch
- `src/conductor/src/types/events.ts` — the `retry_decision` signal vocabulary
- `src/conductor/test/engine/retry-classify.test.ts`

**Dependencies:** Task 11

---

### Task 13: The halt names the blocking step and classifies needs-human
**Story:** 4
**Type:** happy-path

**Steps:**
1. When signal (c) routes, terminate the loop with a halt whose reason names the failing step, the
   unchanged input, and the step that must re-run — read from Task 11's facet, not from the message.
2. Classify it `needs-human` (ADR-2 D3), so `daemon-rekick.ts`'s sweep does not clear and
   re-dispatch it.
3. Add a test asserting the reason names `test_suite` and does not read "retries exhausted".
4. Add a test asserting a `build_review` failure that is not an unretryable input-assembly failure
   keeps today's halt text and classification.
5. Verify GREEN.
6. Commit: "fix(conductor): an unretryable failure halts naming the step that must re-run".

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — the halt composition on the routed path
- `src/conductor/test/engine/conductor-halt.test.ts`

**Dependencies:** Task 12

---

### Task 14: The rewind verb — port mutations, demotion set, and refusals
**Story:** 6
**Type:** happy-path

**Steps:**
1. Add a `rewind` module that resolves the target step against `buildStepRegistry(config)` and
   fails by name listing valid step names when it does not resolve
   (`adr-2026-08-04`), accepting config-declared custom steps.
2. Refuse a target at or after the feature's current position, mutating nothing.
3. Compute the demotion set as the target plus every non-skipped step after it in the resolved list;
   leave `skipped` statuses as they are (ADR-3 D3).
4. Submit each demotion to `ConductStateStore` as `done → stale` with the current value as the
   expected value and an intent naming the operator rewind (ADR-3 D2, `adr-2026-08-01`). On a refused
   mutation, abort reporting field, expected, and current; never fall back to a direct write.
5. Add tests for each refusal above, for the custom-step acceptance, and for `stale` rather than
   `pending` as the target status.
6. Verify GREEN.
7. Commit: "feat(rewind): demote a feature to a named earlier step through the mutation port".

**Files likely touched:**
- `src/conductor/src/engine/rewind.ts` — new
- `src/conductor/test/engine/rewind.test.ts` — new

**Dependencies:** none

---

### Task 15: The rewind verb — clearing, ordering, spine emission, and CLI registration
**Story:** 6
**Type:** happy-path

**Steps:**
1. Clear the gate verdicts for the demoted steps and remove `.pipeline/HALT` with its class sidecar,
   following `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` rather than adding a second
   clearing path.
2. Order the operation acquire → mutate state → clear verdicts → clear halt, so a failure at any
   point leaves the feature halted rather than running from a partially-rewound position (ADR-3 D4).
3. Add a negative test in which a mid-rewind failure leaves the feature halted with its state
   unchanged — review condition 2.
4. Emit the rewind occurrence on `ConductorEvent`, naming operator, target, and demoted set
   (ADR-3 D5). Declare its sink per `adr-2026-07-26-event-sink-registry-exhaustiveness`.
5. Register the verb in the `conduct-ts` command table beside `reseal` and `decide-grant`. Add a test
   asserting no engine, daemon, or step-runner call site invokes it (ADR-3 D6).
6. Add an end-to-end test: rewind a halted fixture to `test_suite`, then assert the next dispatch
   runs `test_suite` and proceeds without further operator action.
7. Verify GREEN.
8. Commit: "feat(cli): add conduct-ts rewind for returning a feature to a named earlier step".

**Files likely touched:**
- `src/conductor/src/engine/rewind.ts`
- `src/conductor/src/engine/cli-builtins.ts` — command registration
- `src/conductor/src/types/events.ts` and `event-sinks.ts` — the occurrence and its sink
- `src/conductor/test/engine/rewind.test.ts`
- `src/conductor/test/acceptance/rewind-recovers-a-halted-feature.acceptance.test.ts` — new

**Dependencies:** Task 14

---

### Task 16: Documentation upkeep and release-surface classification
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Add the `rewind` verb to `docs/reference/cli.md`. Distinct section from PR #1720's edit to the same
   file; ordinary rebase resolution.
2. Update `docs/runbooks/stalled-or-stuck-feature.md` to replace the hand-edit recovery for a stale
   suite proof with the `rewind` command, and note that the common case now self-resolves.
3. Update `docs/explanation/gates.md` with the tree-attesting eligibility rule and the current set.
4. Classify the release surface before the build finishes (review condition 4): the verb is additive
   and no existing invocation changes meaning, but the release gate's classifier is path-based. If it
   flags a canonical breaking surface, commit
   `.docs/release-waivers/rebase-invalidated-test-suite-proof-halts-build-re.md` in this same diff,
   naming every touched canonical surface verbatim — partial coverage halts.
5. Verify the validation suite passes.
6. Commit: "docs: document the rewind verb and the tree-attesting gate rule".

**Files likely touched:**
- `docs/reference/cli.md`
- `docs/runbooks/stalled-or-stuck-feature.md`
- `docs/explanation/gates.md`
- `.docs/release-waivers/rebase-invalidated-test-suite-proof-halts-build-re.md` — only if the gate flags

**Dependencies:** Task 15

## Release metadata

```
Release-Disposition: note
Release-Category: Fixed
Release-Semver: minor
Release-Note: A rebase that invalidates the aggregate test-suite proof now re-runs the suite instead of stranding the run at an unclearable HALT, and `conduct-ts rewind` returns a feature to a named earlier step without hand-editing pipeline state.
```
