# Coherence: Rebase-invalidated test_suite proof HALTs build_review

**Date:** 2026-08-19
**Tier:** M — technical track (no PRD, so the `fr` row class is omitted as not applicable)
**Plan stem:** `rebase-invalidated-test-suite-proof-halts-build-re`
**Outcome source:** `.pipeline/intake-outcomes.md` (`Source-Ref: jstoup111/ai-conductor#1729`)

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | "A rebase that invalidates the aggregate suite proof results in the suite being re-run before `build_review` is dispatched — the run continues without operator action." story-1 is written against the first observed strand fixture verbatim — gate verdict `satisfied: false` with `kickback.from: 'rebase'`, `conduct-state.json` `test_suite: done`, `last_step: build_review` — and asserts `test_suite` is dispatched and `build_review` is not. The mechanism is ADR-1 D2's boundary re-check: the loop consults `checkStepCompletion` before the `alreadyResolved` short-circuit honors a persisted `done`. Its negative paths pin the three ways the fix could over-reach — a current proof must still fast-forward, a skipped step must stay skipped, and a throwing predicate must dispatch rather than propagate. |
| outcome | outcome-2 | story-2 | covered | "`build_review` is never dispatched while its own prerequisite gate is unsatisfied." story-2 carries the second observed variant, where `gates/test_suite.json` read `satisfied: true` while the proof inspected STALE and no kickback verdict existed at all. This is the row that forces the design: a fix reading verdicts satisfies outcome-1 and fails outcome-2, which is why ADR-1 D2 consults the predicate rather than either ledger. Its negative paths assert the re-check writes nothing, keeping `adr-2026-07-11`'s rejected reconcile-from-verdicts option closed, and that `checkGate` and `gateSatisfied` are unchanged. |
| outcome | outcome-3 | story-4 | covered | "If a proof is stale for a reason the loop genuinely cannot resolve, the run stops with a message naming the step that must re-run — not three identical retries of a step that cannot fix it." story-4 asserts the halt names `test_suite` and the unchanged input, and classifies `needs-human` so `daemon-rekick.ts`'s sweep does not clear and re-dispatch it. Its negative path asserts the reason does not read "retries exhausted" for this class, discharging `adr-2026-07-13` D5. This is the residual path by construction — with story-1 in force the common case self-resolves — which is stated in ADR-2 D3 rather than left implicit. |
| outcome | outcome-4 | story-5 | covered | "A retry budget is not spent on a failure whose inputs cannot change between attempts." story-5 asserts the routing decision is made on attempt 1 and no further dispatch occurs. Its negative paths carry the three constraints that keep it from over-firing: a failure with no typed facet retries as today, `retry_routing.enabled: false` is an exact revert per `adr-2026-07-13` D6, and `build` is never passed to the classifier. The fourth negative path — the decision is derived from a typed facet and not from any message match — is `adr-2026-08-18` D1's route-on-kind rule made assertable. |
| outcome | outcome-5 | story-6 | covered | "An operator can return a feature to a named earlier step through a supported command, without hand-editing `.pipeline/conduct-state.json` or gate files." story-6 asserts the demotion set, the verdict and halt clearing, and that the next dispatch proceeds unaided. Its seven negative paths carry every refusal ADR-3 specifies: backward-only, fail-by-name on an unknown step, custom-step acceptance, port-refusal abort with no direct-write fallback, atomicity under mid-operation failure, skipped statuses preserved, and no harness call site. |
| outcome | outcome-6 | story-3 | covered | "A run whose suite proof is current after a rebase still proceeds straight to `build_review` (no gratuitous re-run)." story-3 asserts the post-rebase pre-verify writes a satisfied verdict when the fingerprint is identical, records the re-verify with dispatch skipped, and that the loop then reaches `build_review` without dispatching `test_suite`. This outcome is delivered twice over, deliberately: ADR-1 D6 keeps the verdict honest at the invalidation site and ADR-1 D2's predicate answers `done: true` on a CURRENT proof. story-3's negative paths bound the pre-verify to `{build, test_suite}` and forbid recomputing `adr-2026-07-20`'s partition. |
| adr | adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch | story-1, story-2, story-3 | covered | D1 (eligibility is a declared step property tested by `adr-2026-07-08`'s bar; the set is exactly `build` and `test_suite`; `wiring_check` excluded as inert) to story-3's negative paths and task-1's exact-set assertion. D2 (the re-check runs at the dispatch boundary, before the short-circuit, under `verifyArtifacts`) to story-1 and story-2 happy paths. D3 (reads, never writes) to story-2's negative path and task-6. D4 (one authority, `checkStepCompletion`) to task-3's requirement to use the same `completionCtx` as the DECIDE re-check. D5 (fail-closed on a throwing predicate) to story-1's negative path. D6 (`test_suite` joins the pre-verify set, superseding `adr-2026-07-08`'s scope sentence for that gate only) to story-3. D7 (`checkGate` and the selector unchanged) to story-2's negative paths and task-7. |
| adr | adr-2026-08-19-unretryable-step-runner-failures-route-by-kind | story-4, story-5 | covered | D1 (a typed facet set on an error-class check at the catch site, never a message match) to task-11 and story-5's fourth negative path. D2 (classifier signal (c) at the step-runner seam, firing on try 1) to story-5's happy path. D3 (the route is a `needs-human` halt naming the step, and is the residual path once ADR-1 is in force) to story-4. D4 (the kill switch is the existing `retry_routing`, exact revert) to story-5's second negative path. D5 (rides the existing `retry_decision` member's signal vocabulary, no new union member) to task-12 step 3. D6 (`build` stays outside the classifier) to story-5's third negative path. |
| adr | adr-2026-08-19-operator-step-rewind-through-the-mutation-port | story-6 | covered | D1 (backward-only, resolved-registry validation, fail-by-name) to story-6's first three negative paths. D2 (every change an authorized port mutation with the current expected value; `stale` not `pending`, because `stepSatisfied` and `gateSatisfied` read it differently) to story-6's port-refusal path and task-14. D3 (the demoted set is the target plus non-skipped downstream; skipped statuses preserved) to story-6's sixth negative path. D4 (verdicts and the halt cleared in the same operation, in an order that fails halted) to story-6's atomicity path and review condition 2. D5 (the occurrence rides the spine) to task-15 step 4. D6 (operator-invoked only) to story-6's final negative path. |
| story | story-1 | task-0, task-2, task-3, task-4, task-5 | covered | task-0 measures the predicate's per-iteration cost before the plan asserts it negligible, and halts for the operator rather than proceeding if review condition 3's bar is not met. task-2 is RED against both observed fixtures and is explicitly required to fail on the current code path rather than error on a missing symbol. task-3 is GREEN and includes the misplacement check — temporarily moving the re-check after the short-circuit must make task-2 fail again, which is the only mechanical guard against the inert-placement failure review condition 1 names. task-4 and task-5 are the negative halves: fast-forward preserved, skips preserved, throw dispatches. |
| story | story-2 | task-6, task-7 | covered | task-6 asserts `conduct-state.json` and every gate verdict file are byte-unchanged by the boundary check and that no `ConductStateStore` mutation is submitted from that seam — the assertion that keeps `adr-2026-07-11`'s rejected Option C closed rather than re-proposed under another name. task-7 asserts `checkGate` stays state-only and no filesystem read is reachable from `selector.ts`. story-2's happy paths are exercised by task-2's second fixture, which is why story-2 has no RED task of its own: the same test file carries both variants deliberately, so a fix cannot pass one and fail the other unnoticed. |
| story | story-3 | task-1, task-8, task-9, task-10 | covered | task-1 declares eligibility on `StepDefinition` and pins the set to exactly `{build, test_suite}`, so a later addition cannot arrive without touching that assertion. task-8 is RED for the identical-fingerprint preserve, the re-verified record, the changed-fingerprint invalidation, and the throwing pre-verify. task-9 is GREEN and is anchored to the `applyRebaseVerdicts` seam rather than line numbers, because `hotfix/rebase-drop-guard-supersession` shifts them. task-10 is the bound: `build_review` and `manual_test` stay unconditional and the invalidation partition is byte-identical, discharging review condition 5. |
| story | story-4 | task-13 | covered | task-13 composes the halt from task-11's typed facet rather than from the message, names the blocking step, classifies `needs-human`, and asserts that a `build_review` failure of any other kind keeps today's text and classification. |
| story | story-5 | task-11, task-12 | covered | task-11 adds the facet and populates it on an `instanceof TestSuiteProofError` check, with a test asserting it is absent for every other assembly failure including `MergeBaseError` — so the discrimination is proven narrow, not merely intended. task-12 adds signal (c), calls the classifier ahead of the budget test, extends the existing `retry_decision` signal vocabulary, and carries the kill-switch, no-facet, and `build`-exclusion negatives. |
| story | story-6 | task-14, task-15 | covered | task-14 is the mutation half: registry-resolved target, backward-only refusal, the demotion set, port submission with expected values, and no direct-write fallback. task-15 is the clearing and wiring half: verdicts and halt cleared atomically in an order that fails halted, the spine occurrence with its sink declaration, CLI registration beside `reseal` and `decide-grant`, the no-harness-call-site assertion, and an end-to-end acceptance test that rewinds a halted fixture and proves the next dispatch proceeds unaided. |
| task | task-0 | story-1 | covered | `infrastructure`, `Verify-only: yes` — times `FullSuiteVerifier.inspect()` and `build`'s predicate in-tree, records medians and p95, and halts for the operator if review condition 3's bar is not met rather than proceeding on an unmeasured assumption. |
| task | task-1 | story-3 | covered | The `StepDefinition` declaration, set on `build` and `test_suite`, with the exact-set and `wiring_check`-excluded assertions. |
| task | task-2 | story-1 | covered | RED against both observed strand fixtures plus the follow-on `build_review` dispatch. |
| task | task-3 | story-1 | covered | GREEN: the boundary re-check placed before the `alreadyResolved` short-circuit, with the misplacement check. |
| task | task-4 | story-1 | covered | Negative: a current proof fast-forwards; an all-satisfied resume does not regress to top-of-list re-runs. |
| task | task-5 | story-1 | covered | Negative: skips preserved, throwing predicate dispatches, undeclared steps untouched. |
| task | task-6 | story-2 | covered | Negative: the re-check writes nothing and submits no mutation. |
| task | task-7 | story-2 | covered | Negative: `checkGate` state-only and `selector.ts` pure. |
| task | task-8 | story-3 | covered | RED for the pre-verify over the eligible set, in all four outcomes. |
| task | task-9 | story-3 | covered | GREEN: `applyRebaseVerdicts` pre-verifies every eligible gate; the partition is consumed, not recomputed. |
| task | task-10 | story-3 | covered | Negative: the pre-verify set is bounded and the invalidation set is unchanged. |
| task | task-11 | story-5 | covered | The typed unretryable facet, set on an error-class check at the assembly catch site. |
| task | task-12 | story-5 | covered | Classifier signal (c) at the step-runner seam, with the existing kill switch and telemetry arm. |
| task | task-13 | story-4 | covered | The halt names the blocking step and classifies `needs-human`. |
| task | task-14 | story-6 | covered | The rewind's port mutations, demotion set, and refusals. |
| task | task-15 | story-6 | covered | The rewind's clearing, ordering, spine emission, CLI registration, and end-to-end recovery test. |
| task | task-16 | story-6 | covered | Documentation upkeep for the CLI reference, the stalled-feature runbook, and the gates explanation, plus review condition 4's release-surface classification. |

## Consistency pass

Every outcome resolves to exactly one story and every story to at least two tasks, with no story or
task orphaned. The story-to-task mapping and the task-to-story mapping were derived independently —
one from the stories file, one from the plan's own `**Story:**` lines — and agree on all seventeen
tasks.

The `fr` row class is absent because this is a technical-track feature with no PRD; acceptance
criteria live directly in the stories, as the track marker records.

## Deviations, stated rather than implied

**story-2 has no RED task of its own.** Its happy paths are carried by task-2's second fixture rather
than by a separate task. This is deliberate: both observed variants belong in one test file so a fix
that reads verdicts instead of the predicate cannot pass one and fail the other in isolation. The row
records it rather than letting the story-to-task mapping look thin.

**outcome-6 is delivered by two mechanisms.** ADR-1 D2 and D6 both produce it, and the ADR states why
neither is redundant: D6 keeps the verdict honest where the knowledge lives and preserves the fast
path at its natural site, while D2 keeps the dispatch honest regardless of how either ledger drifted.
Removing either leaves one of the two observed failures live, so the overlap is a designed property
and not duplicated scope.

**task-16 is documentation upkeep and is mapped to story-6.** Documentation is deliberately not its
own story — it accompanies functional work rather than carrying acceptance criteria — so the row
records it under the story whose new CLI surface makes the existing reference incomplete. That task
also carries review condition 4's release-surface classification, which is process work rather than a
story obligation.

**Two tasks may halt rather than proceed.** task-0 halts if the predicate's measured cost fails
review condition 3's bar, because the remedy is memoization within a loop pass, a design the review
has not evaluated. This is recorded here so a halt at that point reads as the plan working rather
than as a stall.
